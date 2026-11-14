-- Movimiento masivo de inventario (homologación Movimientos entre bodegas,
-- nov-2026): registra en una sola transacción atómica N líneas (producto +
-- cantidad) de Entrada/Traspaso/Salida-Ajuste, reutilizando la MISMA forma
-- de escribir en existencia_bodega/movimiento_inventario que ya usan
-- fn_registrar_movimiento_inventario/fn_enviar_en_transito (no se tocan,
-- ver auditoría) -- aquí se reimplementa inline solo porque el origen
-- necesita una guardia atómica de no-negativo que esas dos funciones no
-- tienen (ver comentario dentro del loop).

-- 1) Columna de idempotencia -- nullable, solo la usa el flujo masivo
--    (un movimiento individual sigue sin tocarla, queda NULL como siempre).
alter table inventario.movimiento_inventario
  add column if not exists operacion_masiva_id uuid;

create index if not exists movimiento_inventario_operacion_masiva_id_ix
  on inventario.movimiento_inventario (operacion_masiva_id)
  where operacion_masiva_id is not null;

comment on column inventario.movimiento_inventario.operacion_masiva_id is
  'UUID generado por Angular una vez por intento de "Confirmar movimiento" en Movimiento masivo -- si la misma operación se reintenta (doble clic, red que falla y el usuario reintenta), fn_movimiento_masivo_registrar la detecta y NO vuelve a aplicar los movimientos. NULL en todo movimiento individual (modal "Nuevo movimiento").';

-- 2) fn_productos_autocomplete: se agrega foto_thumb_url (cambio aditivo en
--    columnas, no rompe a quien ya la usa por nombre -- el filtro del modal
--    "Nuevo movimiento" y de Historial) -- la tabla masiva la necesita para
--    la miniatura y así no hace falta una segunda función de autocomplete.
--    Cambia la forma del RETURNS TABLE, así que hay que recrearla.
drop function if exists inventario.fn_productos_autocomplete(text, integer);

create function inventario.fn_productos_autocomplete(p_busqueda text, p_limite integer default 15)
returns table(id bigint, codigo text, nombre text, foto_thumb_url text)
language sql
stable
set search_path to ''
as $function$
  select p.id, p.codigo, p.nombre, p.foto_thumb_url
  from inventario.producto p
  where p.activo = true
    and p.existencia is not null
    and (
      p_busqueda is null or p_busqueda = '' or
      p.nombre ilike '%' || p_busqueda || '%' or
      p.codigo ilike '%' || p_busqueda || '%'
    )
  order by p.nombre asc
  limit greatest(1, coalesce(p_limite, 15));
$function$;

grant execute on function inventario.fn_productos_autocomplete(text, integer) to authenticated;

-- 3) Función transaccional de registro masivo.
create or replace function inventario.fn_movimiento_masivo_registrar(
  p_tipo text,
  p_bodega_origen_id bigint,
  p_bodega_destino_id bigint,
  p_en_transito boolean,
  p_nota text,
  p_lineas jsonb,
  p_operacion_id uuid
)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_existentes int;
  v_linea jsonb;
  v_indice int := 0;
  v_producto_id bigint;
  v_cantidad numeric;
  v_producto inventario.producto;
  v_bodega inventario.bodega;
  v_count int := 0;
begin
  if p_operacion_id is null then
    raise exception 'Falta el identificador de operación (idempotencia).';
  end if;

  -- Idempotencia: si esta operación (mismo UUID) ya se registró antes --
  -- doble clic, Enter repetido, o un reintento tras una respuesta de red
  -- que no llegó a confirmarse en el navegador -- NO se vuelve a aplicar.
  -- Como todo el registro ocurre en una sola transacción, o están TODAS
  -- las filas de esa operación o no hay ninguna: nunca un estado a medias.
  select count(*) into v_existentes
  from inventario.movimiento_inventario
  where operacion_masiva_id = p_operacion_id;

  if v_existentes > 0 then
    return jsonb_build_object('operacion_id', p_operacion_id, 'duplicada', true, 'movimientos_registrados', v_existentes);
  end if;

  if p_tipo not in ('entrada', 'traspaso', 'salida') then
    raise exception 'Tipo de movimiento inválido: %.', p_tipo;
  end if;

  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then
    raise exception 'La operación necesita al menos un producto.';
  end if;

  if jsonb_array_length(p_lineas) > 10000 then
    raise exception 'Esta operación tiene demasiados productos (máximo 10,000 por operación) -- divídela en varias.';
  end if;

  if (select count(*) from jsonb_array_elements(p_lineas)) <>
     (select count(distinct (l->>'producto_id')) from jsonb_array_elements(p_lineas) l) then
    raise exception 'La operación tiene el mismo producto repetido en más de un renglón.';
  end if;

  -- Bodegas requeridas según tipo -- misma regla que guardar() del
  -- formulario individual (movimientos-bodega.component.ts).
  if p_tipo = 'entrada' then
    if p_bodega_destino_id is null then
      raise exception 'Falta la bodega de destino.';
    end if;
  else
    if p_bodega_origen_id is null then
      raise exception 'Falta la bodega de origen.';
    end if;
    if p_tipo = 'traspaso' then
      if p_bodega_destino_id is null then
        raise exception 'Falta la bodega de destino.';
      end if;
      if p_bodega_origen_id = p_bodega_destino_id then
        raise exception 'La bodega de origen y destino no pueden ser la misma.';
      end if;
    end if;
  end if;

  -- RLS ya acota "bodega" a la empresa actual -- si no aparece, no existe o
  -- no es de esta empresa; en ambos casos es el mismo mensaje.
  if p_bodega_origen_id is not null then
    select * into v_bodega from inventario.bodega where id = p_bodega_origen_id;
    if v_bodega.id is null then
      raise exception 'Bodega de origen % no encontrada o sin permiso.', p_bodega_origen_id;
    end if;
  end if;
  if p_bodega_destino_id is not null then
    select * into v_bodega from inventario.bodega where id = p_bodega_destino_id;
    if v_bodega.id is null then
      raise exception 'Bodega de destino % no encontrada o sin permiso.', p_bodega_destino_id;
    end if;
  end if;

  for v_linea in select * from jsonb_array_elements(p_lineas)
  loop
    v_indice := v_indice + 1;
    v_producto_id := case when v_linea->>'producto_id' is null then null else (v_linea->>'producto_id')::bigint end;
    v_cantidad := case when v_linea->>'cantidad' is null then null else (v_linea->>'cantidad')::numeric end;

    if v_producto_id is null then
      raise exception 'Renglón %: falta el producto.', v_indice;
    end if;
    if v_cantidad is null or v_cantidad <= 0 then
      raise exception 'Renglón % (producto %): la cantidad debe ser mayor a cero.', v_indice, v_producto_id;
    end if;

    -- RLS ya acota "producto" a la empresa actual.
    select * into v_producto from inventario.producto where id = v_producto_id;
    if v_producto.id is null then
      raise exception 'Renglón %: producto % no encontrado o sin permiso.', v_indice, v_producto_id;
    end if;
    if not v_producto.activo then
      raise exception 'Renglón % (%): el producto está inactivo.', v_indice, v_producto.nombre;
    end if;
    if v_producto.existencia is null then
      raise exception 'Renglón % (%): es un servicio -- no maneja existencia por bodega.', v_indice, v_producto.nombre;
    end if;

    if p_bodega_origen_id is not null then
      -- Resta con guardia atómica de no-negativo: a diferencia de
      -- fn_registrar_movimiento_inventario/fn_enviar_en_transito (que
      -- restan sin condición -- ver auditoría), aquí la condición
      -- "existencia >= cantidad" va en el propio UPDATE, así que la
      -- comprobación y la escritura son una sola operación atómica de
      -- Postgres: con dos usuarios restando el mismo producto/bodega a la
      -- vez, sus transacciones se serializan por el lock de fila y cada
      -- una ve el saldo real que dejó la anterior, nunca un saldo
      -- "leído hace un rato" desde el navegador.
      update inventario.existencia_bodega
      set existencia = existencia - v_cantidad
      where producto_id = v_producto_id and bodega_id = p_bodega_origen_id and existencia >= v_cantidad;

      if not found then
        raise exception 'Renglón % (%): existencia insuficiente en la bodega de origen.', v_indice, v_producto.nombre;
      end if;
    end if;

    if p_tipo = 'entrada' or (p_tipo = 'traspaso' and not coalesce(p_en_transito, false)) then
      insert into inventario.existencia_bodega (producto_id, bodega_id, existencia, ubicacion)
      values (v_producto_id, p_bodega_destino_id, v_cantidad, null)
      on conflict (producto_id, bodega_id)
      do update set existencia = inventario.existencia_bodega.existencia + excluded.existencia;
    end if;

    insert into inventario.movimiento_inventario (
      producto_id, bodega_origen_id, bodega_destino_id, cantidad, nota,
      orden_compra_id, costo_unitario, en_transito, fecha_recepcion, operacion_masiva_id
    ) values (
      v_producto_id,
      case when p_tipo = 'entrada' then null else p_bodega_origen_id end,
      case when p_tipo = 'salida' then null else p_bodega_destino_id end,
      v_cantidad,
      p_nota,
      null, null,
      (p_tipo = 'traspaso' and coalesce(p_en_transito, false)),
      null,
      p_operacion_id
    );

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('operacion_id', p_operacion_id, 'duplicada', false, 'movimientos_registrados', v_count);
end;
$function$;

grant execute on function inventario.fn_movimiento_masivo_registrar(text, bigint, bigint, boolean, text, jsonb, uuid) to authenticated;

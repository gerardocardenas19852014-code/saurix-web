-- SAURIX — Importación masiva de productos: homologación (nov-2026).
--
-- Reemplaza el ciclo de N inserciones HTTP individuales (una por producto,
-- sin validar nada en el servidor, sin ninguna atomicidad real — ver
-- auditoría en claude/productos-importacion-masiva-auditoria-2026-11.md)
-- por UNA sola llamada a esta función: valida TODO el archivo en el
-- servidor (nunca confiando en lo que ya validó el navegador) y, si no
-- hay ningún error, inserta todos los productos dentro de la MISMA
-- transacción implícita de la función — si algo falla a medio camino,
-- Postgres revierte la función completa solo, nunca queda un estado a
-- medias (decisión del usuario: "todo o nada SIEMPRE, sin importar el
-- tamaño").
--
-- Política de código duplicado (decisión del usuario, 4-nov-2026):
-- "detener toda la importación si hay algún duplicado" -- tanto si el
-- código se repite DENTRO del mismo archivo como si ya existe en el
-- catálogo. No se crea nada hasta que el archivo quede limpio.

-- ── 1) Tabla de la operación ("referencia de operación", sección I) ───────
-- Un renglón por cada importación que de verdad se ejecutó (nunca una
-- importación que falló por validación -- esas no llegan a crear nada,
-- así que tampoco dejan rastro aquí). Sirve también para la idempotencia
-- (mismo patrón ya usado en inventario.movimiento_inventario.operacion_masiva_id
-- / fn_movimiento_masivo_registrar): el id lo genera el navegador
-- (crypto.randomUUID()) ANTES de llamar a la función, así que un
-- reintento de red o un doble clic que repita la misma llamada con el
-- mismo id nunca vuelve a importar nada.
create table inventario.importacion_producto (
  id uuid primary key,
  empresa_id bigint not null default privado.empresa_actual_id() references seguridad.empresa(id),
  creado_por bigint references seguridad.usuario(id) default privado.usuario_actual_id(),
  fecha_creacion timestamptz not null default now(),
  total_filas int not null,
  productos_creados int not null
);

comment on table inventario.importacion_producto is
  'Encabezado de cada importación masiva de productos que SÍ se ejecutó (ver fn_importar_productos_masivo). Sirve como "referencia de operación" y como llave de idempotencia.';

alter table inventario.importacion_producto enable row level security;

-- Mismo patrón de 3 políticas que ya tiene inventario.producto.
create policy compartida_todo on inventario.importacion_producto
  as permissive for all
  using ((select privado.usuario_actual_id()) is not null)
  with check ((select privado.usuario_actual_id()) is not null);

create policy modulo_habilitado on inventario.importacion_producto
  as restrictive for all
  using ((select privado.modulo_habilitado('inventario')))
  with check ((select privado.modulo_habilitado('inventario')));

create policy solo_mi_empresa on inventario.importacion_producto
  as restrictive for all
  using (empresa_id = (select privado.empresa_actual_id()))
  with check (empresa_id = (select privado.empresa_actual_id()));

-- ── 2) De qué importación vino cada producto (opcional, nullable) ─────────
-- No cambia nada del alta manual (ahí siempre queda NULL) -- solo permite,
-- hacia adelante, saber "qué trajo esta importación" a partir de su id.
alter table inventario.producto
  add column importacion_id uuid references inventario.importacion_producto(id);

create index producto_importacion_id_ix on inventario.producto (importacion_id) where importacion_id is not null;

-- ── 3) La función ───────────────────────────────────────────────────────
-- p_solo_validar = true: valida todo (incluye duplicados dentro del
-- archivo y contra el catálogo) y responde SIN crear nada -- esto es lo
-- que llama Angular justo después de leer el archivo, para la vista
-- previa. Es la ÚNICA implementación de las reglas de validación: Angular
-- ya NO vuelve a reimplementarlas en TypeScript (antes sí lo hacía, 100%
-- en el navegador -- ver la auditoría), evitando el riesgo de que las dos
-- copias se desincronicen.
-- p_solo_validar = false: si la validación sale limpia, además inserta.
-- Si sale con algún error, de todas formas no inserta nada (nunca hace
-- falta "revertir": como la validación completa ocurre ANTES de cualquier
-- insert, un archivo con errores simplemente nunca llega a tocar la tabla).
create or replace function inventario.fn_importar_productos_masivo(
  p_filas jsonb,
  p_operacion_id uuid,
  p_solo_validar boolean default false
)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_existente inventario.importacion_producto;
  v_total int;
  v_fila jsonb;
  v_indice int := 0;
  v_errores jsonb := '[]';
  v_nombre text;
  v_codigo text;
  v_categoria_texto text;
  v_unidad_texto text;
  v_costo_texto text;
  v_precio_texto text;
  v_existencia_texto text;
  v_activo_texto text;
  v_descripcion_texto text;
  v_nivel_minimo_texto text;
  v_nivel_maximo_texto text;
  v_proveedor_texto text;
  v_unidad_compra_texto text;
  v_factor_texto text;
  v_maneja_lotes_texto text;
  v_destacado_texto text;
  v_numero int;
  v_categoria_id bigint;
  v_unidad_id bigint;
  v_proveedor_id bigint;
  v_unidad_compra_id bigint;
  v_costo numeric;
  v_precio numeric;
  v_existencia numeric;
  v_nivel_minimo numeric;
  v_nivel_maximo numeric;
  v_factor numeric;
  v_es_servicio boolean;
  v_activo boolean;
  v_maneja_lotes boolean;
  v_destacado boolean;
  v_codigo_lower text;
  v_vistos jsonb := '{}'; -- mapa codigo_lower -> primer renglón donde apareció, dentro de este mismo archivo.
  v_payloads jsonb := '[]'; -- renglones ya resueltos y limpios, listos para insertar.
  v_advertencias jsonb := '[]'; -- avisos que NO bloquean la importación (ver sección B del mandato).
  v_creados int := 0;
  v_numero_regla text := '^\d+(\.\d+)?$'; -- entero o decimal no negativo -- mismo criterio que Number() + Number.isNaN()/< 0 en Angular.
begin
  if p_operacion_id is null then
    raise exception 'Falta el identificador de operación (idempotencia).';
  end if;

  -- Idempotencia -- igual que fn_movimiento_masivo_registrar: un reintento
  -- con el mismo id nunca vuelve a crear nada, ni en modo validación.
  select * into v_existente from inventario.importacion_producto where id = p_operacion_id;
  if v_existente.id is not null then
    return jsonb_build_object(
      'operacionId', p_operacion_id, 'duplicada', true, 'ok', true,
      'totalFilas', v_existente.total_filas, 'productosCreados', v_existente.productos_creados,
      'errores', '[]'::jsonb, 'advertencias', '[]'::jsonb
    );
  end if;

  if p_filas is null or jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then
    raise exception 'El archivo no trae renglones para importar.';
  end if;

  v_total := jsonb_array_length(p_filas);
  if v_total > 5000 then
    raise exception 'El archivo trae % renglones -- el máximo por importación es 5,000. Divídelo en partes.', v_total;
  end if;

  for v_fila in select * from jsonb_array_elements(p_filas)
  loop
    v_indice := v_indice + 1;
    v_numero := coalesce((v_fila->>'numero')::int, v_indice);
    v_nombre := trim(coalesce(v_fila->>'nombre', ''));
    v_codigo := trim(coalesce(v_fila->>'codigo', ''));
    v_categoria_texto := trim(coalesce(v_fila->>'categoria', ''));
    v_unidad_texto := trim(coalesce(v_fila->>'unidad', ''));
    v_costo_texto := trim(coalesce(v_fila->>'costo', ''));
    v_precio_texto := trim(coalesce(v_fila->>'precio', ''));
    v_existencia_texto := trim(coalesce(v_fila->>'existencia', ''));
    v_activo_texto := lower(trim(coalesce(v_fila->>'activo', '')));
    v_descripcion_texto := trim(coalesce(v_fila->>'descripcion', ''));
    v_nivel_minimo_texto := trim(coalesce(v_fila->>'nivel_minimo', ''));
    v_nivel_maximo_texto := trim(coalesce(v_fila->>'nivel_maximo', ''));
    v_proveedor_texto := trim(coalesce(v_fila->>'proveedor', ''));
    v_unidad_compra_texto := trim(coalesce(v_fila->>'unidad_compra', ''));
    v_factor_texto := trim(coalesce(v_fila->>'factor_conversion_compra', ''));
    v_maneja_lotes_texto := lower(trim(coalesce(v_fila->>'maneja_lotes', '')));
    v_destacado_texto := lower(trim(coalesce(v_fila->>'destacado', '')));

    if v_nombre = '' then
      v_errores := v_errores || jsonb_build_object('numero', v_numero, 'mensaje', 'Falta el nombre.');
      continue;
    end if;

    -- Duplicado DENTRO del mismo archivo (política: detener todo).
    if v_codigo <> '' then
      v_codigo_lower := lower(v_codigo);
      if v_vistos ? v_codigo_lower then
        v_errores := v_errores || jsonb_build_object(
          'numero', v_numero,
          'mensaje', format('El código "%s" se repite dentro del mismo archivo (también en el renglón %s).', v_codigo, v_vistos->>v_codigo_lower)
        );
        continue;
      end if;
      v_vistos := v_vistos || jsonb_build_object(v_codigo_lower, v_numero);
    end if;

    -- RLS ya acota categoria_producto/unidad_medida/proveedor a la empresa actual.
    select id into v_categoria_id from inventario.categoria_producto where lower(clave) = lower(v_categoria_texto);
    if v_categoria_id is null then
      v_errores := v_errores || jsonb_build_object('numero', v_numero, 'mensaje', format('La categoría "%s" no existe (revisa la Clave).', v_categoria_texto));
      continue;
    end if;

    select id into v_unidad_id from inventario.unidad_medida where lower(clave) = lower(v_unidad_texto);
    if v_unidad_id is null then
      v_errores := v_errores || jsonb_build_object('numero', v_numero, 'mensaje', format('La unidad "%s" no existe (revisa la Clave).', v_unidad_texto));
      continue;
    end if;

    if v_costo_texto = '' then
      v_costo := 0;
    elsif v_costo_texto ~ v_numero_regla then
      v_costo := v_costo_texto::numeric;
    else
      v_errores := v_errores || jsonb_build_object('numero', v_numero, 'mensaje', format('Costo inválido: "%s".', v_costo_texto));
      continue;
    end if;

    if v_precio_texto = '' then
      v_errores := v_errores || jsonb_build_object('numero', v_numero, 'mensaje', 'Falta el precio.');
      continue;
    elsif v_precio_texto ~ v_numero_regla then
      v_precio := v_precio_texto::numeric;
    else
      v_errores := v_errores || jsonb_build_object('numero', v_numero, 'mensaje', format('Precio inválido: "%s".', v_precio_texto));
      continue;
    end if;

    v_existencia := null;
    if v_existencia_texto <> '' then
      if v_existencia_texto ~ v_numero_regla then
        v_existencia := v_existencia_texto::numeric;
      else
        v_errores := v_errores || jsonb_build_object('numero', v_numero, 'mensaje', format('Existencia inválida: "%s".', v_existencia_texto));
        continue;
      end if;
    end if;
    v_es_servicio := v_existencia is null;

    v_nivel_minimo := null;
    if not v_es_servicio and v_nivel_minimo_texto <> '' then
      if v_nivel_minimo_texto ~ v_numero_regla then
        v_nivel_minimo := v_nivel_minimo_texto::numeric;
      else
        v_errores := v_errores || jsonb_build_object('numero', v_numero, 'mensaje', format('Nivel mínimo inválido: "%s".', v_nivel_minimo_texto));
        continue;
      end if;
    end if;

    v_nivel_maximo := null;
    if not v_es_servicio and v_nivel_maximo_texto <> '' then
      if v_nivel_maximo_texto ~ v_numero_regla then
        v_nivel_maximo := v_nivel_maximo_texto::numeric;
      else
        v_errores := v_errores || jsonb_build_object('numero', v_numero, 'mensaje', format('Nivel máximo inválido: "%s".', v_nivel_maximo_texto));
        continue;
      end if;
    end if;

    v_proveedor_id := null;
    if v_proveedor_texto <> '' then
      select id into v_proveedor_id from inventario.proveedor where lower(nombre) = lower(v_proveedor_texto);
      if v_proveedor_id is null then
        v_errores := v_errores || jsonb_build_object('numero', v_numero, 'mensaje', format('El proveedor "%s" no existe (coincide por Nombre, el proveedor no tiene Clave).', v_proveedor_texto));
        continue;
      end if;
    end if;

    v_unidad_compra_id := null;
    v_factor := null;
    if v_unidad_compra_texto <> '' then
      select id into v_unidad_compra_id from inventario.unidad_medida where lower(clave) = lower(v_unidad_compra_texto);
      if v_unidad_compra_id is null then
        v_errores := v_errores || jsonb_build_object('numero', v_numero, 'mensaje', format('La unidad de compra "%s" no existe (revisa la Clave).', v_unidad_compra_texto));
        continue;
      end if;
      if v_factor_texto = '' then
        v_errores := v_errores || jsonb_build_object('numero', v_numero, 'mensaje', 'Falta "factor_conversion_compra" (a cuántas unidades base equivale la unidad de compra).');
        continue;
      elsif v_factor_texto ~ v_numero_regla and v_factor_texto::numeric > 0 then
        v_factor := v_factor_texto::numeric;
      else
        v_errores := v_errores || jsonb_build_object('numero', v_numero, 'mensaje', format('Factor de conversión inválido: "%s".', v_factor_texto));
        continue;
      end if;
    end if;

    v_activo := not (v_activo_texto = any (array['no', 'false', '0']));
    v_maneja_lotes := not v_es_servicio and not (v_maneja_lotes_texto = any (array['', 'no', 'false', '0']));
    v_destacado := not (v_destacado_texto = any (array['', 'no', 'false', '0']));

    -- Advertencias (sección B del mandato): NO bloquean la importación --
    -- el renglón sigue adelante y el producto se crea igual.
    if v_codigo = '' then
      v_advertencias := v_advertencias || jsonb_build_object('numero', v_numero, 'mensaje', 'Sin código -- no podrá buscarse por código de barras/QR en Cobro ni en Movimientos entre bodegas.');
    end if;
    if v_precio < v_costo then
      v_advertencias := v_advertencias || jsonb_build_object('numero', v_numero, 'mensaje', format('El precio (%s) es menor que el costo (%s).', v_precio, v_costo));
    end if;

    v_payloads := v_payloads || jsonb_build_object(
      'numero', v_numero,
      'nombre', v_nombre,
      'codigo', case when v_codigo = '' then null else v_codigo end,
      'categoria_producto_id', v_categoria_id,
      'unidad_medida_id', v_unidad_id,
      'descripcion', case when v_descripcion_texto = '' then null else v_descripcion_texto end,
      'costo', v_costo,
      'precio_unitario', v_precio,
      'existencia', v_existencia,
      'nivel_minimo', v_nivel_minimo,
      'nivel_maximo', v_nivel_maximo,
      'proveedor_id', v_proveedor_id,
      'unidad_compra_id', v_unidad_compra_id,
      'factor_conversion_compra', v_factor,
      'maneja_lotes', v_maneja_lotes,
      'destacado', v_destacado,
      'activo', v_activo
    );
  end loop;

  -- Duplicado CONTRA el catálogo ya guardado (política: detener todo) --
  -- UNA sola consulta por todos los códigos del archivo, nunca una por
  -- renglón ni el catálogo completo (sección F del mandato).
  if v_errores = '[]'::jsonb then
    for v_fila in
      select jsonb_build_object('numero', pl->>'numero', 'codigo', pl->>'codigo', 'id', p.id, 'nombre', p.nombre)
      from jsonb_array_elements(v_payloads) pl
      join inventario.producto p on lower(p.codigo) = lower(pl->>'codigo')
      where pl->>'codigo' is not null
    loop
      v_errores := v_errores || jsonb_build_object(
        'numero', (v_fila->>'numero')::int,
        'mensaje', format('El código "%s" ya existe en el catálogo (producto #%s: %s).', v_fila->>'codigo', v_fila->>'id', v_fila->>'nombre')
      );
    end loop;
  end if;

  if jsonb_array_length(v_errores) > 0 then
    return jsonb_build_object(
      'operacionId', p_operacion_id, 'duplicada', false, 'ok', false,
      'totalFilas', v_total, 'productosCreados', 0, 'errores', v_errores, 'advertencias', v_advertencias
    );
  end if;

  if p_solo_validar then
    return jsonb_build_object(
      'operacionId', p_operacion_id, 'duplicada', false, 'ok', true,
      'totalFilas', v_total, 'productosCreados', 0, 'errores', '[]'::jsonb, 'advertencias', v_advertencias
    );
  end if;

  -- Validación 100% limpia -- ahora sí se inserta. Todo dentro de la misma
  -- transacción implícita de esta función: si algo truena aquí (debería
  -- ser imposible, ya se validó todo arriba, pero por ejemplo una
  -- restricción nueva que no se conocía), Postgres revierte TODO solo.
  insert into inventario.importacion_producto (id, total_filas, productos_creados)
  values (p_operacion_id, v_total, 0);

  for v_fila in select * from jsonb_array_elements(v_payloads)
  loop
    insert into inventario.producto (
      nombre, codigo, categoria_producto_id, unidad_medida_id, descripcion, costo, precio_unitario,
      existencia, nivel_minimo, nivel_maximo, proveedor_id, unidad_compra_id, factor_conversion_compra,
      maneja_lotes, destacado, activo, importacion_id
    ) values (
      v_fila->>'nombre',
      v_fila->>'codigo',
      (v_fila->>'categoria_producto_id')::bigint,
      (v_fila->>'unidad_medida_id')::bigint,
      v_fila->>'descripcion',
      (v_fila->>'costo')::numeric,
      (v_fila->>'precio_unitario')::numeric,
      (v_fila->>'existencia')::numeric,
      (v_fila->>'nivel_minimo')::numeric,
      (v_fila->>'nivel_maximo')::numeric,
      (v_fila->>'proveedor_id')::bigint,
      (v_fila->>'unidad_compra_id')::bigint,
      (v_fila->>'factor_conversion_compra')::numeric,
      (v_fila->>'maneja_lotes')::boolean,
      (v_fila->>'destacado')::boolean,
      (v_fila->>'activo')::boolean,
      p_operacion_id
    );
    v_creados := v_creados + 1;
  end loop;

  update inventario.importacion_producto set productos_creados = v_creados where id = p_operacion_id;

  return jsonb_build_object(
    'operacionId', p_operacion_id, 'duplicada', false, 'ok', true,
    'totalFilas', v_total, 'productosCreados', v_creados, 'errores', '[]'::jsonb, 'advertencias', v_advertencias
  );
end;
$function$;

-- Homologación Tienda Pública (nov-2026), Bloque F: validación server-side
-- de precios para TODOS los orígenes de pedido, no solo Menú QR.
--
-- crear_orden_menu_qr() ya reconstruía precio/total/opciones de forma
-- autoritativa del lado del servidor (nunca confiaba en lo que mandara el
-- navegador) — ver su comentario grande. crear_pedido_tienda() (el pedido
-- web/WhatsApp) en cambio guardaba p_items/p_total EXACTAMENTE como los
-- mandara Angular, sin ninguna revalidación — hallazgo explícito del nuevo
-- mandato de homologación (sección 18): "no confiar en un total calculado
-- exclusivamente por Angular". Ese total sin validar SÍ era visible para el
-- personal en la bandeja "Pedidos web" (ventas.fn_pedidos_tienda_listar
-- expone p.total directamente) — aunque el cobro real nunca dependía de él
-- (ventas.fn_revalidar_items_pedido_tienda ya revalida todo de nuevo al
-- "Cargar a venta"), no había razón para seguir guardando un valor que un
-- cliente podía manipular con las herramientas de desarrollador del
-- navegador.
--
-- En vez de duplicar la lógica de reconstrucción en las dos funciones
-- (regla del proyecto: reutilizar antes de crear), se extrae a un helper
-- compartido con EXACTAMENTE la misma lógica que ya tenía
-- crear_orden_menu_qr (sin cambios de comportamiento para ese flujo, solo
-- se movió el código) y crear_pedido_tienda ahora la llama también.

-- 1) Helper compartido — NO es un punto de entrada público: recibe
--    p_empresa_id ya resuelto por el llamador (que sí valida clave/activo/
--    catalogo_publico_activo), así que se le revoca EXECUTE a
--    anon/authenticated/public justo abajo para que nadie pueda usarlo
--    para sondear precios de una empresa arbitraria sin pasar por esa
--    resolución.
create or replace function seguridad.fn_revalidar_items_pedido(p_empresa_id bigint, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_item jsonb;
  v_producto_id bigint;
  v_cantidad int;
  v_nombre_producto text;
  v_opcion_ids bigint[];
  v_opcion_pedidos int;
  v_opcion_encontrados int;
  v_opciones_detalle jsonb;
  v_precio_base numeric;
  v_activo boolean;
  v_extra numeric;
  v_total numeric := 0;
  v_cantidad_total int := 0;
  v_items_guardar jsonb := '[]'::jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('error', 'orden_vacia');
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_producto_id := nullif(v_item->>'productoId', '')::bigint;
    v_cantidad := coalesce((v_item->>'cantidad')::int, 0);

    if v_producto_id is null or v_cantidad <= 0 or v_cantidad > 999 then
      return jsonb_build_object('error', 'item_invalido');
    end if;

    select pr.precio_unitario, pr.activo, pr.nombre into v_precio_base, v_activo, v_nombre_producto
      from inventario.producto pr
      where pr.id = v_producto_id and pr.empresa_id = p_empresa_id;

    if v_precio_base is null or v_activo is not true then
      return jsonb_build_object('error', 'producto_no_disponible', 'productoId', v_producto_id);
    end if;

    v_opcion_ids := array(
      select nullif(x, '')::bigint
      from jsonb_array_elements_text(coalesce(v_item->'opcionValorIds', '[]'::jsonb)) as x
    );
    v_opcion_pedidos := coalesce(array_length(v_opcion_ids, 1), 0);
    v_extra := 0;
    v_opcion_encontrados := 0;
    v_opciones_detalle := '[]'::jsonb;

    if v_opcion_pedidos > 0 then
      select coalesce(sum(pov.precio_adicional), 0), count(*),
             coalesce(jsonb_agg(jsonb_build_object('grupoNombre', pog.nombre, 'valorNombre', pov.nombre, 'precioAdicional', pov.precio_adicional)), '[]'::jsonb)
        into v_extra, v_opcion_encontrados, v_opciones_detalle
        from inventario.producto_opcion_valor pov
        join inventario.producto_opcion_grupo pog on pog.id = pov.grupo_id
        where pov.id = any(v_opcion_ids)
          and pog.producto_id = v_producto_id
          and pov.empresa_id = p_empresa_id;

      if v_opcion_encontrados <> v_opcion_pedidos then
        return jsonb_build_object('error', 'opcion_invalida', 'productoId', v_producto_id);
      end if;
    end if;

    v_total := v_total + ((v_precio_base + v_extra) * v_cantidad);
    v_cantidad_total := v_cantidad_total + v_cantidad;

    v_items_guardar := v_items_guardar || jsonb_build_array(jsonb_build_object(
      'productoId', v_producto_id,
      'nombreProducto', v_nombre_producto,
      'precioBase', v_precio_base,
      'opcionesElegidas', v_opciones_detalle,
      'cantidad', v_cantidad
    ));
  end loop;

  return jsonb_build_object('items', v_items_guardar, 'total', v_total, 'cantidadTotal', v_cantidad_total);
end;
$function$;

revoke all on function seguridad.fn_revalidar_items_pedido(bigint, jsonb) from public, anon, authenticated;

-- 2) crear_orden_menu_qr: mismo comportamiento de siempre, ahora delegando
--    la reconstrucción al helper en vez de tenerla duplicada inline.
create or replace function seguridad.crear_orden_menu_qr(p_clave text, p_nombre_cliente text default null::text, p_items jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_empresa_id bigint;
  v_modo text;
  v_resultado jsonb;
  v_items_guardar jsonb;
  v_total numeric;
  v_cantidad_total int;
  v_id bigint;
  v_folio text;
  v_token text;
begin
  select e.id, e.modo_tienda into v_empresa_id, v_modo
    from seguridad.empresa e
    where e.clave = lower(trim(p_clave)) and e.activo and e.catalogo_publico_activo
    limit 1;

  if v_empresa_id is null then
    return jsonb_build_object('error', 'tienda_no_encontrada');
  end if;

  if v_modo <> 'menu_orden' then
    return jsonb_build_object('error', 'modo_no_disponible');
  end if;

  v_resultado := seguridad.fn_revalidar_items_pedido(v_empresa_id, p_items);
  if v_resultado ? 'error' then
    return v_resultado;
  end if;

  v_items_guardar := v_resultado->'items';
  v_total := (v_resultado->>'total')::numeric;
  v_cantidad_total := (v_resultado->>'cantidadTotal')::int;

  insert into ventas.pedido_tienda
    (empresa_id, nombre_cliente, telefono_cliente, nombre_mostrar_en, items, total, origen, estado)
  values
    (v_empresa_id, null, null, nullif(trim(coalesce(p_nombre_cliente, '')), ''), v_items_guardar, v_total, 'menu_qr', 'Pendiente')
  returning id, folio, token_publico into v_id, v_folio, v_token;

  return jsonb_build_object(
    'id', v_id,
    'folio', v_folio,
    'token', v_token,
    'articulos', v_cantidad_total,
    'total', v_total
  );
end;
$function$;

-- 3) crear_pedido_tienda: AHORA SÍ revalida precio/items en el servidor
--    (antes guardaba p_items/p_total tal cual los mandaba el navegador —
--    ver hallazgo en el comentario grande de arriba). p_total se conserva
--    en la firma solo por compatibilidad de la llamada RPC; su valor ya no
--    se usa. p_items ahora debe venir en forma mínima
--    {productoId, cantidad, opcionValorIds} — igual que ya mandaba
--    crearOrdenMenuQr() del lado de Angular (ver cambio correspondiente en
--    tienda-publica.service.ts).
create or replace function seguridad.crear_pedido_tienda(p_clave text, p_nombre text, p_telefono text, p_notas text, p_lat numeric, p_lng numeric, p_items jsonb, p_total numeric)
returns bigint
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_empresa_id bigint;
  v_id bigint;
  v_resultado jsonb;
begin
  select e.id into v_empresa_id
    from seguridad.empresa e
    where e.clave = lower(trim(p_clave)) and e.activo and e.catalogo_publico_activo
    limit 1;

  if v_empresa_id is null then
    raise exception 'Tienda no encontrada o inactiva.';
  end if;

  if coalesce(trim(p_nombre), '') = '' or coalesce(trim(p_telefono), '') = '' then
    raise exception 'Nombre y teléfono son obligatorios.';
  end if;

  v_resultado := seguridad.fn_revalidar_items_pedido(v_empresa_id, p_items);
  if v_resultado ? 'error' then
    raise exception '%', v_resultado->>'error';
  end if;

  insert into ventas.pedido_tienda
    (empresa_id, nombre_cliente, telefono_cliente, notas_cliente, ubicacion_lat, ubicacion_lng, items, total)
  values
    (v_empresa_id, trim(p_nombre), trim(p_telefono), nullif(trim(coalesce(p_notas, '')), ''), p_lat, p_lng, v_resultado->'items', (v_resultado->>'total')::numeric)
  returning id into v_id;

  return v_id;
end;
$function$;

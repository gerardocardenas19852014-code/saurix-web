
create or replace function seguridad.crear_orden_menu_qr(
  p_clave text,
  p_nombre_cliente text default null,
  p_items jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_empresa_id bigint;
  v_modo text;
  v_item jsonb;
  v_producto_id bigint;
  v_cantidad int;
  v_opcion_ids bigint[];
  v_opcion_pedidos int;
  v_opcion_encontrados int;
  v_precio_base numeric;
  v_activo boolean;
  v_extra numeric;
  v_total numeric := 0;
  v_cantidad_total int := 0;
  v_id bigint;
  v_folio text;
  v_token text;
begin
  -- Resolver tienda y exigir que esté realmente en modo "menu_orden" (no
  -- confiar en lo que mande el navegador sobre el modo activo).
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

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('error', 'orden_vacia');
  end if;

  -- Reconstruir el total de forma autoritativa, renglón por renglón — NUNCA
  -- se usa un total/precio que haya mandado el navegador (sección 30).
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_producto_id := nullif(v_item->>'productoId', '')::bigint;
    v_cantidad := coalesce((v_item->>'cantidad')::int, 0);

    if v_producto_id is null or v_cantidad <= 0 or v_cantidad > 999 then
      return jsonb_build_object('error', 'item_invalido');
    end if;

    select pr.precio_unitario, pr.activo into v_precio_base, v_activo
      from inventario.producto pr
      where pr.id = v_producto_id and pr.empresa_id = v_empresa_id;

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

    if v_opcion_pedidos > 0 then
      select coalesce(sum(pov.precio_adicional), 0), count(*)
        into v_extra, v_opcion_encontrados
        from inventario.producto_opcion_valor pov
        join inventario.producto_opcion_grupo pog on pog.id = pov.grupo_id
        where pov.id = any(v_opcion_ids)
          and pog.producto_id = v_producto_id
          and pov.empresa_id = v_empresa_id;

      if v_opcion_encontrados <> v_opcion_pedidos then
        return jsonb_build_object('error', 'opcion_invalida', 'productoId', v_producto_id);
      end if;
    end if;

    v_total := v_total + ((v_precio_base + v_extra) * v_cantidad);
    v_cantidad_total := v_cantidad_total + v_cantidad;
  end loop;

  -- No es una venta (sección 7): solo INSERT en pedido_tienda, como
  -- siempre — nunca toca inventario, MovimientoInventario, caja ni ventas.
  insert into ventas.pedido_tienda
    (empresa_id, nombre_cliente, telefono_cliente, nombre_mostrar_en, items, total, origen, estado)
  values
    (v_empresa_id, null, null, nullif(trim(coalesce(p_nombre_cliente, '')), ''), p_items, v_total, 'menu_qr', 'Pendiente')
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

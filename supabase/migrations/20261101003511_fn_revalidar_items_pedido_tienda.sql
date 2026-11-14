
create or replace function ventas.fn_revalidar_items_pedido_tienda(p_pedido_id bigint)
returns table (
  producto_id bigint,
  descripcion text,
  cantidad int,
  precio_unitario numeric,
  disponible boolean,
  motivo text
)
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_items jsonb;
  v_item jsonb;
  v_producto_id bigint;
  v_cantidad int;
  v_nombre_guardado text;
  v_opciones jsonb;
  v_opcion jsonb;
  v_desc text;
  v_precio_base numeric;
  v_activo boolean;
  v_extra numeric;
  v_valor_actual numeric;
  v_grupo_nombre text;
  v_valor_nombre text;
begin
  -- "Cargar a venta" (sección 30 del plan): el precio/disponibilidad
  -- SIEMPRE se recalcula aquí, nunca se confía en el snapshot guardado en
  -- pedido_tienda.items (pudo quedar viejo si el producto cambió de precio
  -- o se desactivó desde que se creó el pedido/orden). RLS de
  -- ventas.pedido_tienda/inventario.producto (empresa_id = empresa_actual_id())
  -- ya aísla multi-tenant — esta función no es security definer.
  select items into v_items from ventas.pedido_tienda where id = p_pedido_id;
  if v_items is null then
    return;
  end if;

  for v_item in select * from jsonb_array_elements(v_items)
  loop
    v_producto_id := nullif(v_item->>'productoId', '')::bigint;
    v_cantidad := coalesce((v_item->>'cantidad')::int, 0);
    v_nombre_guardado := coalesce(v_item->>'nombreProducto', '(producto)');
    v_opciones := coalesce(v_item->'opcionesElegidas', '[]'::jsonb);
    v_desc := v_nombre_guardado;

    select pr.precio_unitario, pr.activo into v_precio_base, v_activo
      from inventario.producto pr
      where pr.id = v_producto_id;

    if v_precio_base is null then
      producto_id := v_producto_id;
      descripcion := v_desc;
      cantidad := v_cantidad;
      precio_unitario := 0;
      disponible := false;
      motivo := 'Este producto ya no existe en el catálogo.';
      return next;
      continue;
    end if;

    v_extra := 0;
    for v_opcion in select * from jsonb_array_elements(v_opciones)
    loop
      v_grupo_nombre := v_opcion->>'grupoNombre';
      v_valor_nombre := v_opcion->>'valorNombre';
      -- El snapshot guardado no trae el id del valor (solo nombres) — se
      -- busca el precio ADICIONAL ACTUAL por nombre de grupo/valor dentro
      -- del mismo producto; si ya no existe esa opción, se usa el precio
      -- guardado como respaldo pero la línea queda marcada "no disponible"
      -- para que el cajero la revise en vez de cobrar a ciegas.
      select pov.precio_adicional into v_valor_actual
        from inventario.producto_opcion_valor pov
        join inventario.producto_opcion_grupo pog on pog.id = pov.grupo_id
        where pog.producto_id = v_producto_id
          and pog.nombre = v_grupo_nombre
          and pov.nombre = v_valor_nombre
        limit 1;

      if v_valor_actual is null then
        producto_id := v_producto_id;
        descripcion := v_desc || ' (' || v_grupo_nombre || ': ' || v_valor_nombre || ')';
        cantidad := v_cantidad;
        precio_unitario := v_precio_base + coalesce((v_opcion->>'precioAdicional')::numeric, 0);
        disponible := false;
        motivo := 'Una de las opciones elegidas ya no existe — revisa el precio.';
        return next;
        continue;
      end if;

      v_extra := v_extra + v_valor_actual;
      v_desc := v_desc || ' (' || v_grupo_nombre || ': ' || v_valor_nombre || ')';
    end loop;

    producto_id := v_producto_id;
    descripcion := v_desc;
    cantidad := v_cantidad;
    precio_unitario := v_precio_base + v_extra;
    disponible := v_activo is true;
    motivo := case when v_activo is not true then 'Este producto está desactivado.' else null end;
    return next;
  end loop;
end;
$function$;

-- =====================================================================
-- Saurix · Supabase · 29 Tienda pública: categoría por producto
--  - El cliente pidió que /tienda agrupe/separe los productos por
--    categoría (inventario.categoria_producto). La función
--    seguridad.tienda_detalle() no devolvía ese dato, así que el catálogo
--    público no tenía forma de agrupar — se agrega categoriaId/
--    categoriaNombre a cada producto del jsonb y se ordena por categoría
--    y luego por nombre de producto, para que los grupos salgan juntos.
--  - Solo se reemplaza la función (mismo contrato anon/authenticated de
--    28_tienda_publica_fix_grants.sql, no hace falta volver a otorgar
--    EXECUTE).
-- =====================================================================
set check_function_bodies = off;

create or replace function seguridad.tienda_detalle(p_clave text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_empresa record;
  v_resultado jsonb;
begin
  select e.id, e.clave, e.nombre, e.descripcion_publica, e.telefono_pedidos, e.correo_pedidos, e.logo_publico
    into v_empresa
    from seguridad.empresa e
    where e.clave = lower(trim(p_clave)) and e.activo and e.catalogo_publico_activo
    limit 1;

  if v_empresa.id is null then
    return null;
  end if;

  select jsonb_build_object(
    'empresa', jsonb_build_object(
      'clave', v_empresa.clave,
      'nombre', v_empresa.nombre,
      'descripcion', v_empresa.descripcion_publica,
      'telefono', v_empresa.telefono_pedidos,
      'correo', v_empresa.correo_pedidos,
      'logo', v_empresa.logo_publico
    ),
    'productos', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', pr.id,
          'nombre', pr.nombre,
          'descripcion', pr.descripcion,
          'precio', pr.precio_unitario,
          'foto', pr.foto,
          'disponible', (pr.existencia is null or pr.existencia > 0),
          'categoriaId', cp.id,
          'categoriaNombre', cp.nombre,
          'opciones', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', g.id,
                'nombre', g.nombre,
                'tipoSeleccion', g.tipo_seleccion,
                'requerido', g.requerido,
                'minimo', g.minimo,
                'maximo', g.maximo,
                'valores', coalesce((
                  select jsonb_agg(
                    jsonb_build_object('id', v.id, 'nombre', v.nombre, 'precioAdicional', v.precio_adicional)
                    order by v.orden, v.id
                  )
                  from inventario.producto_opcion_valor v
                  where v.grupo_id = g.id and v.activo
                ), '[]'::jsonb)
              )
              order by g.orden, g.id
            )
            from inventario.producto_opcion_grupo g
            where g.producto_id = pr.id and g.activo
          ), '[]'::jsonb)
        )
        order by cp.nombre, pr.nombre
      ),
      '[]'::jsonb
    )
  )
  into v_resultado
  from inventario.producto pr
  join inventario.categoria_producto cp on cp.id = pr.categoria_producto_id
  where pr.empresa_id = v_empresa.id and pr.activo;

  return v_resultado;
end;
$$;

revoke all on function seguridad.tienda_detalle(text) from public;
grant execute on function seguridad.tienda_detalle(text) to anon, authenticated;

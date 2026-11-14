
-- Catálogo público PAGINADO, server-side, con cursor/keyset. Reemplaza el
-- "productos" que tienda_detalle() devolvía completo (ver migración
-- siguiente, que deja tienda_detalle() solo con la config de la tienda).
-- Reutiliza inventario.existencia_producto_resumen (trigger-maintained)
-- como fuente de existencia, igual criterio que existenciaTotal() en
-- producto.util.ts: si no hay fila ahí, cae a producto.existencia.
create or replace function seguridad.fn_catalogo_tienda_pagina(
  p_clave text,
  p_busqueda text default null,
  p_categoria_id bigint default null,
  p_orden text default 'categoria', -- 'categoria' | 'precio'
  p_cursor_categoria_nombre text default null,
  p_cursor_nombre text default null,
  p_cursor_precio numeric default null,
  p_cursor_id bigint default null,
  p_cantidad int default 24
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_empresa_id bigint;
  v_cantidad int := least(greatest(coalesce(p_cantidad, 24), 1), 100);
  v_busqueda text := nullif(trim(coalesce(p_busqueda, '')), '');
  v_resultado jsonb;
begin
  select e.id into v_empresa_id
  from seguridad.empresa e
  where e.clave = lower(trim(p_clave)) and e.activo and e.catalogo_publico_activo
  limit 1;

  if v_empresa_id is null then
    return jsonb_build_object('error', 'tienda_no_encontrada');
  end if;

  if p_orden = 'precio' then
    with base as (
      select
        pr.id, pr.nombre, pr.descripcion, pr.precio_unitario as precio, pr.destacado, pr.fecha_creacion,
        cp.id as categoria_id, cp.nombre as categoria_nombre,
        pr.foto_thumb_url, pr.foto_detalle_url,
        coalesce(per.existencia_total, pr.existencia) as existencia_resuelta,
        pr.nivel_minimo
      from inventario.producto pr
      join inventario.categoria_producto cp on cp.id = pr.categoria_producto_id
      left join inventario.existencia_producto_resumen per on per.producto_id = pr.id
      where pr.empresa_id = v_empresa_id
        and pr.activo
        and (p_categoria_id is null or pr.categoria_producto_id = p_categoria_id)
        and (v_busqueda is null or pr.nombre ilike '%' || v_busqueda || '%')
        and (
          p_cursor_id is null
          or (pr.precio_unitario, pr.id) > (p_cursor_precio, p_cursor_id)
        )
      order by pr.precio_unitario, pr.id
      limit v_cantidad + 1
    ),
    numerado as (
      select *, row_number() over (order by precio, id) as rn from base
    )
    select jsonb_build_object(
      'productos', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', n.id, 'nombre', n.nombre, 'descripcion', n.descripcion, 'precio', n.precio,
          'fotoThumbUrl', n.foto_thumb_url, 'fotoDetalleUrl', n.foto_detalle_url,
          'disponible', (n.existencia_resuelta is null or n.existencia_resuelta > 0),
          'destacado', n.destacado, 'fechaCreacion', n.fecha_creacion,
          'pocasExistencias', (n.existencia_resuelta is not null and n.nivel_minimo is not null
            and n.existencia_resuelta > 0 and n.existencia_resuelta <= n.nivel_minimo),
          'categoriaId', n.categoria_id, 'categoriaNombre', n.categoria_nombre,
          'opciones', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', g.id, 'nombre', g.nombre, 'tipoSeleccion', g.tipo_seleccion, 'requerido', g.requerido,
              'minimo', g.minimo, 'maximo', g.maximo,
              'valores', coalesce((
                select jsonb_agg(jsonb_build_object('id', v.id, 'nombre', v.nombre, 'precioAdicional', v.precio_adicional) order by v.orden, v.id)
                from inventario.producto_opcion_valor v where v.grupo_id = g.id and v.activo
              ), '[]'::jsonb)
            ) order by g.orden, g.id)
            from inventario.producto_opcion_grupo g where g.producto_id = n.id and g.activo
          ), '[]'::jsonb)
        ) order by n.rn)
        from numerado n where n.rn <= v_cantidad
      ), '[]'::jsonb),
      'hayMas', coalesce(bool_or(rn > v_cantidad), false),
      'cursor', (
        select jsonb_build_object('precio', n.precio, 'id', n.id)
        from numerado n where n.rn <= v_cantidad order by n.rn desc limit 1
      )
    ) into v_resultado
    from numerado;
  else
    with base as (
      select
        pr.id, pr.nombre, pr.descripcion, pr.precio_unitario as precio, pr.destacado, pr.fecha_creacion,
        cp.id as categoria_id, cp.nombre as categoria_nombre,
        pr.foto_thumb_url, pr.foto_detalle_url,
        coalesce(per.existencia_total, pr.existencia) as existencia_resuelta,
        pr.nivel_minimo
      from inventario.producto pr
      join inventario.categoria_producto cp on cp.id = pr.categoria_producto_id
      left join inventario.existencia_producto_resumen per on per.producto_id = pr.id
      where pr.empresa_id = v_empresa_id
        and pr.activo
        and (p_categoria_id is null or pr.categoria_producto_id = p_categoria_id)
        and (v_busqueda is null or pr.nombre ilike '%' || v_busqueda || '%')
        and (
          p_cursor_id is null
          or (cp.nombre, pr.nombre, pr.id) > (p_cursor_categoria_nombre, p_cursor_nombre, p_cursor_id)
        )
      order by cp.nombre, pr.nombre, pr.id
      limit v_cantidad + 1
    ),
    numerado as (
      select *, row_number() over (order by categoria_nombre, nombre, id) as rn from base
    )
    select jsonb_build_object(
      'productos', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', n.id, 'nombre', n.nombre, 'descripcion', n.descripcion, 'precio', n.precio,
          'fotoThumbUrl', n.foto_thumb_url, 'fotoDetalleUrl', n.foto_detalle_url,
          'disponible', (n.existencia_resuelta is null or n.existencia_resuelta > 0),
          'destacado', n.destacado, 'fechaCreacion', n.fecha_creacion,
          'pocasExistencias', (n.existencia_resuelta is not null and n.nivel_minimo is not null
            and n.existencia_resuelta > 0 and n.existencia_resuelta <= n.nivel_minimo),
          'categoriaId', n.categoria_id, 'categoriaNombre', n.categoria_nombre,
          'opciones', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', g.id, 'nombre', g.nombre, 'tipoSeleccion', g.tipo_seleccion, 'requerido', g.requerido,
              'minimo', g.minimo, 'maximo', g.maximo,
              'valores', coalesce((
                select jsonb_agg(jsonb_build_object('id', v.id, 'nombre', v.nombre, 'precioAdicional', v.precio_adicional) order by v.orden, v.id)
                from inventario.producto_opcion_valor v where v.grupo_id = g.id and v.activo
              ), '[]'::jsonb)
            ) order by g.orden, g.id)
            from inventario.producto_opcion_grupo g where g.producto_id = n.id and g.activo
          ), '[]'::jsonb)
        ) order by n.rn)
        from numerado n where n.rn <= v_cantidad
      ), '[]'::jsonb),
      'hayMas', coalesce(bool_or(rn > v_cantidad), false),
      'cursor', (
        select jsonb_build_object('categoriaNombre', n.categoria_nombre, 'nombre', n.nombre, 'id', n.id)
        from numerado n where n.rn <= v_cantidad order by n.rn desc limit 1
      )
    ) into v_resultado
    from numerado;
  end if;

  return v_resultado;
end;
$function$;

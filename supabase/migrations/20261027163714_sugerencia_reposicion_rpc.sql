create or replace function inventario.fn_sugerencia_reposicion(
  p_busqueda_nombre text default null,
  p_busqueda_codigo text default null,
  p_proveedor_id bigint default null,
  p_bodega_id bigint default null,
  p_orden text default 'proveedor',
  p_direccion text default 'asc',
  p_desde integer default 0,
  p_cantidad integer default 50
)
returns table (
  producto_id bigint,
  codigo text,
  nombre text,
  bodega_id bigint,
  bodega_nombre text,
  existencia numeric,
  nivel_minimo numeric,
  sugerida numeric,
  proveedor_id bigint,
  proveedor_nombre text,
  costo_unitario numeric,
  total bigint
)
language sql
stable
set search_path = ''
as $function$
  with alertas as (
    -- Caso A: producto SIN NivelMinimoBodega propio -> regla global contra
    -- la existencia TOTAL (todas las bodegas sumadas, o Producto.existencia
    -- si todavia no tiene ningun registro en ExistenciaBodega) -- mismo
    -- criterio que existenciaTotal()/alertasStockBajo() en producto.util.ts.
    select
      p.id as producto_id,
      null::bigint as bodega_id,
      coalesce(eb_sum.total_existencia, p.existencia) as existencia,
      p.nivel_minimo as nivel_minimo
    from inventario.producto p
    left join lateral (
      select sum(e.existencia) as total_existencia
      from inventario.existencia_bodega e
      where e.producto_id = p.id
    ) eb_sum on true
    where p.empresa_id = privado.empresa_actual_id()
      and p.activo = true
      and p.existencia is not null
      and p.nivel_minimo is not null
      and not exists (
        select 1 from inventario.nivel_minimo_bodega n where n.producto_id = p.id
      )
      and coalesce(eb_sum.total_existencia, p.existencia) < p.nivel_minimo

    union all

    -- Caso B: producto CON NivelMinimoBodega propio -> una alerta por cada
    -- bodega cuyo minimo especifico no se cumple.
    select
      p.id as producto_id,
      n.bodega_id,
      coalesce(e.existencia, 0) as existencia,
      n.nivel_minimo
    from inventario.producto p
    join inventario.nivel_minimo_bodega n on n.producto_id = p.id
    left join inventario.existencia_bodega e on e.producto_id = p.id and e.bodega_id = n.bodega_id
    where p.empresa_id = privado.empresa_actual_id()
      and p.activo = true
      and p.existencia is not null
      and coalesce(e.existencia, 0) < n.nivel_minimo
  ),
  enriquecido as (
    select
      a.producto_id,
      p.codigo,
      p.nombre,
      a.bodega_id,
      coalesce(b.nombre, 'Todas (sin mínimo por bodega)') as bodega_nombre,
      a.existencia,
      a.nivel_minimo,
      greatest(a.nivel_minimo * 2 - a.existencia, 1) as sugerida,
      coalesce(pp.proveedor_id, p.proveedor_id) as proveedor_id,
      coalesce(pr.nombre, 'Sin proveedor asignado') as proveedor_nombre,
      coalesce(pp.precio_compra, p.costo) as costo_unitario
    from alertas a
    join inventario.producto p on p.id = a.producto_id
    left join inventario.bodega b on b.id = a.bodega_id
    left join inventario.producto_proveedor pp on pp.producto_id = a.producto_id and pp.preferido = true
    left join inventario.proveedor pr on pr.id = coalesce(pp.proveedor_id, p.proveedor_id)
  )
  select
    producto_id, codigo, nombre, bodega_id, bodega_nombre, existencia, nivel_minimo, sugerida,
    proveedor_id, proveedor_nombre, costo_unitario,
    count(*) over() as total
  from enriquecido
  where
    (p_busqueda_nombre is null or p_busqueda_nombre = '' or nombre ilike '%' || p_busqueda_nombre || '%')
    and (p_busqueda_codigo is null or p_busqueda_codigo = '' or codigo ilike '%' || p_busqueda_codigo || '%')
    and (p_proveedor_id is null or proveedor_id = p_proveedor_id)
    and (p_bodega_id is null or bodega_id = p_bodega_id)
  order by
    case when p_orden = 'codigo' and p_direccion = 'asc' then codigo end asc nulls last,
    case when p_orden = 'codigo' and p_direccion = 'desc' then codigo end desc nulls last,
    case when p_orden = 'nombre' and p_direccion = 'asc' then nombre end asc nulls last,
    case when p_orden = 'nombre' and p_direccion = 'desc' then nombre end desc nulls last,
    case when p_orden = 'existencia' and p_direccion = 'asc' then existencia end asc nulls last,
    case when p_orden = 'existencia' and p_direccion = 'desc' then existencia end desc nulls last,
    case when p_orden = 'minimo' and p_direccion = 'asc' then nivel_minimo end asc nulls last,
    case when p_orden = 'minimo' and p_direccion = 'desc' then nivel_minimo end desc nulls last,
    case when p_orden = 'sugerido' and p_direccion = 'asc' then sugerida end asc nulls last,
    case when p_orden = 'sugerido' and p_direccion = 'desc' then sugerida end desc nulls last,
    proveedor_nombre asc,
    nivel_minimo desc
  offset greatest(0, p_desde)
  limit least(greatest(1, p_cantidad), 10000);
$function$;

create or replace function inventario.fn_sugerencia_reposicion_total()
returns bigint
language sql
stable
set search_path = ''
as $function$
  with alertas as (
    select p.id as producto_id
    from inventario.producto p
    left join lateral (
      select sum(e.existencia) as total_existencia
      from inventario.existencia_bodega e
      where e.producto_id = p.id
    ) eb_sum on true
    where p.empresa_id = privado.empresa_actual_id()
      and p.activo = true
      and p.existencia is not null
      and p.nivel_minimo is not null
      and not exists (select 1 from inventario.nivel_minimo_bodega n where n.producto_id = p.id)
      and coalesce(eb_sum.total_existencia, p.existencia) < p.nivel_minimo

    union all

    select p.id as producto_id
    from inventario.producto p
    join inventario.nivel_minimo_bodega n on n.producto_id = p.id
    left join inventario.existencia_bodega e on e.producto_id = p.id and e.bodega_id = n.bodega_id
    where p.empresa_id = privado.empresa_actual_id()
      and p.activo = true
      and p.existencia is not null
      and coalesce(e.existencia, 0) < n.nivel_minimo
  )
  select count(*) from alertas;
$function$;
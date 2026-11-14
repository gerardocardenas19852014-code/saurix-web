
create or replace function inventario.fn_evaluar_stock_bajo_bodega(p_producto_id bigint, p_bodega_id bigint)
returns table (candidato boolean, existencia numeric, nivel_minimo numeric, empresa_id bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (coalesce(eb.existencia, 0) < n.nivel_minimo) as candidato,
    coalesce(eb.existencia, 0) as existencia,
    n.nivel_minimo,
    pr.empresa_id
  from inventario.nivel_minimo_bodega n
  join inventario.producto pr on pr.id = n.producto_id
  left join inventario.existencia_bodega eb
    on eb.producto_id = n.producto_id and eb.bodega_id = n.bodega_id
  where n.producto_id = p_producto_id
    and n.bodega_id = p_bodega_id
    and pr.activo
    and pr.existencia is not null;
$$;

revoke all on function inventario.fn_evaluar_stock_bajo_bodega(bigint, bigint) from public, anon, authenticated;

create or replace function inventario.fn_evaluar_stock_bajo_global(p_producto_id bigint)
returns table (candidato boolean, existencia numeric, nivel_minimo numeric, empresa_id bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (pr.nivel_minimo is not null and coalesce(epr.existencia_total, pr.existencia, 0) < pr.nivel_minimo) as candidato,
    coalesce(epr.existencia_total, pr.existencia, 0) as existencia,
    pr.nivel_minimo,
    pr.empresa_id
  from inventario.producto pr
  left join inventario.existencia_producto_resumen epr on epr.producto_id = pr.id
  where pr.id = p_producto_id
    and pr.activo
    and pr.existencia is not null
    and not exists (select 1 from inventario.nivel_minimo_bodega n where n.producto_id = pr.id);
$$;

revoke all on function inventario.fn_evaluar_stock_bajo_global(bigint) from public, anon, authenticated;

create or replace function inventario.fn_evaluar_producto_stock_bajo(p_producto_id bigint)
returns table (bodega_id bigint, candidato boolean, existencia numeric, nivel_minimo numeric, usuarios_notificados bigint)
language sql
security definer
set search_path = ''
as $$
  with bodegas as (
    select n.bodega_id, e.candidato, e.existencia, e.nivel_minimo
    from inventario.nivel_minimo_bodega n
    cross join lateral inventario.fn_evaluar_stock_bajo_bodega(p_producto_id, n.bodega_id) e
    where n.producto_id = p_producto_id
  ),
  global as (
    select null::bigint as bodega_id, e.candidato, e.existencia, e.nivel_minimo
    from inventario.fn_evaluar_stock_bajo_global(p_producto_id) e
  ),
  todos as (
    select * from bodegas
    union all
    select * from global
  )
  select
    t.bodega_id,
    t.candidato,
    t.existencia,
    t.nivel_minimo,
    case when t.candidato
      then (select count(*) from inventario.fn_generar_avisos_stock_bajo(p_producto_id, t.bodega_id, t.existencia, t.nivel_minimo))
      else 0::bigint
    end as usuarios_notificados
  from todos t;
$$;

revoke all on function inventario.fn_evaluar_producto_stock_bajo(bigint) from public, anon, authenticated;

-- Corrige inventario.fn_valor_stock_productos (migración 48): dentro de un
-- literal con comillas de dólar ($q$ ... $q$) las comillas simples NO se
-- duplican (esa convención es solo para literales delimitados con ' ' ).
-- Había quedado '' sin_existencia '' (dos comillas simples + texto + dos
-- comillas simples), que Postgres interpreta como el literal vacío ''
-- seguido de un identificador suelto -> error de sintaxis al ejecutar el
-- EXECUTE (detectado en la prueba de humo inmediatamente después de
-- aplicar la migración 48, antes de tocar el código Angular).
create or replace function inventario.fn_valor_stock_productos(
  p_busqueda text default null,
  p_categoria_id bigint default null,
  p_bodega_id bigint default null,
  p_estado text default null,
  p_orden text default 'nombre',
  p_direccion text default 'asc',
  p_desde integer default 0,
  p_cantidad integer default 50
)
returns table (
  producto_id bigint,
  codigo text,
  nombre text,
  categoria_id bigint,
  categoria_nombre text,
  existencia numeric,
  costo numeric,
  valor numeric,
  stock_bajo boolean,
  sobre_stock boolean,
  total bigint
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_orden text;
  v_direccion text;
begin
  v_orden := case p_orden
    when 'codigo' then 'codigo'
    when 'existencia' then 'existencia'
    when 'costo' then 'costo'
    when 'valor' then 'valor'
    else 'nombre'
  end;
  v_direccion := case when lower(coalesce(p_direccion, 'asc')) = 'desc' then 'desc' else 'asc' end;

  return query execute format(
    $q$
    with existencia_agg as (
      select producto_id, sum(existencia) as existencia_total
      from inventario.existencia_bodega
      where empresa_id = privado.empresa_actual_id()
      group by producto_id
    ),
    nmb_bajo_agg as (
      select n.producto_id, bool_or(coalesce(e.existencia, 0) < n.nivel_minimo) as bajo
      from inventario.nivel_minimo_bodega n
      left join inventario.existencia_bodega e
        on e.producto_id = n.producto_id and e.bodega_id = n.bodega_id
      where n.empresa_id = privado.empresa_actual_id()
      group by n.producto_id
    ),
    base as (
      select
        p.id as producto_id,
        p.codigo,
        p.nombre,
        p.categoria_producto_id as categoria_id,
        c.nombre as categoria_nombre,
        coalesce(ea.existencia_total, p.existencia, 0) as existencia,
        p.costo,
        coalesce(ea.existencia_total, p.existencia, 0) * p.costo as valor,
        case
          when nb.producto_id is not null then coalesce(nb.bajo, false)
          when p.nivel_minimo is not null then coalesce(ea.existencia_total, p.existencia, 0) < p.nivel_minimo
          else false
        end as stock_bajo,
        (p.nivel_maximo is not null and coalesce(ea.existencia_total, p.existencia, 0) > p.nivel_maximo) as sobre_stock
      from inventario.producto p
      join inventario.categoria_producto c on c.id = p.categoria_producto_id
      left join existencia_agg ea on ea.producto_id = p.id
      left join nmb_bajo_agg nb on nb.producto_id = p.id
      where p.empresa_id = privado.empresa_actual_id()
        and p.activo
        and p.existencia is not null
        and ($1 is null or p.nombre ilike '%%' || $1 || '%%' or p.codigo ilike '%%' || $1 || '%%')
        and ($2 is null or p.categoria_producto_id = $2)
        and ($3 is null or exists (
          select 1 from inventario.existencia_bodega eb
          where eb.producto_id = p.id and eb.bodega_id = $3
        ))
    )
    select *, count(*) over() as total
    from base
    where
      case $4
        when 'sin_existencia' then existencia = 0
        when 'stock_bajo' then stock_bajo
        when 'sobre_stock' then sobre_stock
        else true
      end
    order by %I %s, producto_id asc
    limit $5 offset $6
    $q$,
    v_orden, v_direccion
  )
  using nullif(trim(p_busqueda), ''), p_categoria_id, p_bodega_id, nullif(p_estado, ''), p_cantidad, p_desde;
end;
$$;

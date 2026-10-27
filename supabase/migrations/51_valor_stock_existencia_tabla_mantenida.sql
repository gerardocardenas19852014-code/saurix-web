-- Segundo hallazgo de la validación a escala (mismo lote de prueba:
-- 200,005 productos + 1,500,007 movimientos + 100,005 asignaciones de
-- existencia_bodega): las 5 funciones de Valor de stock recalculan, en
-- CADA llamada, un GROUP BY producto_id sobre TODA existencia_bodega
-- (vía la CTE existencia_agg) solo para saber la existencia total de los
-- productos de la empresa — un costo de ~1.0-1.5s por llamada medido con
-- EXPLAIN ANALYZE, repetido sin necesidad en cada cambio de página,
-- filtro u orden, aunque el resultado final solo muestre 25-50 filas.
--
-- Mismo patrón que la migración 50 (tabla resumen mantenida por trigger),
-- aplicado ahora a existencia_bodega: inventario.existencia_producto_resumen
-- (1 fila por producto con AL MENOS una asignación de bodega, nunca por
-- fila de existencia_bodega), acotada por catálogo de productos, no por
-- cuántas bodegas/asignaciones existan. El trigger recalcula desde cero
-- la suma de ESE producto (barato: usa el índice único existente
-- existencia_bodega_producto_id_bodega_id_key, que ya empieza por
-- producto_id) — igual que en la migración 50, nunca SECURITY DEFINER.
--
-- Importante: se distingue "0 filas en existencia_bodega" (sin bodega
-- asignada -> cae al Producto.existencia heredado) de "filas en
-- existencia_bodega que suman 0" (SÍ tiene bodega asignada, solo que está
-- vacía -> existencia_total debe quedar en 0, NO heredar). Por eso el
-- trigger borra la fila resumen según COUNT(*) = 0, nunca según
-- SUM(existencia) = 0.

create table if not exists inventario.existencia_producto_resumen (
  producto_id bigint primary key references inventario.producto (id) on delete cascade,
  empresa_id bigint not null,
  existencia_total numeric not null default 0
);

alter table inventario.existencia_producto_resumen enable row level security;

create policy compartida_todo on inventario.existencia_producto_resumen
  for all
  using ((select privado.usuario_actual_id()) is not null)
  with check ((select privado.usuario_actual_id()) is not null);

create policy modulo_habilitado on inventario.existencia_producto_resumen
  for all
  using ((select privado.modulo_habilitado('inventario')))
  with check ((select privado.modulo_habilitado('inventario')));

create policy solo_mi_empresa on inventario.existencia_producto_resumen
  for all
  using (empresa_id = (select privado.empresa_actual_id()))
  with check (empresa_id = (select privado.empresa_actual_id()));

create index if not exists existencia_producto_resumen_empresa_ix
  on inventario.existencia_producto_resumen (empresa_id);

-- Backfill único.
insert into inventario.existencia_producto_resumen (producto_id, empresa_id, existencia_total)
select producto_id, empresa_id, sum(existencia)
from inventario.existencia_bodega
group by producto_id, empresa_id
on conflict (producto_id) do update
  set existencia_total = excluded.existencia_total, empresa_id = excluded.empresa_id;

create or replace function inventario.fn_actualizar_existencia_producto_resumen()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_producto_id bigint;
  v_empresa_id bigint;
  v_cantidad bigint;
  v_suma numeric;
begin
  if tg_op = 'DELETE' then
    v_producto_id := old.producto_id;
    v_empresa_id := old.empresa_id;
  else
    v_producto_id := new.producto_id;
    v_empresa_id := new.empresa_id;
  end if;

  select count(*), coalesce(sum(existencia), 0) into v_cantidad, v_suma
  from inventario.existencia_bodega
  where producto_id = v_producto_id;

  if v_cantidad = 0 then
    delete from inventario.existencia_producto_resumen where producto_id = v_producto_id;
  else
    insert into inventario.existencia_producto_resumen (producto_id, empresa_id, existencia_total)
    values (v_producto_id, v_empresa_id, v_suma)
    on conflict (producto_id) do update
      set existencia_total = excluded.existencia_total, empresa_id = excluded.empresa_id;
  end if;

  if tg_op = 'UPDATE' and old.producto_id is distinct from new.producto_id then
    select count(*), coalesce(sum(existencia), 0) into v_cantidad, v_suma
    from inventario.existencia_bodega
    where producto_id = old.producto_id;

    if v_cantidad = 0 then
      delete from inventario.existencia_producto_resumen where producto_id = old.producto_id;
    else
      insert into inventario.existencia_producto_resumen (producto_id, empresa_id, existencia_total)
      values (old.producto_id, old.empresa_id, v_suma)
      on conflict (producto_id) do update
        set existencia_total = excluded.existencia_total, empresa_id = excluded.empresa_id;
    end if;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_actualizar_existencia_producto_resumen on inventario.existencia_bodega;
create trigger trg_actualizar_existencia_producto_resumen
  after insert or update or delete on inventario.existencia_bodega
  for each row execute function inventario.fn_actualizar_existencia_producto_resumen();

-- ───────────────────────── Funciones: usan la tabla resumen ──────────────

create or replace function inventario.fn_valor_stock_resumen()
returns table (
  valor_costo numeric,
  valor_venta numeric,
  margen numeric,
  total_productos bigint,
  sin_existencia bigint,
  stock_bajo bigint,
  sobre_stock bigint
)
language sql
stable
set search_path = ''
as $$
  with nmb_bajo_agg as (
    select n.producto_id, bool_or(coalesce(e.existencia, 0) < n.nivel_minimo) as bajo
    from inventario.nivel_minimo_bodega n
    left join inventario.existencia_bodega e
      on e.producto_id = n.producto_id and e.bodega_id = n.bodega_id
    where n.empresa_id = privado.empresa_actual_id()
    group by n.producto_id
  ),
  base as (
    select
      p.id,
      p.costo,
      p.precio_unitario,
      p.nivel_minimo,
      p.nivel_maximo,
      coalesce(ea.existencia_total, p.existencia, 0) as existencia,
      (nb.producto_id is not null) as tiene_nmb,
      coalesce(nb.bajo, false) as nmb_bajo
    from inventario.producto p
    left join inventario.existencia_producto_resumen ea
      on ea.producto_id = p.id and ea.empresa_id = privado.empresa_actual_id()
    left join nmb_bajo_agg nb on nb.producto_id = p.id
    where p.empresa_id = privado.empresa_actual_id()
      and p.activo
      and p.existencia is not null
  )
  select
    coalesce(sum(existencia * costo), 0)::numeric as valor_costo,
    coalesce(sum(existencia * precio_unitario), 0)::numeric as valor_venta,
    (coalesce(sum(existencia * precio_unitario), 0) - coalesce(sum(existencia * costo), 0))::numeric as margen,
    count(*) as total_productos,
    count(*) filter (where existencia = 0) as sin_existencia,
    count(*) filter (
      where case
        when tiene_nmb then nmb_bajo
        when nivel_minimo is not null then existencia < nivel_minimo
        else false
      end
    ) as stock_bajo,
    count(*) filter (where nivel_maximo is not null and existencia > nivel_maximo) as sobre_stock
  from base;
$$;

create or replace function inventario.fn_valor_stock_por_categoria()
returns table (
  categoria_id bigint,
  categoria_nombre text,
  valor numeric,
  pct numeric
)
language sql
stable
set search_path = ''
as $$
  with base as (
    select
      p.categoria_producto_id as categoria_id,
      coalesce(ea.existencia_total, p.existencia, 0) * p.costo as valor
    from inventario.producto p
    left join inventario.existencia_producto_resumen ea
      on ea.producto_id = p.id and ea.empresa_id = privado.empresa_actual_id()
    where p.empresa_id = privado.empresa_actual_id()
      and p.activo
      and p.existencia is not null
  ),
  por_cat as (
    select categoria_id, sum(valor) as valor
    from base
    group by categoria_id
  ),
  total as (
    select coalesce(sum(valor), 0) as total from por_cat
  )
  select
    c.id as categoria_id,
    c.nombre as categoria_nombre,
    pc.valor,
    case when t.total > 0 then (pc.valor / t.total) * 100 else 0 end as pct
  from por_cat pc
  join inventario.categoria_producto c on c.id = pc.categoria_id
  cross join total t
  order by pc.valor desc;
$$;

create or replace function inventario.fn_valor_stock_por_bodega()
returns table (
  bodega_id bigint,
  bodega_nombre text,
  valor numeric,
  pct numeric
)
language sql
stable
set search_path = ''
as $$
  with total as (
    select coalesce(sum(coalesce(ea.existencia_total, p.existencia, 0) * p.costo), 0) as total
    from inventario.producto p
    left join inventario.existencia_producto_resumen ea
      on ea.producto_id = p.id and ea.empresa_id = privado.empresa_actual_id()
    where p.empresa_id = privado.empresa_actual_id()
      and p.activo
      and p.existencia is not null
  ),
  por_bodega as (
    select e.bodega_id, sum(e.existencia * p.costo) as valor
    from inventario.existencia_bodega e
    join inventario.producto p
      on p.id = e.producto_id
      and p.empresa_id = privado.empresa_actual_id()
      and p.activo
      and p.existencia is not null
    where e.empresa_id = privado.empresa_actual_id()
    group by e.bodega_id
  ),
  asignado as (
    select coalesce(sum(valor), 0) as valor from por_bodega
  )
  select bo.id as bodega_id, bo.nombre as bodega_nombre, pb.valor,
    case when t.total > 0 then (pb.valor / t.total) * 100 else 0 end as pct
  from por_bodega pb
  join inventario.bodega bo on bo.id = pb.bodega_id
  cross join total t
  union all
  select null::bigint, 'Sin bodega asignada', greatest(t.total - a.valor, 0),
    case when t.total > 0 then (greatest(t.total - a.valor, 0) / t.total) * 100 else 0 end
  from total t cross join asignado a
  where greatest(t.total - a.valor, 0) > 0
  order by valor desc;
$$;

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
    with nmb_bajo_agg as (
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
      left join inventario.existencia_producto_resumen ea
        on ea.producto_id = p.id and ea.empresa_id = privado.empresa_actual_id()
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

create or replace function inventario.fn_valor_stock_rotacion(
  p_umbral_dias integer default 60,
  p_desde integer default 0,
  p_cantidad integer default 50
)
returns table (
  producto_id bigint,
  codigo text,
  nombre text,
  existencia numeric,
  ultimo_movimiento date,
  dias_sin_movimiento integer,
  total bigint
)
language sql
stable
set search_path = ''
as $$
  with base as (
    select
      p.id as producto_id,
      p.codigo,
      p.nombre,
      coalesce(ea.existencia_total, p.existencia, 0) as existencia,
      u.ultima_fecha as ultimo_movimiento,
      case when u.ultima_fecha is null then null else (current_date - u.ultima_fecha) end as dias_sin_movimiento
    from inventario.producto p
    left join inventario.existencia_producto_resumen ea
      on ea.producto_id = p.id and ea.empresa_id = privado.empresa_actual_id()
    left join inventario.ultimo_movimiento_producto u
      on u.producto_id = p.id and u.empresa_id = privado.empresa_actual_id()
    where p.empresa_id = privado.empresa_actual_id()
      and p.activo
      and p.existencia is not null
  )
  select producto_id, codigo, nombre, existencia, ultimo_movimiento, dias_sin_movimiento,
    count(*) over() as total
  from base
  where ultimo_movimiento is null or dias_sin_movimiento >= p_umbral_dias
  order by ultimo_movimiento asc nulls first, producto_id asc
  limit p_cantidad offset p_desde;
$$;

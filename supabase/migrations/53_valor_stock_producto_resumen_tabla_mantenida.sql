-- Migración 53: tabla resumen mantenida por trigger para Valor de stock
-- (resumen/tarjetas, por categoría, por bodega).
--
-- Motivo: en producción, con la empresa de prueba a escala (200,005
-- productos activos valorizables), fn_valor_stock_resumen/por_categoria/
-- por_bodega volvían a unir producto + existencia_producto_resumen +
-- nivel_minimo_bodega/existencia_bodega EN CADA LLAMADA. Bajo el rol
-- `authenticated` real (statement_timeout=8s) y con caché fría, esto medía
-- hasta ~7.2s por llamada — y al dispararse las 3 en paralelo desde el
-- componente (Promise.all), la contención hizo que Postgres cancelara las
-- consultas por timeout (500 Internal Server Error visto en el navegador).
--
-- Solución: aplicar el mismo patrón ya usado en las migraciones 50 y 51
-- (tabla resumen de 1 fila por producto, mantenida por trigger que
-- recalcula SOLO el producto afectado) para precomputar, por producto,
-- exactamente lo que resumen/por_categoria necesitan: valor a costo, valor
-- a venta y los 3 flags de alerta. Así esas dos funciones ya no repiten el
-- join con nivel_minimo_bodega/existencia_bodega en cada llamada — ese
-- cómputo se mueve al trigger, que solo corre cuando algo relevante
-- cambia para ESE producto (igual de barato que en 50/51).
--
-- por_bodega sigue necesitando el grano por bodega (un producto puede
-- repartir su existencia entre varias bodegas), así que no se puede
-- colapsar a esta tabla de 1-fila-por-producto; pero se reescribe para
-- unir contra esta tabla (ya filtrada a "activo y valorizable", con el
-- costo ya ahí) en vez de contra producto crudo, evitando repetir esos
-- filtros y el cálculo de "total" vía un segundo join completo.

create table inventario.producto_valor_resumen (
  producto_id bigint primary key references inventario.producto(id) on delete cascade,
  empresa_id bigint not null,
  categoria_id bigint,
  costo numeric not null default 0,
  precio_unitario numeric not null default 0,
  existencia numeric not null default 0,
  valor_costo numeric not null default 0,
  valor_venta numeric not null default 0,
  es_sin_existencia boolean not null default false,
  es_stock_bajo boolean not null default false,
  es_sobre_stock boolean not null default false
);

alter table inventario.producto_valor_resumen enable row level security;

create policy compartida_todo on inventario.producto_valor_resumen
  for all
  using (privado.usuario_actual_id() is not null)
  with check (privado.usuario_actual_id() is not null);

create policy modulo_habilitado on inventario.producto_valor_resumen
  for all
  using (privado.modulo_habilitado('inventario'))
  with check (privado.modulo_habilitado('inventario'));

create policy solo_mi_empresa on inventario.producto_valor_resumen
  for all
  using (empresa_id = privado.empresa_actual_id())
  with check (empresa_id = privado.empresa_actual_id());

create index producto_valor_resumen_empresa_categoria_ix
  on inventario.producto_valor_resumen (empresa_id, categoria_id);

-- Recalcula (o elimina) la fila de UN producto. Nunca SECURITY DEFINER:
-- corre con los permisos de quien dispara el trigger (el mismo patrón que
-- fn_actualizar_ultimo_movimiento_producto / fn_actualizar_existencia_
-- producto_resumen de las migraciones 50 y 51).
create or replace function inventario.fn_recalcular_producto_valor_resumen(p_producto_id bigint)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_empresa_id bigint;
  v_categoria_id bigint;
  v_costo numeric;
  v_precio numeric;
  v_nivel_minimo numeric;
  v_nivel_maximo numeric;
  v_activo boolean;
  v_existencia_base numeric;
  v_existencia numeric;
  v_tiene_nmb boolean;
  v_nmb_bajo boolean;
begin
  select p.empresa_id, p.categoria_producto_id, p.costo, p.precio_unitario,
         p.nivel_minimo, p.nivel_maximo, p.activo, p.existencia
    into v_empresa_id, v_categoria_id, v_costo, v_precio, v_nivel_minimo, v_nivel_maximo, v_activo, v_existencia_base
  from inventario.producto p
  where p.id = p_producto_id;

  if v_empresa_id is null or not v_activo or v_existencia_base is null then
    delete from inventario.producto_valor_resumen where producto_id = p_producto_id;
    return;
  end if;

  select coalesce(epr.existencia_total, v_existencia_base, 0)
    into v_existencia
  from inventario.existencia_producto_resumen epr
  where epr.producto_id = p_producto_id;

  if v_existencia is null then
    v_existencia := coalesce(v_existencia_base, 0);
  end if;

  select exists(select 1 from inventario.nivel_minimo_bodega n where n.producto_id = p_producto_id)
    into v_tiene_nmb;

  if v_tiene_nmb then
    select coalesce(bool_or(coalesce(e.existencia, 0) < n.nivel_minimo), false)
      into v_nmb_bajo
    from inventario.nivel_minimo_bodega n
    left join inventario.existencia_bodega e
      on e.producto_id = n.producto_id and e.bodega_id = n.bodega_id
    where n.producto_id = p_producto_id;
  else
    v_nmb_bajo := false;
  end if;

  insert into inventario.producto_valor_resumen (
    producto_id, empresa_id, categoria_id, costo, precio_unitario, existencia,
    valor_costo, valor_venta, es_sin_existencia, es_stock_bajo, es_sobre_stock
  ) values (
    p_producto_id, v_empresa_id, v_categoria_id, v_costo, v_precio, v_existencia,
    v_existencia * v_costo, v_existencia * v_precio,
    v_existencia = 0,
    case
      when v_tiene_nmb then v_nmb_bajo
      when v_nivel_minimo is not null then v_existencia < v_nivel_minimo
      else false
    end,
    (v_nivel_maximo is not null and v_existencia > v_nivel_maximo)
  )
  on conflict (producto_id) do update set
    empresa_id = excluded.empresa_id,
    categoria_id = excluded.categoria_id,
    costo = excluded.costo,
    precio_unitario = excluded.precio_unitario,
    existencia = excluded.existencia,
    valor_costo = excluded.valor_costo,
    valor_venta = excluded.valor_venta,
    es_sin_existencia = excluded.es_sin_existencia,
    es_stock_bajo = excluded.es_stock_bajo,
    es_sobre_stock = excluded.es_sobre_stock;
end;
$$;

create or replace function inventario.fn_trigger_producto_valor_resumen_desde_producto()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform inventario.fn_recalcular_producto_valor_resumen(new.id);
  return new;
end;
$$;

create or replace function inventario.fn_trigger_producto_valor_resumen_desde_otra_tabla()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform inventario.fn_recalcular_producto_valor_resumen(coalesce(new.producto_id, old.producto_id));
  return coalesce(new, old);
end;
$$;

create trigger trg_producto_valor_resumen_desde_producto
  after insert or update on inventario.producto
  for each row
  execute function inventario.fn_trigger_producto_valor_resumen_desde_producto();

create trigger trg_producto_valor_resumen_desde_existencia
  after insert or update or delete on inventario.existencia_producto_resumen
  for each row
  execute function inventario.fn_trigger_producto_valor_resumen_desde_otra_tabla();

create trigger trg_producto_valor_resumen_desde_nivel_minimo
  after insert or update or delete on inventario.nivel_minimo_bodega
  for each row
  execute function inventario.fn_trigger_producto_valor_resumen_desde_otra_tabla();

-- Backfill único: una pasada sobre el catálogo actual (mismo costo que una
-- llamada a fn_valor_stock_resumen de antes; después de esto, cada cambio
-- real solo recalcula 1 producto).
insert into inventario.producto_valor_resumen (
  producto_id, empresa_id, categoria_id, costo, precio_unitario, existencia,
  valor_costo, valor_venta, es_sin_existencia, es_stock_bajo, es_sobre_stock
)
select
  p.id,
  p.empresa_id,
  p.categoria_producto_id,
  p.costo,
  p.precio_unitario,
  coalesce(ea.existencia_total, p.existencia, 0) as existencia,
  coalesce(ea.existencia_total, p.existencia, 0) * p.costo,
  coalesce(ea.existencia_total, p.existencia, 0) * p.precio_unitario,
  coalesce(ea.existencia_total, p.existencia, 0) = 0,
  case
    when nb.producto_id is not null then coalesce(nb.bajo, false)
    when p.nivel_minimo is not null then coalesce(ea.existencia_total, p.existencia, 0) < p.nivel_minimo
    else false
  end,
  (p.nivel_maximo is not null and coalesce(ea.existencia_total, p.existencia, 0) > p.nivel_maximo)
from inventario.producto p
left join inventario.existencia_producto_resumen ea
  on ea.producto_id = p.id
left join (
  select n.producto_id, bool_or(coalesce(e.existencia, 0) < n.nivel_minimo) as bajo
  from inventario.nivel_minimo_bodega n
  left join inventario.existencia_bodega e
    on e.producto_id = n.producto_id and e.bodega_id = n.bodega_id
  group by n.producto_id
) nb on nb.producto_id = p.id
where p.activo and p.existencia is not null
on conflict (producto_id) do update set
  empresa_id = excluded.empresa_id,
  categoria_id = excluded.categoria_id,
  costo = excluded.costo,
  precio_unitario = excluded.precio_unitario,
  existencia = excluded.existencia,
  valor_costo = excluded.valor_costo,
  valor_venta = excluded.valor_venta,
  es_sin_existencia = excluded.es_sin_existencia,
  es_stock_bajo = excluded.es_stock_bajo,
  es_sobre_stock = excluded.es_sobre_stock;

-- Reescritura de las 3 funciones que estaban fallando por timeout.

create or replace function inventario.fn_valor_stock_resumen()
returns table(
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
  select
    coalesce(sum(pvr.valor_costo), 0)::numeric as valor_costo,
    coalesce(sum(pvr.valor_venta), 0)::numeric as valor_venta,
    (coalesce(sum(pvr.valor_venta), 0) - coalesce(sum(pvr.valor_costo), 0))::numeric as margen,
    count(*) as total_productos,
    count(*) filter (where pvr.es_sin_existencia) as sin_existencia,
    count(*) filter (where pvr.es_stock_bajo) as stock_bajo,
    count(*) filter (where pvr.es_sobre_stock) as sobre_stock
  from inventario.producto_valor_resumen pvr
  where pvr.empresa_id = privado.empresa_actual_id();
$$;

create or replace function inventario.fn_valor_stock_por_categoria()
returns table(categoria_id bigint, categoria_nombre text, valor numeric, pct numeric)
language sql
stable
set search_path = ''
as $$
  with por_cat as (
    select pvr.categoria_id, sum(pvr.valor_costo) as valor
    from inventario.producto_valor_resumen pvr
    where pvr.empresa_id = privado.empresa_actual_id()
    group by pvr.categoria_id
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
returns table(bodega_id bigint, bodega_nombre text, valor numeric, pct numeric)
language sql
stable
set search_path = ''
as $$
  with total as (
    select coalesce(sum(valor_costo), 0) as total
    from inventario.producto_valor_resumen
    where empresa_id = privado.empresa_actual_id()
  ),
  por_bodega as (
    select e.bodega_id, sum(e.existencia * pvr.costo) as valor
    from inventario.existencia_bodega e
    join inventario.producto_valor_resumen pvr
      on pvr.producto_id = e.producto_id
     and pvr.empresa_id = privado.empresa_actual_id()
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

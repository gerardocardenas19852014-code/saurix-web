
create or replace function ventas.fn_dashboard_ventas_resumen(p_hoy date)
returns table (
  ventas_hoy numeric,
  numero_ventas_hoy bigint,
  ticket_promedio_hoy numeric,
  ventas_ayer numeric,
  costo_vendido_hoy numeric,
  margen_bruto_hoy numeric
)
language sql
stable
set search_path to ''
as $function$
  with ventas_hoy_cte as (
    select v.id, v.total
    from ventas.venta v
    where v.estado = 'Completada'
      and v.fecha::date = p_hoy
  ),
  costo_hoy as (
    select coalesce(sum(vi.cantidad * coalesce(p.costo, 0)), 0) as costo
    from ventas.venta_item vi
    join ventas_hoy_cte vh on vh.id = vi.venta_id
    left join inventario.producto p on p.id = vi.producto_id
    where vi.producto_id is not null
  ),
  ventas_ayer_cte as (
    select coalesce(sum(v.total), 0) as total
    from ventas.venta v
    where v.estado = 'Completada'
      and v.fecha::date = p_hoy - 1
  )
  select
    coalesce((select sum(total) from ventas_hoy_cte), 0) as ventas_hoy,
    (select count(*) from ventas_hoy_cte) as numero_ventas_hoy,
    case when (select count(*) from ventas_hoy_cte) > 0
      then coalesce((select sum(total) from ventas_hoy_cte), 0) / (select count(*) from ventas_hoy_cte)
      else 0
    end as ticket_promedio_hoy,
    (select total from ventas_ayer_cte) as ventas_ayer,
    (select costo from costo_hoy) as costo_vendido_hoy,
    coalesce((select sum(total) from ventas_hoy_cte), 0) - (select costo from costo_hoy) as margen_bruto_hoy;
$function$;

create or replace function ventas.fn_dashboard_ventas_metodos_pago(p_desde_fecha date, p_hasta_fecha date)
returns table (metodo_pago text, total numeric)
language sql
stable
set search_path to ''
as $function$
  select vp.metodo_pago, coalesce(sum(vp.monto), 0) as total
  from ventas.venta_pago vp
  join ventas.venta v on v.id = vp.venta_id
  where v.estado = 'Completada'
    and (p_desde_fecha is null or v.fecha::date >= p_desde_fecha)
    and (p_hasta_fecha is null or v.fecha::date <= p_hasta_fecha)
  group by vp.metodo_pago
  order by total desc;
$function$;

create or replace function ventas.fn_dashboard_ventas_canales(p_desde_fecha date, p_hasta_fecha date)
returns table (canal text, total numeric, cantidad bigint)
language sql
stable
set search_path to ''
as $function$
  select
    coalesce(nullif(trim(v.canal), ''), 'Mostrador') as canal,
    coalesce(sum(v.total), 0) as total,
    count(*) as cantidad
  from ventas.venta v
  where v.estado = 'Completada'
    and (p_desde_fecha is null or v.fecha::date >= p_desde_fecha)
    and (p_hasta_fecha is null or v.fecha::date <= p_hasta_fecha)
  group by 1
  order by total desc;
$function$;

create or replace function ventas.fn_dashboard_ventas_top_productos(
  p_dias integer default 30,
  p_desde integer default 0,
  p_cantidad integer default 10
)
returns table (
  posicion bigint,
  producto_id bigint,
  nombre text,
  codigo text,
  cantidad_vendida numeric,
  cantidad_devuelta numeric,
  cantidad_neta numeric,
  importe_neto numeric,
  total_filas bigint
)
language sql
stable
set search_path to ''
as $function$
  with ventas_en_rango as (
    select v.id
    from ventas.venta v
    where v.estado = 'Completada'
      and v.fecha >= (now() - (greatest(1, p_dias) || ' days')::interval)
  ),
  vendido as (
    select vi.producto_id,
      sum(vi.cantidad) as cantidad_vendida,
      sum(vi.subtotal) as importe_vendido
    from ventas.venta_item vi
    join ventas_en_rango ve on ve.id = vi.venta_id
    where vi.producto_id is not null
    group by vi.producto_id
  ),
  devuelto as (
    select di.producto_id,
      sum(di.cantidad) as cantidad_devuelta,
      sum(di.subtotal) as importe_devuelto
    from ventas.devolucion_item di
    join ventas.venta_item vi on vi.id = di.venta_item_id
    join ventas_en_rango ve on ve.id = vi.venta_id
    where di.producto_id is not null
    group by di.producto_id
  ),
  neto as (
    select
      v.producto_id,
      v.cantidad_vendida,
      coalesce(d.cantidad_devuelta, 0) as cantidad_devuelta,
      v.cantidad_vendida - coalesce(d.cantidad_devuelta, 0) as cantidad_neta,
      v.importe_vendido - coalesce(d.importe_devuelto, 0) as importe_neto
    from vendido v
    left join devuelto d on d.producto_id = v.producto_id
  ),
  ranking as (
    select
      row_number() over (order by n.cantidad_neta desc, n.producto_id asc) as posicion,
      n.producto_id,
      p.nombre,
      p.codigo,
      n.cantidad_vendida,
      n.cantidad_devuelta,
      n.cantidad_neta,
      n.importe_neto
    from neto n
    join inventario.producto p on p.id = n.producto_id
    order by n.cantidad_neta desc, n.producto_id asc
    limit 50
  )
  select
    r.posicion, r.producto_id, r.nombre, r.codigo,
    r.cantidad_vendida, r.cantidad_devuelta, r.cantidad_neta, r.importe_neto,
    count(*) over() as total_filas
  from ranking r
  order by r.posicion
  offset greatest(0, p_desde)
  limit greatest(1, p_cantidad);
$function$;

grant execute on function ventas.fn_dashboard_ventas_resumen(date) to authenticated;
grant execute on function ventas.fn_dashboard_ventas_metodos_pago(date, date) to authenticated;
grant execute on function ventas.fn_dashboard_ventas_canales(date, date) to authenticated;
grant execute on function ventas.fn_dashboard_ventas_top_productos(integer, integer, integer) to authenticated;

-- Fase 1 ("Prompt maestro" nov-2026, pendiente "Reporte de comisiones"):
-- ReporteComisionesComponent ya acotaba Venta/Devolucion/DevolucionItem por
-- fecha (server-side, sin descargar tablas completas) pero el CÁLCULO por
-- vendedor (ventas netas, comisión a pagar) se hacía 100% en Angular vía un
-- computed que iteraba TODOS los usuarios activos — sin paginación ni
-- filtro por vendedor. Esta función hace el cálculo completo en PostgreSQL
-- (mismos criterios de negocio que ReporteComisionesComponent.filas(),
-- SIN cambiarlos: Porcentaje = % sobre ventas netas del periodo; MontoFijo
-- = monto fijo por cada venta Completada, sin prorratear por devoluciones
-- parciales), filtra por fecha/vendedor, pagina 20 vendedores por página
-- (ordenados por comisión a pagar DESC) y regresa, además del total real
-- de filas, la suma de comisión de TODOS los vendedores que cumplen el
-- filtro (no solo los de la página) para la tarjeta "Total a pagar".
create or replace function ventas.fn_reporte_comisiones_listar(
  p_desde_fecha date default null,
  p_hasta_fecha date default null,
  p_vendedor_id bigint default null,
  p_desde integer default 0,
  p_cantidad integer default 20
)
returns table (
  usuario_id bigint,
  vendedor_nombre text,
  numero_ventas bigint,
  total_ventas numeric,
  total_devuelto numeric,
  ventas_netas numeric,
  comision_tipo text,
  comision_valor numeric,
  monto_comision numeric,
  total_filas bigint,
  suma_comision_total numeric
)
language sql
stable
set search_path to ''
as $function$
  with ventas_periodo as (
    select
      v.id,
      v.vendedor_usuario_id,
      v.total,
      -- Devuelto de ESTA venta sin importar cuándo se procesó el regreso
      -- (mismo criterio documentado en el componente original).
      coalesce((
        select sum(di.subtotal)
        from ventas.devolucion d
        join ventas.devolucion_item di on di.devolucion_id = d.id
        where d.venta_id = v.id
      ), 0) as devuelto
    from ventas.venta v
    where v.estado = 'Completada'
      and (p_desde_fecha is null or v.fecha::date >= p_desde_fecha)
      and (p_hasta_fecha is null or v.fecha::date <= p_hasta_fecha)
  ),
  por_vendedor as (
    -- Al agrupar ventas_periodo (que YA viene de venta, estado Completada
    -- + rango de fecha) nunca aparece un vendedor sin ventas en el
    -- periodo — equivalente al "filter(numeroVentas > 0)" original.
    select
      vp.vendedor_usuario_id as usuario_id,
      count(*) as numero_ventas,
      sum(vp.total) as total_ventas,
      sum(vp.devuelto) as total_devuelto,
      sum(vp.total) - sum(vp.devuelto) as ventas_netas
    from ventas_periodo vp
    group by vp.vendedor_usuario_id
  ),
  con_comision as (
    select
      u.id as usuario_id,
      u.nombre as vendedor_nombre,
      pv.numero_ventas,
      round(pv.total_ventas, 2) as total_ventas,
      round(pv.total_devuelto, 2) as total_devuelto,
      round(pv.ventas_netas, 2) as ventas_netas,
      cv.tipo as comision_tipo,
      cv.valor as comision_valor,
      round(
        case
          when cv.tipo = 'Porcentaje' then pv.ventas_netas * (cv.valor / 100)
          when cv.tipo = 'MontoFijo' then pv.numero_ventas * cv.valor
          else 0
        end,
        2
      ) as monto_comision
    from por_vendedor pv
    join seguridad.usuario u on u.id = pv.usuario_id
    -- Comisión configurada del vendedor — singleton por usuarioId (ver
    -- ComisionVendedor en comision-vendedor.model.ts); el LATERAL con
    -- LIMIT 1 nunca duplica filas si por algún motivo hubiera más de una.
    left join lateral (
      select c.tipo, c.valor from ventas.comision_vendedor c where c.usuario_id = u.id order by c.id limit 1
    ) cv on true
    where u.activo is not false
      and (p_vendedor_id is null or u.id = p_vendedor_id)
  )
  select
    usuario_id,
    vendedor_nombre,
    numero_ventas,
    total_ventas,
    total_devuelto,
    ventas_netas,
    comision_tipo,
    comision_valor,
    monto_comision,
    count(*) over() as total_filas,
    coalesce(sum(monto_comision) over(), 0) as suma_comision_total
  from con_comision
  order by monto_comision desc, vendedor_nombre asc
  offset greatest(0, p_desde)
  limit greatest(1, p_cantidad);
$function$;
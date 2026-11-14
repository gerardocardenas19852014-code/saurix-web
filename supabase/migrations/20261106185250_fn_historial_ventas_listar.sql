-- Fase 1 ("Prompt maestro" nov-2026, pendiente "Historial de ventas"):
-- HistorialVentasComponent descargaba Venta + Cliente + Usuario COMPLETOS
-- (sin filtro ni paginación) y filtraba/ordenaba todo en memoria. Esta
-- función hace todo el trabajo en PostgreSQL — igual que ya hace
-- inventario.fn_ordenes_compra_listar() para Órdenes de compra — y resuelve
-- también el nombre de cliente/vendedor (join), así el frontend nunca
-- necesita traer esas tablas completas solo para mostrar un nombre.
create or replace function ventas.fn_historial_ventas_listar(
  p_busqueda text default null,
  p_estado text default null,
  p_desde_fecha date default null,
  p_hasta_fecha date default null,
  p_desde integer default 0,
  p_cantidad integer default 20
)
returns table (
  id bigint,
  folio text,
  fecha timestamptz,
  cliente_id bigint,
  cliente_nombre text,
  vendedor_usuario_id bigint,
  vendedor_nombre text,
  total numeric,
  estado text,
  canal text,
  total_filas bigint
)
language sql
stable
set search_path to ''
as $function$
  select
    v.id,
    v.folio,
    v.fecha,
    v.cliente_id,
    c.nombre as cliente_nombre,
    v.vendedor_usuario_id,
    trim(concat_ws(' ', u.nombre, u.apellido_paterno, u.apellido_materno)) as vendedor_nombre,
    v.total,
    v.estado,
    v.canal,
    count(*) over() as total_filas
  from ventas.venta v
  left join ventas.cliente c on c.id = v.cliente_id
  left join seguridad.usuario u on u.id = v.vendedor_usuario_id
  where (
      p_busqueda is null or p_busqueda = ''
      or lower(v.folio) like lower(p_busqueda) || '%'
      or c.nombre ilike '%' || p_busqueda || '%'
    )
    and (p_estado is null or p_estado = '' or v.estado = p_estado)
    and (p_desde_fecha is null or v.fecha::date >= p_desde_fecha)
    and (p_hasta_fecha is null or v.fecha::date <= p_hasta_fecha)
  order by v.fecha desc, v.id desc
  offset greatest(0, p_desde)
  limit greatest(1, p_cantidad);
$function$;
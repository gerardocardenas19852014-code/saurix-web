
create or replace function ventas.fn_pedidos_tienda_listar(
  p_desde_fecha date default null,
  p_hasta_fecha date default null,
  p_estado text default null,
  p_origen text default null,
  p_busqueda text default null,
  p_desde int default 0,
  p_cantidad int default 20
)
returns table (
  id bigint,
  fecha_creacion timestamptz,
  folio text,
  origen text,
  cliente text,
  telefono_cliente text,
  total numeric,
  estado text,
  venta_id bigint,
  total_filas bigint
)
language sql
stable
set search_path to ''
as $function$
  select
    p.id,
    p.fecha_creacion,
    p.folio,
    p.origen,
    coalesce(p.nombre_cliente, p.nombre_mostrar_en, '') as cliente,
    p.telefono_cliente,
    p.total,
    p.estado,
    p.venta_id,
    count(*) over() as total_filas
  from ventas.pedido_tienda p
  where p.activo
    and (p_desde_fecha is null or p.fecha_creacion >= p_desde_fecha)
    and (p_hasta_fecha is null or p.fecha_creacion < (p_hasta_fecha + 1))
    and (p_estado is null or p.estado = p_estado)
    and (p_origen is null or p.origen = p_origen)
    and (
      p_busqueda is null or p_busqueda = '' or
      p.folio ilike '%' || p_busqueda || '%' or
      p.nombre_cliente ilike '%' || p_busqueda || '%' or
      p.nombre_mostrar_en ilike '%' || p_busqueda || '%' or
      p.telefono_cliente ilike '%' || p_busqueda || '%'
    )
  order by p.fecha_creacion desc, p.id desc
  offset greatest(0, p_desde)
  limit greatest(1, p_cantidad);
$function$;

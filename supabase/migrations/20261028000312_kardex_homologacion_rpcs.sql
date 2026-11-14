-- Homologación de Inventario > Kardex (2026-10): autocomplete remoto de
-- producto (con nombre de unidad) + listado paginado del kardex con saldo
-- acumulado matemáticamente correcto (ventana sobre el historial completo
-- del producto, nunca solo sobre la página visible) + resumen de
-- existencia actual/total de movimientos para las tarjetas de estadística.
-- No se crean índices nuevos: la combinación (empresa_id, producto_id,
-- fecha DESC) ya existente en movimiento_inventario_empresa_producto_fecha_ix
-- y los índices trgm/activo ya existentes en producto cubren exactamente
-- los accesos que necesitan estas funciones (ver EXPLAIN ANALYZE en el
-- reporte de cierre). No se modifica ninguna regla contable/de inventario
-- existente: la derivación de tipo (entrada/salida/traspaso) y de delta por
-- bodega es idéntica, instrucción por instrucción, a la que ya tenía
-- kardex.component.ts (incluyendo que un traspaso "en tránsito" no se
-- trata distinto — comportamiento preexistente, no tocado aquí).

create or replace function inventario.fn_kardex_productos_autocomplete(
  p_busqueda text default null,
  p_limite integer default 15
)
returns table (
  id bigint,
  codigo text,
  nombre text,
  unidad_nombre text
)
language sql
stable
set search_path to ''
as $function$
  select p.id, p.codigo, p.nombre, um.nombre
  from inventario.producto p
  left join inventario.unidad_medida um on um.id = p.unidad_medida_id
  where p.activo = true
    and p.existencia is not null
    and (
      p_busqueda is null or p_busqueda = '' or
      p.nombre ilike '%' || p_busqueda || '%' or
      p.codigo ilike '%' || p_busqueda || '%'
    )
  order by p.nombre asc
  limit greatest(1, coalesce(p_limite, 15));
$function$;

create or replace function inventario.fn_kardex_resumen(
  p_producto_id bigint,
  p_bodega_id bigint default null
)
returns table (
  existencia_actual numeric,
  total_movimientos bigint
)
language sql
stable
set search_path to ''
as $function$
  select
    case
      when p_bodega_id is not null then
        coalesce(
          (select eb.existencia from inventario.existencia_bodega eb
             where eb.producto_id = p_producto_id and eb.bodega_id = p_bodega_id),
          0
        )
      else
        coalesce(
          (select sum(eb.existencia) from inventario.existencia_bodega eb where eb.producto_id = p_producto_id),
          (select p.existencia from inventario.producto p where p.id = p_producto_id),
          0
        )
    end as existencia_actual,
    (
      select count(*) from inventario.movimiento_inventario m
      where m.producto_id = p_producto_id
        and (p_bodega_id is null or m.bodega_origen_id = p_bodega_id or m.bodega_destino_id = p_bodega_id)
    ) as total_movimientos;
$function$;

create or replace function inventario.fn_kardex_listar(
  p_producto_id bigint,
  p_bodega_id bigint default null,
  p_tipo text default null,
  p_desde_fecha date default null,
  p_hasta_fecha date default null,
  p_desde integer default 0,
  p_cantidad integer default 20
)
returns table (
  id bigint,
  fecha date,
  tipo text,
  bodega_origen_id bigint,
  origen_nombre text,
  bodega_destino_id bigint,
  destino_nombre text,
  cantidad numeric,
  delta numeric,
  saldo numeric,
  nota text,
  total bigint
)
language sql
stable
set search_path to ''
as $function$
  with propios as (
    select
      m.id, m.fecha, m.bodega_origen_id, m.bodega_destino_id, m.cantidad, m.nota,
      case
        when m.bodega_origen_id is null then 'entrada'
        when m.bodega_destino_id is null then 'salida'
        else 'traspaso'
      end as tipo_calc,
      case
        when p_bodega_id is null then
          case when m.bodega_origen_id is null then m.cantidad
               when m.bodega_destino_id is null then -m.cantidad
               else 0 end
        else
          case when m.bodega_destino_id = p_bodega_id then m.cantidad
               when m.bodega_origen_id = p_bodega_id then -m.cantidad
               else 0 end
      end as delta_calc
    from inventario.movimiento_inventario m
    where m.producto_id = p_producto_id
      and (p_bodega_id is null or m.bodega_origen_id = p_bodega_id or m.bodega_destino_id = p_bodega_id)
  ),
  con_saldo as (
    select
      pr.*,
      sum(pr.delta_calc) over (order by pr.fecha, pr.id) as saldo_calc
    from propios pr
  )
  select
    cs.id, cs.fecha, cs.tipo_calc, cs.bodega_origen_id, bo.nombre, cs.bodega_destino_id, bd.nombre,
    cs.cantidad, cs.delta_calc, cs.saldo_calc, cs.nota,
    count(*) over()
  from con_saldo cs
  left join inventario.bodega bo on bo.id = cs.bodega_origen_id
  left join inventario.bodega bd on bd.id = cs.bodega_destino_id
  where (p_tipo is null or cs.tipo_calc = p_tipo)
    and (p_desde_fecha is null or cs.fecha >= p_desde_fecha)
    and (p_hasta_fecha is null or cs.fecha <= p_hasta_fecha)
  order by cs.fecha desc, cs.id desc
  offset greatest(0, p_desde)
  limit greatest(1, p_cantidad);
$function$;
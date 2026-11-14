
-- Homologación de "Movimientos entre bodegas" (27-oct): las 3 pestañas
-- dejan de cargar Producto/ExistenciaBodega/MovimientoInventario completos
-- (hasta 200k productos / millones de movimientos) y pasan a RPCs
-- paginadas, mismo patrón que inventario.fn_valor_stock_* (ver
-- valor_stock_rpc_indices.sql). SECURITY INVOKER (RLS aplica normal),
-- search_path='' (todas las referencias van calificadas por esquema).

-- Índices nuevos para soportar los filtros/orden de las nuevas RPC.
create index if not exists existencia_bodega_empresa_bodega_ix
  on inventario.existencia_bodega (empresa_id, bodega_id);

create index if not exists movimiento_inventario_empresa_fecha_id_ix
  on inventario.movimiento_inventario (empresa_id, fecha desc, id desc);

-- Pestaña "Existencia por bodega": búsqueda por nombre/código de producto
-- (reutiliza los índices trigram de producto_valor_stock_*), filtro de
-- bodega y "Solo con existencia" (default true = mismo comportamiento que
-- tenía el filtro fijo .filter(e => e.existencia > 0) en el componente).
create or replace function inventario.fn_movimientos_existencia_bodega(
  p_busqueda text default null,
  p_bodega_id bigint default null,
  p_solo_con_existencia boolean default true,
  p_desde int default 0,
  p_cantidad int default 20
)
returns table (
  existencia_id bigint,
  producto_id bigint,
  producto_codigo text,
  producto_nombre text,
  bodega_id bigint,
  bodega_nombre text,
  existencia numeric,
  ubicacion text,
  total bigint
)
language sql
stable
set search_path = ''
as $$
  select
    e.id,
    e.producto_id,
    p.codigo,
    p.nombre,
    e.bodega_id,
    b.nombre,
    e.existencia,
    e.ubicacion,
    count(*) over() as total
  from inventario.existencia_bodega e
  join inventario.producto p on p.id = e.producto_id
  join inventario.bodega b on b.id = e.bodega_id
  where p.activo = true
    and p.existencia is not null
    and (p_bodega_id is null or e.bodega_id = p_bodega_id)
    and (coalesce(p_solo_con_existencia, true) = false or e.existencia > 0)
    and (
      p_busqueda is null or p_busqueda = '' or
      p.nombre ilike '%' || p_busqueda || '%' or
      p.codigo ilike '%' || p_busqueda || '%'
    )
  order by p.nombre asc, b.nombre asc, e.id asc
  offset greatest(0, p_desde)
  limit greatest(1, p_cantidad);
$$;

-- Pestaña "Historial de movimientos": filtros producto/bodega/rango de
-- fecha, orden fecha DESC, id DESC (desempate estable) — ver índice
-- movimiento_inventario_empresa_fecha_id_ix arriba y
-- movimiento_inventario_empresa_producto_fecha_ix (ya existente, cubre el
-- caso con filtro de producto).
create or replace function inventario.fn_movimientos_historial(
  p_producto_id bigint default null,
  p_bodega_id bigint default null,
  p_desde_fecha date default null,
  p_hasta_fecha date default null,
  p_desde int default 0,
  p_cantidad int default 20
)
returns table (
  id bigint,
  fecha date,
  producto_id bigint,
  producto_nombre text,
  producto_codigo text,
  bodega_origen_id bigint,
  origen_nombre text,
  bodega_destino_id bigint,
  destino_nombre text,
  tipo text,
  cantidad numeric,
  nota text,
  en_transito boolean,
  fecha_recepcion timestamptz,
  total bigint
)
language sql
stable
set search_path = ''
as $$
  select
    m.id,
    m.fecha,
    m.producto_id,
    p.nombre,
    p.codigo,
    m.bodega_origen_id,
    bo.nombre,
    m.bodega_destino_id,
    bd.nombre,
    case
      when m.bodega_origen_id is null then 'entrada'
      when m.bodega_destino_id is null then 'salida'
      else 'traspaso'
    end,
    m.cantidad,
    m.nota,
    m.en_transito,
    m.fecha_recepcion,
    count(*) over() as total
  from inventario.movimiento_inventario m
  join inventario.producto p on p.id = m.producto_id
  left join inventario.bodega bo on bo.id = m.bodega_origen_id
  left join inventario.bodega bd on bd.id = m.bodega_destino_id
  where (p_producto_id is null or m.producto_id = p_producto_id)
    and (p_bodega_id is null or m.bodega_origen_id = p_bodega_id or m.bodega_destino_id = p_bodega_id)
    and (p_desde_fecha is null or m.fecha >= p_desde_fecha)
    and (p_hasta_fecha is null or m.fecha <= p_hasta_fecha)
  order by m.fecha desc, m.id desc
  offset greatest(0, p_desde)
  limit greatest(1, p_cantidad);
$$;

-- Pestaña "En tránsito": solo traspasos pendientes de confirmar recepción.
create or replace function inventario.fn_movimientos_transito(
  p_bodega_origen_id bigint default null,
  p_bodega_destino_id bigint default null,
  p_desde int default 0,
  p_cantidad int default 20
)
returns table (
  id bigint,
  fecha date,
  producto_id bigint,
  producto_nombre text,
  producto_codigo text,
  bodega_origen_id bigint,
  origen_nombre text,
  bodega_destino_id bigint,
  destino_nombre text,
  cantidad numeric,
  nota text,
  total bigint
)
language sql
stable
set search_path = ''
as $$
  select
    m.id,
    m.fecha,
    m.producto_id,
    p.nombre,
    p.codigo,
    m.bodega_origen_id,
    bo.nombre,
    m.bodega_destino_id,
    bd.nombre,
    m.cantidad,
    m.nota,
    count(*) over() as total
  from inventario.movimiento_inventario m
  join inventario.producto p on p.id = m.producto_id
  left join inventario.bodega bo on bo.id = m.bodega_origen_id
  left join inventario.bodega bd on bd.id = m.bodega_destino_id
  where m.en_transito = true
    and m.bodega_origen_id is not null
    and m.bodega_destino_id is not null
    and (p_bodega_origen_id is null or m.bodega_origen_id = p_bodega_origen_id)
    and (p_bodega_destino_id is null or m.bodega_destino_id = p_bodega_destino_id)
  order by m.fecha asc, m.id asc
  offset greatest(0, p_desde)
  limit greatest(1, p_cantidad);
$$;

-- Autocomplete remoto de Producto (requerimiento 7): usado por el filtro
-- "Producto" de Historial — nunca descarga el catálogo completo, devuelve
-- como máximo p_limite coincidencias por código o nombre.
create or replace function inventario.fn_productos_autocomplete(
  p_busqueda text,
  p_limite int default 15
)
returns table (
  id bigint,
  codigo text,
  nombre text
)
language sql
stable
set search_path = ''
as $$
  select p.id, p.codigo, p.nombre
  from inventario.producto p
  where p.activo = true
    and p.existencia is not null
    and (
      p_busqueda is null or p_busqueda = '' or
      p.nombre ilike '%' || p_busqueda || '%' or
      p.codigo ilike '%' || p_busqueda || '%'
    )
  order by p.nombre asc
  limit greatest(1, coalesce(p_limite, 15));
$$;

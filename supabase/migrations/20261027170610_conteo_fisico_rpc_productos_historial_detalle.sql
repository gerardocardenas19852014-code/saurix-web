
-- Homologación de Conteo físico / cuadre de inventario (26-oct): "Nuevo
-- conteo" y "Historial de conteos" pasan de cargar todo en memoria a
-- búsqueda server-side paginada, igual que ya hacen Productos y servicios
-- y Movimientos entre bodegas (fn_movimientos_existencia_bodega /
-- fn_movimientos_historial, mismo criterio de diseño).

-- Índice de soporte para el historial ordenado por fecha (requerimiento 16:
-- "fecha DESC, id DESC") sin filtro de bodega (caso "Todas las bodegas",
-- el más común) — conteo_fisico ya tenía bodega_id_ix/empresa_id_ix/usuario_id_ix
-- por separado, pero ninguno cubre el ORDER BY fecha/id directamente; con
-- años de historial acumulado esto evita un sort completo en cada página.
create index if not exists conteo_fisico_empresa_fecha_ix
  on inventario.conteo_fisico (empresa_id, fecha desc, id desc);

-- "Nuevo conteo": productos YA asignados a la bodega elegida (igual regla
-- que hoy — un producto sin bodega asignada no entra), con dos campos de
-- búsqueda independientes (nombre Y código, ambos opcionales, AND entre
-- sí) — mismo criterio que Producto.filtroActual() en productos.component.ts
-- y fn_sugerencia_reposicion (p_busqueda_nombre/p_busqueda_codigo), a
-- diferencia de fn_movimientos_existencia_bodega que usa un solo campo
-- combinado (OR) — aquí la pantalla pide dos cajas separadas. Nunca trae
-- existencias de otras bodegas ni el catálogo completo: el filtro por
-- bodega_id va contra existencia_bodega_empresa_bodega_ix (empresa_id,
-- bodega_id), ya existente. p_solo_con_existencia no aplica aquí a
-- propósito: un conteo también debe poder mostrar/corregir productos que
-- el sistema ya marca en 0 en esa bodega.
create or replace function inventario.fn_conteo_fisico_productos(
  p_bodega_id bigint,
  p_busqueda_nombre text default null,
  p_busqueda_codigo text default null,
  p_desde integer default 0,
  p_cantidad integer default 20
)
returns table (
  producto_id bigint,
  codigo text,
  nombre text,
  existencia numeric,
  total bigint
)
language sql
stable
set search_path = ''
as $$
  select
    p.id,
    p.codigo,
    p.nombre,
    e.existencia,
    count(*) over() as total
  from inventario.existencia_bodega e
  join inventario.producto p on p.id = e.producto_id
  where e.empresa_id = privado.empresa_actual_id()
    and e.bodega_id = p_bodega_id
    and p.activo = true
    and p.existencia is not null
    and (
      p_busqueda_nombre is null or p_busqueda_nombre = '' or
      p.nombre ilike '%' || p_busqueda_nombre || '%'
    )
    and (
      p_busqueda_codigo is null or p_busqueda_codigo = '' or
      p.codigo ilike '%' || p_busqueda_codigo || '%'
    )
  order by p.nombre asc, p.id asc
  offset greatest(0, p_desde)
  limit greatest(1, p_cantidad);
$$;

-- "Historial de conteos": encabezados ya guardados (ConteoFisico), filtrado
-- por bodega/fecha, paginado — nunca trae el historial completo. Se incluye
-- el nombre de quien lo hizo (seguridad.usuario) ya resuelto, para no
-- necesitar cargar el catálogo de usuarios aparte. fecha es timestamptz
-- (a diferencia de movimiento_inventario.fecha, que es date) — el rango se
-- compara con el día completo de p_hasta_fecha (< día siguiente) para no
-- perder conteos hechos esa misma tarde/noche.
create or replace function inventario.fn_conteo_fisico_historial(
  p_bodega_id bigint default null,
  p_desde_fecha date default null,
  p_hasta_fecha date default null,
  p_desde integer default 0,
  p_cantidad integer default 20
)
returns table (
  id bigint,
  fecha timestamptz,
  bodega_id bigint,
  bodega_nombre text,
  usuario_id bigint,
  usuario_nombre text,
  total_productos integer,
  total_diferencias integer,
  notas text,
  total bigint
)
language sql
stable
set search_path = ''
as $$
  select
    c.id,
    c.fecha,
    c.bodega_id,
    b.nombre,
    c.usuario_id,
    trim(concat_ws(' ', u.nombre, u.apellido_paterno, u.apellido_materno)),
    c.total_productos,
    c.total_diferencias,
    c.notas,
    count(*) over() as total
  from inventario.conteo_fisico c
  join inventario.bodega b on b.id = c.bodega_id
  join seguridad.usuario u on u.id = c.usuario_id
  where c.empresa_id = privado.empresa_actual_id()
    and (p_bodega_id is null or c.bodega_id = p_bodega_id)
    and (p_desde_fecha is null or c.fecha >= p_desde_fecha::timestamptz)
    and (p_hasta_fecha is null or c.fecha < (p_hasta_fecha::date + 1)::timestamptz)
  order by c.fecha desc, c.id desc
  offset greatest(0, p_desde)
  limit greatest(1, p_cantidad);
$$;

-- "Ver detalle": SOLO el detalle de UN conteo (nunca junto al listado
-- principal) — usa el índice ya existente conteo_fisico_detalle_conteo_fisico_id_ix.
-- Sin paginar (un conteo físico real, hecho por una persona con un
-- escáner, nunca se acerca a las decenas de miles de líneas que sí
-- justificarían paginar aquí).
create or replace function inventario.fn_conteo_fisico_detalle(
  p_conteo_fisico_id bigint
)
returns table (
  producto_id bigint,
  producto_codigo text,
  producto_nombre text,
  sistema numeric,
  contado numeric,
  diferencia numeric
)
language sql
stable
set search_path = ''
as $$
  select d.producto_id, p.codigo, p.nombre, d.sistema, d.contado, d.diferencia
  from inventario.conteo_fisico_detalle d
  join inventario.producto p on p.id = d.producto_id
  where d.empresa_id = privado.empresa_actual_id()
    and d.conteo_fisico_id = p_conteo_fisico_id
  order by p.nombre asc;
$$;

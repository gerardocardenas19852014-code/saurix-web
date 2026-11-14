-- Homologación del LISTADO de Inventario > Órdenes de compra (27-oct-2026):
-- barra de controles + filtros + paginación server-side, preparado para
-- 200,000+ órdenes históricas. No toca "Nueva orden de compra" ni sus RPCs
-- (fn_ordenes_compra_producto_por_codigo / fn_ordenes_compra_autocomplete_producto /
-- fn_ordenes_compra_productos_por_ids / fn_orden_compra_guardar), que siguen
-- intactas.

-- Índices nuevos ------------------------------------------------------------
-- 1) Orden por defecto (fecha DESC, id DESC como desempate estable) + rango
--    de fechas, ya acotado por empresa — sin esto, cada carga de la lista
--    (sin filtros) obligaría a Postgres a ordenar las 200,000+ filas de la
--    empresa en memoria en cada petición. Ninguno de los índices existentes
--    de orden_compra (empresa_id solo, empresa_id+folio, proveedor_id,
--    bodega_destino_id) cubre este orden.
create index if not exists orden_compra_empresa_fecha_id_ix
  on inventario.orden_compra (empresa_id, fecha desc, id desc);

-- 2) Búsqueda de folio case-insensitive por prefijo ("oc-0002" debe
--    encontrar "OC-0002"). El índice único ya existente
--    (orden_compra_empresa_folio_uk, empresa_id+folio) es case-SENSITIVE y
--    no sirve para una búsqueda insensible a mayúsculas — mismo criterio ya
--    aplicado a producto_codigo_lower_ix en la homologación de "Nueva orden
--    de compra".
create index if not exists orden_compra_empresa_folio_lower_ix
  on inventario.orden_compra (empresa_id, lower(folio));

-- Nota: NO se crea ningún índice nuevo en proveedor.nombre (búsqueda por
-- proveedor) ni en orden_compra.estado — ver razones en el reporte final:
-- el catálogo de proveedores está acotado por la realidad del negocio
-- (decenas/cientos, nunca 200,000+, misma conclusión ya documentada para
-- "Nueva orden de compra"), y estado es una columna de muy baja
-- cardinalidad (4 valores fijos) que no se beneficia de un índice propio.
-- Tampoco se crea ningún índice nuevo en orden_compra_item: ya existe
-- orden_compra_item_orden_compra_id_ix, que es exactamente el que necesita
-- el cálculo de "total" por orden de fn_ordenes_compra_listar() de abajo.

-- Función de listado ---------------------------------------------------------
-- SECURITY INVOKER (default, no DEFINER): corre como el usuario autenticado,
-- las políticas RLS de siempre (solo_mi_empresa/modulo_habilitado/
-- compartida_todo) se siguen aplicando igual que en cualquier SELECT normal
-- — no hace falta filtrar empresa_id a mano en el cuerpo de la función,
-- mismo criterio que fn_movimientos_historial/fn_productos_autocomplete.
create or replace function inventario.fn_ordenes_compra_listar(
  p_busqueda text default null,
  p_proveedor_id bigint default null,
  p_bodega_id bigint default null,
  p_estado text default null,
  p_desde_fecha date default null,
  p_hasta_fecha date default null,
  p_desde integer default 0,
  p_cantidad integer default 20
)
returns table (
  id bigint,
  folio text,
  proveedor_id bigint,
  bodega_destino_id bigint,
  fecha date,
  fecha_entrega_estimada date,
  estado text,
  total numeric,
  total_filas bigint
)
language sql
stable
set search_path = ''
as $$
  select
    o.id,
    o.folio,
    o.proveedor_id,
    o.bodega_destino_id,
    o.fecha,
    o.fecha_entrega_estimada,
    o.estado,
    -- Total de la orden = suma de sus líneas (cantidad * costo_unitario) —
    -- orden_compra NO guarda un total propio (se calcula siempre a partir
    -- de orden_compra_item, igual que hacía el frontend antes de esta
    -- homologación). Subconsulta correlacionada apoyada en el índice ya
    -- existente orden_compra_item_orden_compra_id_ix.
    coalesce((
      select sum(oci.cantidad * oci.costo_unitario)
      from inventario.orden_compra_item oci
      where oci.orden_compra_id = o.id
    ), 0) as total,
    -- Total real de filas que cumplen el filtro (antes de LIMIT/OFFSET) —
    -- para "Página X de Y — N orden(es)" sin una segunda consulta de conteo.
    count(*) over() as total_filas
  from inventario.orden_compra o
  left join inventario.proveedor pr on pr.id = o.proveedor_id
  where (
      p_busqueda is null or p_busqueda = ''
      or lower(o.folio) like lower(p_busqueda) || '%'
      or pr.nombre ilike '%' || p_busqueda || '%'
    )
    and (p_proveedor_id is null or o.proveedor_id = p_proveedor_id)
    and (p_bodega_id is null or o.bodega_destino_id = p_bodega_id)
    and (p_estado is null or p_estado = '' or o.estado = p_estado)
    and (p_desde_fecha is null or o.fecha >= p_desde_fecha)
    and (p_hasta_fecha is null or o.fecha <= p_hasta_fecha)
  order by o.fecha desc, o.id desc
  offset greatest(0, p_desde)
  limit greatest(1, p_cantidad);
$$;

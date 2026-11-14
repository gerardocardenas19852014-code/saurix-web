-- Fase 3 (autorizada el 2026-11-06, cierre) — nueva función de solo
-- lectura para el catálogo de Cobro: filtra productos físicos sin
-- existencia disponible DESDE PostgreSQL, antes de paginar. No reemplaza
-- ninguna función existente; no modifica ventas.fn_venta_registrar ni
-- ninguna función de inventario ya existente.
--
-- Mismo criterio de "existencia disponible" que ya usa
-- CobroComponent.existenciaDisponible()/producto.util.ts:
--  - Servicio (producto.existencia IS NULL) -> siempre pasa (null).
--  - Sin bodega elegida -> existencia_producto_resumen.existencia_total,
--    o producto.existencia si el producto nunca tuvo movimientos por
--    bodega (mismo coalesce que fn_valor_stock_productos).
--  - Con bodega elegida y el producto YA tiene registros en
--    ExistenciaBodega (existencia_producto_resumen.producto_id IS NOT
--    NULL, confirmado 1:1 con "tiene al menos un registro en
--    ExistenciaBodega") -> existencia de ESA bodega (0 si no tiene fila
--    ahí).
--  - Con bodega elegida pero el producto nunca tuvo bodega asignada ->
--    producto.existencia (criterio "heredado").
--
-- SECURITY INVOKER (default, sin DEFINER), STABLE, search_path=''. Filtro
-- explícito por empresa además de RLS (misma convención que
-- fn_valor_stock_productos). Rollback: DROP FUNCTION
-- inventario.fn_cobro_productos_listar(text,bigint,bigint,integer,integer);
-- (función nueva, nada más depende de ella todavía).
create or replace function inventario.fn_cobro_productos_listar(
  p_busqueda text default null,
  p_categoria_id bigint default null,
  p_bodega_id bigint default null,
  p_desde integer default 0,
  p_cantidad integer default 20
)
returns table (
  id bigint,
  nombre text,
  codigo text,
  categoria_producto_id bigint,
  unidad_medida_id bigint,
  descripcion text,
  costo numeric,
  precio_unitario numeric,
  existencia numeric,
  nivel_minimo numeric,
  nivel_maximo numeric,
  proveedor_id bigint,
  unidad_compra_id bigint,
  factor_conversion_compra numeric,
  maneja_lotes boolean,
  foto text,
  destacado boolean,
  activo boolean,
  total bigint
)
language sql
stable
set search_path to ''
as $function$
  with base as (
    select
      p.id, p.nombre, p.codigo, p.categoria_producto_id, p.unidad_medida_id, p.descripcion, p.costo, p.precio_unitario,
      p.existencia, p.nivel_minimo, p.nivel_maximo, p.proveedor_id, p.unidad_compra_id, p.factor_conversion_compra,
      p.maneja_lotes, p.foto, p.destacado, p.activo,
      case
        when p.existencia is null then null
        when p_bodega_id is null then coalesce(ea.existencia_total, p.existencia, 0)
        when ea.producto_id is not null then coalesce(eb.existencia, 0)
        else coalesce(p.existencia, 0)
      end as existencia_disponible
    from inventario.producto p
    left join inventario.existencia_producto_resumen ea
      on ea.producto_id = p.id and ea.empresa_id = privado.empresa_actual_id()
    left join inventario.existencia_bodega eb
      on eb.producto_id = p.id and eb.bodega_id = p_bodega_id and eb.empresa_id = privado.empresa_actual_id()
    where p.empresa_id = privado.empresa_actual_id()
      and p.activo
      and (nullif(trim(p_busqueda), '') is null or p.nombre ilike '%' || nullif(trim(p_busqueda), '') || '%' or p.codigo ilike '%' || nullif(trim(p_busqueda), '') || '%')
      and (p_categoria_id is null or p.categoria_producto_id = p_categoria_id)
  )
  select id, nombre, codigo, categoria_producto_id, unidad_medida_id, descripcion, costo, precio_unitario,
    existencia, nivel_minimo, nivel_maximo, proveedor_id, unidad_compra_id, factor_conversion_compra,
    maneja_lotes, foto, destacado, activo,
    count(*) over() as total
  from base
  where existencia_disponible is null or existencia_disponible > 0
  order by nombre asc, id asc
  limit p_cantidad offset p_desde
$function$;

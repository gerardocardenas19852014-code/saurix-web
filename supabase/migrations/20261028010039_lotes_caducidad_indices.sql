-- Dos índices nuevos, justificados (se revisaron los existentes antes:
-- lote_producto_pkey, _empresa_id_ix, _producto_id_ix, _bodega_id_ix,
-- _fecha_caducidad_ix — ninguno cubre bien lo que necesitan las tarjetas
-- Próximos a vencer/Vencidos ni la búsqueda por número de lote a escala):
--
-- 1) empresa_id + activo + fecha_caducidad: fn_lotes_resumen() hace dos
--    count(*) filter(...) sobre activo+fecha_caducidad, y fn_lotes_listar()
--    ordena por fecha_caducidad por default — el índice existente de solo
--    fecha_caducidad no combina con el filtro de activo/empresa en un solo
--    recorrido. No se duplica el índice de fecha_caducidad solo (se deja,
--    por si algo más lo usa) — este es nuevo y compuesto.
-- 2) lote (trigram GIN): fn_lotes_listar() filtra por ilike '%...%' sobre
--    el número de lote (punto 7 del pedido) — sin índice, un escaneo
--    ilike en 100,000+ lotes sería secuencial; mismo patrón ya usado para
--    producto.codigo/nombre (producto_valor_stock_codigo_trgm_ix).
create index if not exists lote_producto_empresa_activo_fecha_ix
  on inventario.lote_producto (empresa_id, activo, fecha_caducidad);

create index if not exists lote_producto_lote_trgm_ix
  on inventario.lote_producto using gin (lote gin_trgm_ops);
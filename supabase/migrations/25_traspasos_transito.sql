-- =====================================================================
-- Saurix · Supabase · 25 Traspasos "en tránsito"
--  - movimiento_inventario.en_transito / fecha_recepcion: ver
--    MovimientoInventario.enTransito/fechaRecepcion y
--    MovimientoInventarioService.enviarEnTransito()/confirmarRecepcionTransito().
--    Solo agrega columnas a una tabla que YA existe — no requiere volver a
--    crear auditoría/RLS/grants (eso ya está desde 14_inventario.sql).
-- =====================================================================
alter table inventario.movimiento_inventario
  add column en_transito     boolean not null default false,
  add column fecha_recepcion timestamptz;

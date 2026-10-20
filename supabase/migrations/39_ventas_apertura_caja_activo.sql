-- =====================================================================
-- Saurix · Supabase · 39 Ventas: parámetro para activar/desactivar
-- Apertura de caja
--  - Mismo patrón que corte_caja_activo/cierre_caja_activo (migración 38)
--    en ventas.configuracion_ventas — pedido explícito del usuario: que
--    "Apertura de caja" tenga su propio parámetro igual que Corte/Cierre.
--  - Default true: no rompe el comportamiento de empresas que ya la usan.
-- =====================================================================
alter table ventas.configuracion_ventas
  add column apertura_caja_activo boolean not null default true;

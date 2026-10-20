-- =====================================================================
-- Saurix · Supabase · 38 Ventas: parámetros para activar/desactivar Corte
-- de caja y Cierre de caja
--  - Mismo patrón que conteo_caja_por_denominacion en
--    ventas.configuracion_ventas: fila única por empresa, controlada
--    desde Panel de Control → Parámetros del sistema.
--  - Default true en ambas para no romper el comportamiento de empresas
--    que ya usan estas pantallas — el apagado es opt-out, no opt-in.
-- =====================================================================
alter table ventas.configuracion_ventas
  add column corte_caja_activo boolean not null default true,
  add column cierre_caja_activo boolean not null default true;

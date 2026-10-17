-- =====================================================================
-- Saurix · Supabase · 22 Alerta de sobre-stock
--  - inventario.producto gana nivel_maximo (opuesto a nivel_minimo, mismo
--    criterio: global, opcional, numeric(14,2)) — avisa en Valor de stock
--    cuando la existencia total YA superó ese máximo (demasiado capital
--    inmovilizado). Ver haySobreStock() en producto.util.ts.
-- =====================================================================
set check_function_bodies = off;

alter table inventario.producto
  add column nivel_maximo numeric(14,2);

-- =====================================================================
-- Saurix · Supabase · 21 Ubicación física dentro de bodega
--  - inventario.existencia_bodega gana ubicacion (texto libre, opcional) —
--    pasillo/anaquel/nivel dentro de la bodega, puramente informativo para
--    agilizar el surtido o el conteo físico. No afecta cantidades ni
--    movimientos. Se edita inline en la pestaña "Existencia por bodega" de
--    Movimientos entre bodegas.
-- =====================================================================
set check_function_bodies = off;

alter table inventario.existencia_bodega
  add column ubicacion text;

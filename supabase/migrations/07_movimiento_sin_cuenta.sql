-- =====================================================================
-- Saurix · Supabase · 07 Movimientos y fijos sin cuenta
-- La app permite movimientos (sobre todo proyectados) y fijos sin cuenta.
-- =====================================================================
alter table presupuesto.movimiento_presupuesto alter column cuenta_presupuesto_id drop not null;
alter table presupuesto.movimiento_recurrente_presupuesto alter column cuenta_presupuesto_id drop not null;

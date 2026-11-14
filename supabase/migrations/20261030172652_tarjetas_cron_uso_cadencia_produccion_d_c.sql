
-- Verificado en vivo (succeeded) cada minuto. "uso" ya tiene triggers desde D-B,
-- asi que esta reconciliacion es solo backstop -- se relaja a cada 30 min,
-- igual que reconciliar-stock-bajo. "pago" se queda permanentemente cada minuto
-- (nunca tiene trigger, igual que revisar-sla-tickets).
select cron.schedule('reconciliar-uso-tarjeta', '*/30 * * * *', $$select presupuesto.fn_reconciliar_uso_tarjeta();$$);


select cron.schedule('reconciliar-uso-tarjeta', '* * * * *', $$select presupuesto.fn_reconciliar_uso_tarjeta();$$);
select cron.schedule('reconciliar-pago-tarjeta', '* * * * *', $$select presupuesto.fn_reconciliar_pago_tarjeta();$$);


-- C-E: activacion de pg_cron para la reconciliacion de stock bajo (C-D).
-- Se programa primero a 1 minuto para verificar en vivo (via cron.job_run_details)
-- que pg_cron ejecuta la funcion correctamente con permisos reales; una vez
-- confirmado se reprograma a cada 30 minutos para produccion (justificado por
-- el benchmark de C-D: ~1.5-2.6s por pasada incluso a 200k productos).
select cron.schedule(
  'reconciliar-stock-bajo',
  '* * * * *',
  $$select inventario.fn_reconciliar_avisos_stock_bajo();$$
);

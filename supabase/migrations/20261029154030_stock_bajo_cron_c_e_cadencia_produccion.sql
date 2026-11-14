
-- Verificado en vivo (3/3 ejecuciones exitosas a 1 minuto via cron.job_run_details).
-- Se reprograma a cada 30 minutos para produccion: el benchmark de C-D mostro
-- ~1.5-2.6s por pasada incluso a 200k productos, muy por debajo de este intervalo.
select cron.schedule(
  'reconciliar-stock-bajo',
  '*/30 * * * *',
  $$select inventario.fn_reconciliar_avisos_stock_bajo();$$
);

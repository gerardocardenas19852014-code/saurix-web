create extension if not exists pg_cron with schema extensions;

select cron.schedule(
  'revisar-sla-tickets',
  '* * * * *',
  $$select privado.fn_revisar_sla_tickets();$$
);
create or replace function privado.fn_revisar_sla_tickets()
returns table (ticket_id bigint, nivel_calculado text, usuario_id bigint)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_lock_ok boolean;
begin
  v_lock_ok := pg_try_advisory_lock(hashtext('fn_revisar_sla_tickets'));
  if not v_lock_ok then
    return;
  end if;

  return query select * from privado.fn_revisar_sla_tickets_interna();

  perform pg_advisory_unlock(hashtext('fn_revisar_sla_tickets'));
exception when others then
  perform pg_advisory_unlock(hashtext('fn_revisar_sla_tickets'));
  raise;
end;
$function$;

revoke all on function privado.fn_revisar_sla_tickets() from public, anon, authenticated;
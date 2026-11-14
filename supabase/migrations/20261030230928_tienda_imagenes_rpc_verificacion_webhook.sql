
-- Permite que la Edge Function "tienda-imagenes" (que corre con la llave de
-- servicio, inyectada automáticamente por Supabase, nunca vista por esta
-- sesión) verifique que una llamada entrante viene realmente de nuestros
-- propios triggers, comparando contra el secreto guardado en Vault. Así no
-- hace falta duplicar el secreto en dos lugares distintos (Vault y "Edge
-- Function secrets") ni pasarlo por ningún cliente.
create or replace function privado.fn_verificar_secreto_webhook(p_valor text)
returns boolean
language sql
stable
set search_path = ''
as $function$
  select p_valor is not null
     and p_valor = (select decrypted_secret from vault.decrypted_secrets where name = 'webhook_tienda_imagenes');
$function$;

revoke all on function privado.fn_verificar_secreto_webhook(text) from public, anon, authenticated;
grant execute on function privado.fn_verificar_secreto_webhook(text) to service_role;

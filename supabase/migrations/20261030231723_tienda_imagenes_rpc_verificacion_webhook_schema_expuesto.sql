
-- privado.fn_verificar_secreto_webhook() quedó inalcanzable: "privado" no
-- está en los esquemas expuestos de PostgREST (es, correctamente, un
-- esquema de helpers internos, nunca llamado directo desde ningún
-- cliente). Se crea la misma función en "seguridad", que sí está expuesto
-- (ya se usa para tienda_detalle, admin-usuarios, etc.) y solo otorga
-- ejecución a service_role, igual que antes.
create or replace function seguridad.fn_verificar_secreto_webhook(p_valor text)
returns boolean
language sql
stable
set search_path = ''
as $function$
  select p_valor is not null
     and p_valor = (select decrypted_secret from vault.decrypted_secrets where name = 'webhook_tienda_imagenes');
$function$;

revoke all on function seguridad.fn_verificar_secreto_webhook(text) from public, anon, authenticated;
grant execute on function seguridad.fn_verificar_secreto_webhook(text) to service_role;


create or replace function inventario.fn_trigger_procesar_foto_producto()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_secreto text;
begin
  if tg_op = 'UPDATE' and old.foto is not distinct from new.foto then
    return new;
  end if;

  if new.foto is null then
    update inventario.producto set foto_thumb_url = null, foto_detalle_url = null where id = new.id;
    return new;
  end if;

  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'webhook_tienda_imagenes';

  perform net.http_post(
    url := 'https://fcumlscwxcmzxkknjjgo.supabase.co/functions/v1/tienda-imagenes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjdW1sc2N3eGNtenhra25qamdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NTc1NDYsImV4cCI6MjEwNzEzMzU0Nn0.MJvfRCTljg3cKgo_MNaEZtaDc5i-pllLrdRgdDHNCqg',
      'x-webhook-secret', v_secreto
    ),
    body := jsonb_build_object('accion', 'procesar_producto', 'productoId', new.id)
  );
  return new;
end;
$function$;

create trigger trg_procesar_foto_producto
  after insert or update of foto on inventario.producto
  for each row
  execute function inventario.fn_trigger_procesar_foto_producto();

create or replace function seguridad.fn_trigger_procesar_logo_empresa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_secreto text;
begin
  if tg_op = 'UPDATE' and old.logo_publico is not distinct from new.logo_publico then
    return new;
  end if;

  if new.logo_publico is null then
    update seguridad.empresa set logo_url = null where id = new.id;
    return new;
  end if;

  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'webhook_tienda_imagenes';

  perform net.http_post(
    url := 'https://fcumlscwxcmzxkknjjgo.supabase.co/functions/v1/tienda-imagenes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjdW1sc2N3eGNtenhra25qamdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NTc1NDYsImV4cCI6MjEwNzEzMzU0Nn0.MJvfRCTljg3cKgo_MNaEZtaDc5i-pllLrdRgdDHNCqg',
      'x-webhook-secret', v_secreto
    ),
    body := jsonb_build_object('accion', 'procesar_empresa_logo', 'empresaId', new.id)
  );
  return new;
end;
$function$;

create trigger trg_procesar_logo_empresa
  after insert or update of logo_publico on seguridad.empresa
  for each row
  execute function seguridad.fn_trigger_procesar_logo_empresa();

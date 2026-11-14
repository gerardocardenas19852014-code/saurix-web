
-- Bloque C — reutiliza ventas.pedido_tienda (NO se crea tabla nueva) para
-- que convivan los 2 orígenes: pedido_web (flujo actual) y menu_qr (Menú +
-- Mi orden → Mostrar en caja). Folio/token se generan automáticamente por
-- trigger para CUALQUIER origen, así crear_pedido_tienda (pedidos_online)
-- no necesita tocarse para empezar a tener folio también.

alter table ventas.pedido_tienda
  add column if not exists origen text not null default 'pedido_web',
  add column if not exists folio text,
  add column if not exists token_publico text,
  add column if not exists nombre_mostrar_en text;

alter table ventas.pedido_tienda
  add constraint pedido_tienda_origen_check check (origen in ('pedido_web', 'menu_qr'));

alter table ventas.pedido_tienda
  add constraint pedido_tienda_token_publico_unique unique (token_publico);

-- Menú QR: nombre y teléfono NO son obligatorios (sección 3/10 del plan).
-- El flujo pedido_web sigue exigiéndolos por su propia validación en
-- crear_pedido_tienda (código de aplicación), no por la base de datos.
alter table ventas.pedido_tienda
  alter column nombre_cliente drop not null,
  alter column telefono_cliente drop not null;

-- Contador de folio por empresa (compartido entre ambos orígenes, para que
-- el número se sienta como "el pedido #184 de ESTE negocio", sin importar
-- si llegó por QR o por el flujo completo). Incrementarlo con UPDATE ...
-- RETURNING es atómico (lock de fila) bajo concurrencia.
alter table seguridad.empresa
  add column if not exists siguiente_folio_tienda bigint not null default 1;

create or replace function ventas.fn_asignar_folio_pedido_tienda()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_numero bigint;
  v_prefijo text;
begin
  if new.folio is null then
    v_prefijo := case when new.origen = 'menu_qr' then 'A-' else 'P-' end;
    update seguridad.empresa
      set siguiente_folio_tienda = siguiente_folio_tienda + 1
      where id = new.empresa_id
      returning siguiente_folio_tienda - 1 into v_numero;
    new.folio := v_prefijo || v_numero;
  end if;

  if new.token_publico is null then
    new.token_publico := encode(extensions.gen_random_bytes(16), 'hex');
  end if;

  return new;
end;
$function$;

create trigger trg_asignar_folio_pedido_tienda
  before insert on ventas.pedido_tienda
  for each row execute function ventas.fn_asignar_folio_pedido_tienda();

revoke all on function ventas.fn_asignar_folio_pedido_tienda() from public, anon, authenticated;

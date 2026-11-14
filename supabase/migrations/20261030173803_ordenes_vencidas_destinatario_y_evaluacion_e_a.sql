
-- BLOQUE E-A: ÓRDENES VENCIDAS. orden_compra es compartida_todo (no personal
-- como los movimientos de Tarjetas), asi que -- igual que Stock -- no hay
-- destinatario natural. Se crea una tabla INDEPENDIENTE de
-- alerta_stock_destinatario (decision explicita del usuario: cada tipo de
-- alerta de Inventario mantiene su propia lista de destinatarios).

create table inventario.alerta_orden_destinatario (
  id bigint generated always as identity primary key,
  empresa_id bigint not null references seguridad.empresa(id),
  usuario_id bigint not null references seguridad.usuario(id) on delete cascade,
  fecha_creacion timestamptz not null default now(),
  fecha_modificacion timestamptz,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  unique (empresa_id, usuario_id)
);

alter table inventario.alerta_orden_destinatario enable row level security;

create policy modulo_habilitado on inventario.alerta_orden_destinatario
  for all using (privado.modulo_habilitado('inventario')) with check (privado.modulo_habilitado('inventario'));

create policy solo_mi_empresa on inventario.alerta_orden_destinatario
  for all using (empresa_id = privado.empresa_actual_id()) with check (empresa_id = privado.empresa_actual_id());

create trigger trg_auditoria
  before insert or update on inventario.alerta_orden_destinatario
  for each row execute function privado.auditoria();

create or replace function inventario.fn_validar_destinatario_orden_misma_empresa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_empresa_usuario bigint;
begin
  select u.empresa_id into v_empresa_usuario
  from seguridad.usuario u
  where u.id = new.usuario_id;

  if v_empresa_usuario is null then
    raise exception 'Usuario % no existe.', new.usuario_id;
  end if;

  if v_empresa_usuario <> new.empresa_id then
    raise exception
      'El usuario % pertenece a la empresa %, no a la empresa % — no puede configurarse como destinatario de alertas de órdenes de otra empresa.',
      new.usuario_id, v_empresa_usuario, new.empresa_id;
  end if;

  return new;
end;
$function$;

create trigger trg_validar_destinatario_orden_misma_empresa
  before insert or update of empresa_id, usuario_id on inventario.alerta_orden_destinatario
  for each row execute function inventario.fn_validar_destinatario_orden_misma_empresa();

-- Funciones de evaluacion/generacion (mismo patron que Stock/Tarjetas)

create or replace function inventario.fn_evaluar_orden_vencida(p_orden_compra_id bigint)
returns table(candidato boolean, folio text, empresa_id bigint)
language sql
security definer
set search_path = ''
as $function$
  select
    oc.estado in ('pendiente', 'recibida_parcial')
      and oc.fecha_entrega_estimada is not null
      and oc.fecha_entrega_estimada < current_date,
    oc.folio,
    oc.empresa_id
  from inventario.orden_compra oc
  where oc.id = p_orden_compra_id;
$function$;

create or replace function inventario.fn_generar_aviso_orden_vencida(p_orden_compra_id bigint, p_folio text)
returns table(usuario_id bigint)
language sql
security definer
set search_path = ''
as $function$
  with destino as (
    select oc.id as orden_id, oc.empresa_id
    from inventario.orden_compra oc
    where oc.id = p_orden_compra_id
  ),
  insertados as (
    insert into inventario.aviso_orden_vencida (orden_compra_id, usuario_id, dia, empresa_id)
    select d.orden_id, ad.usuario_id, current_date, d.empresa_id
    from destino d
    join inventario.alerta_orden_destinatario ad
      on ad.empresa_id = d.empresa_id and ad.activo
    on conflict (orden_compra_id, usuario_id, dia) do nothing
    returning usuario_id, empresa_id
  )
  insert into seguridad.notificacion (usuario_id, titulo, link, leida, empresa_id, creado_por)
  select
    i.usuario_id,
    '📦 La orden ' || p_folio || ' ya pasó su fecha de entrega estimada y sigue sin completarse.',
    '/inventario/ordenes-compra',
    false,
    i.empresa_id,
    i.usuario_id
  from insertados i
  returning usuario_id;
$function$;

revoke all on function inventario.fn_evaluar_orden_vencida(bigint) from public, anon, authenticated;
revoke all on function inventario.fn_generar_aviso_orden_vencida(bigint, text) from public, anon, authenticated;

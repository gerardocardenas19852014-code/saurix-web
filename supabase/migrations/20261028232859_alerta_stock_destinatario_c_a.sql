
-- BLOQUE C — STOCK, sub-bloque C-A: tabla de destinatarios configurables
-- para alertas de stock bajo. Fuente de verdad de a quién avisar cuando un
-- producto/bodega cae bajo su mínimo (reemplaza el comportamiento anterior
-- de "avisar a quien tenga Saurix abierto"). Sin pantalla todavía — solo
-- backend, tal como se acordó.

create table inventario.alerta_stock_destinatario (
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

comment on table inventario.alerta_stock_destinatario is
  'Destinatarios configurados por empresa para recibir avisos de stock bajo '
  '(BLOQUE C). Mientras una empresa no tenga ninguna fila activa aquí, no se '
  'genera ningún aviso personal de stock bajo para ella (no hay fallback '
  'automático a ningún rol ni usuario).';

-- Auditoría: mismo trigger compartido que usa el resto del sistema
-- (privado.auditoria()) — fecha_creacion/fecha_modificacion/creado_por/
-- modificado_por se completan solos, igual que en cualquier otra tabla.
create trigger trg_auditoria
  before insert or update on inventario.alerta_stock_destinatario
  for each row execute function privado.auditoria();

-- Protección de integridad: que un usuario de OTRA empresa no pueda
-- quedar configurado como destinatario de esta, ni por error de UI futura
-- ni por un INSERT/UPDATE directo. No hay ningún precedente de este tipo
-- de validación cruzada en el esquema (se revisó), así que se implementa
-- como trigger dedicado — la forma limpia de validar contra otra tabla,
-- ya que un CHECK de PostgreSQL no puede hacer subconsultas.
create or replace function inventario.fn_validar_destinatario_misma_empresa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
      'El usuario % pertenece a la empresa %, no a la empresa % — no puede configurarse como destinatario de alertas de stock de otra empresa.',
      new.usuario_id, v_empresa_usuario, new.empresa_id;
  end if;

  return new;
end;
$$;

create trigger trg_validar_destinatario_misma_empresa
  before insert or update of empresa_id, usuario_id on inventario.alerta_stock_destinatario
  for each row execute function inventario.fn_validar_destinatario_misma_empresa();

-- RLS: mismo patrón exacto que proyectos.ticket_prioridad_notificar /
-- inventario.aviso_stock_bajo (módulo habilitado + solo tu empresa).
alter table inventario.alerta_stock_destinatario enable row level security;

create policy modulo_habilitado on inventario.alerta_stock_destinatario
  for all
  using (privado.modulo_habilitado('inventario'))
  with check (privado.modulo_habilitado('inventario'));

create policy solo_mi_empresa on inventario.alerta_stock_destinatario
  for all
  using (empresa_id = privado.empresa_actual_id())
  with check (empresa_id = privado.empresa_actual_id());

revoke all on function inventario.fn_validar_destinatario_misma_empresa() from public, anon, authenticated;

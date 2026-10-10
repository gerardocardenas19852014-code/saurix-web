-- =====================================================================
-- Saurix · Supabase · 10 Recrear Listas de valores y Apariencia (por empresa)
-- (las tablas se habían borrado desde el panel)
-- =====================================================================
set check_function_bodies = off;

create table panel_control.valor_lista (
  id                 bigint generated always as identity primary key,
  empresa_id         bigint not null default privado.empresa_actual_id() references seguridad.empresa(id),
  grupo              text not null,
  clave              text not null,
  etiqueta           text not null,
  orden              integer not null default 0,
  fecha_creacion     timestamptz not null default now(),
  fecha_modificacion timestamptz,
  creado_por         bigint,
  modificado_por     bigint,
  activo             boolean not null default true
);
create unique index valor_lista_empresa_grupo_clave_uk on panel_control.valor_lista (empresa_id, grupo, clave);

create table panel_control.configuracion_apariencia (
  id                        bigint generated always as identity primary key,
  empresa_id                bigint not null default privado.empresa_actual_id() references seguridad.empresa(id),
  usuario_id                bigint not null unique references seguridad.usuario(id) on delete cascade,
  tema                      text not null default 'claro',
  asistente_ia_activo       boolean not null default true,
  tamano_pagina_grid        integer not null default 10 check (tamano_pagina_grid > 0),
  vista_proyectos_preferida text not null default 'tablero',
  fecha_creacion            timestamptz not null default now(),
  fecha_modificacion        timestamptz,
  creado_por                bigint,
  modificado_por            bigint,
  activo                    boolean not null default true
);
create index configuracion_apariencia_empresa_id_ix on panel_control.configuracion_apariencia (empresa_id);

create trigger trg_auditoria before insert or update on panel_control.valor_lista
  for each row execute function privado.auditoria();
create trigger trg_auditoria before insert or update on panel_control.configuracion_apariencia
  for each row execute function privado.auditoria();

grant select, insert, update, delete on panel_control.valor_lista, panel_control.configuracion_apariencia to authenticated;
grant all on panel_control.valor_lista, panel_control.configuracion_apariencia to service_role;

alter table panel_control.valor_lista enable row level security;
alter table panel_control.configuracion_apariencia enable row level security;

create policy compartida_todo on panel_control.valor_lista for all to authenticated
  using ((select privado.usuario_actual_id()) is not null)
  with check ((select privado.usuario_actual_id()) is not null);
create policy solo_mi_empresa on panel_control.valor_lista as restrictive for all to authenticated
  using (empresa_id = (select privado.empresa_actual_id()))
  with check (empresa_id = (select privado.empresa_actual_id()));

create policy propio_todo on panel_control.configuracion_apariencia for all to authenticated
  using (usuario_id = (select privado.usuario_actual_id()))
  with check (usuario_id = (select privado.usuario_actual_id()));
create policy solo_mi_empresa on panel_control.configuracion_apariencia as restrictive for all to authenticated
  using (empresa_id = (select privado.empresa_actual_id()))
  with check (empresa_id = (select privado.empresa_actual_id()));

-- Listas iniciales de cada empresa (las de Familia las siembra la propia app).
create or replace function privado.sembrar_listas_empresa(p_empresa bigint)
returns void
language sql security definer set search_path = ''
as $$
  insert into panel_control.valor_lista (empresa_id, grupo, clave, etiqueta, orden)
  select p_empresa, g, c, e, o from (values
    ('CuentaPresupuestoTipo','Efectivo','Efectivo',1),
    ('CuentaPresupuestoTipo','Banco','Banco',2),
    ('CuentaPresupuestoTipo','Tarjeta','Tarjeta',3),
    ('CuentaPresupuestoTipo','Ahorro','Ahorro',4),
    ('MovimientoPresupuestoTipo','Ingreso','Ingreso',1),
    ('MovimientoPresupuestoTipo','Gasto','Gasto',2),
    ('MovimientoRecurrenteFrecuencia','Mensual','Mensual',1),
    ('MovimientoRecurrenteFrecuencia','Anual','Anual',2),
    ('PresupuestoAnualEstatus','Creacion','Creación',1),
    ('PresupuestoAnualEstatus','Proyeccion','Proyección',2),
    ('PresupuestoAnualEstatus','Autorizado','Autorizado',3),
    ('PresupuestoAnualEstatus','Ejecutado','Ejecutado',4)
  ) v(g, c, e, o)
  on conflict do nothing
$$;
revoke all on function privado.sembrar_listas_empresa(bigint) from public, anon, authenticated;

create or replace function privado.al_crear_empresa()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform privado.sembrar_listas_empresa(new.id);
  return new;
end;
$$;
create trigger trg_sembrar_listas after insert on seguridad.empresa
  for each row execute function privado.al_crear_empresa();

select privado.sembrar_listas_empresa(id) from seguridad.empresa;

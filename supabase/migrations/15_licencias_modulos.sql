-- =====================================================================
-- Saurix · Supabase · 15 Licencias por módulo + límite de usuarios
--  - Saurix se vende por módulos: no todas las empresas compran todos.
--    seguridad.empresa_modulo guarda qué módulo (de los "vendibles":
--    wikidocs, presupuesto, proyectos, familia, inventario) tiene
--    habilitado cada empresa. Seguridad y Panel de control son base del
--    sistema (login, usuarios, apariencia) y no se gatean: toda empresa
--    los tiene siempre.
--  - privado.modulo_habilitado(clave) se suma como política RESTRICTIVA
--    en las tablas de esos 5 esquemas, igual patrón que solo_mi_empresa
--    (09_empresas.sql): aunque alguien manipule la app o llame la API
--    directo, no puede leer/escribir en un módulo que la empresa no tiene.
--  - seguridad.empresa.max_usuarios: tope opcional de usuarios activos
--    por empresa (NULL = sin límite), exigido en privado.crear_perfil_usuario()
--    — cubre tanto el alta propia (auth.users) como la Edge Function
--    admin-usuarios, porque las dos terminan insertando en auth.users y
--    disparando el mismo trigger.
-- =====================================================================
set check_function_bodies = off;

-- ── Tope de usuarios por empresa ─────────────────────────────────────
alter table seguridad.empresa add column max_usuarios integer;
comment on column seguridad.empresa.max_usuarios is 'Tope de usuarios activos para esta empresa; NULL = sin límite.';

-- ── Módulos habilitados por empresa ──────────────────────────────────
create table seguridad.empresa_modulo (
  id            bigint generated always as identity primary key,
  empresa_id    bigint not null references seguridad.empresa(id) on delete cascade,
  modulo_clave  text not null,
  fecha_creacion     timestamptz not null default now(),
  fecha_modificacion timestamptz,
  creado_por         bigint,
  modificado_por     bigint,
  activo             boolean not null default true,
  unique (empresa_id, modulo_clave)
);
create index empresa_modulo_empresa_id_ix on seguridad.empresa_modulo (empresa_id);
create trigger trg_auditoria before insert or update on seguridad.empresa_modulo
  for each row execute function privado.auditoria();

alter table seguridad.empresa_modulo enable row level security;
revoke all on seguridad.empresa_modulo from anon;
grant select, insert, update, delete on seguridad.empresa_modulo to authenticated;
grant all on seguridad.empresa_modulo to service_role;
grant usage, select on sequence seguridad.empresa_modulo_id_seq to authenticated, service_role;

-- Cualquier usuario vigente ve los módulos de SU empresa (para armar el
-- menú); el superadmin puede ver los de cualquier empresa (pantalla
-- Seguridad → Empresas). Solo el superadmin da de alta/modifica/borra —
-- ni siquiera el admin de la propia empresa puede auto-habilitarse módulos.
create policy ver_modulos on seguridad.empresa_modulo for select to authenticated
  using (empresa_id = (select privado.empresa_actual_id()) or (select privado.es_superadmin()));
create policy escribir_modulos_superadmin on seguridad.empresa_modulo for all to authenticated
  using ((select privado.es_superadmin()))
  with check ((select privado.es_superadmin()));

-- Lo ya existente (empresa 1 "Principal") conserva acceso a todo lo que ya
-- usa: no tiene sentido que, al prender esta migración, a la empresa que
-- ya estaba operando se le apague algo de golpe.
insert into seguridad.empresa_modulo (empresa_id, modulo_clave, activo)
select 1, m, true
from unnest(array['wikidocs', 'presupuesto', 'proyectos', 'familia', 'inventario']) as m;

-- ── Función usada en las políticas RESTRICTIVE de cada módulo ────────
create or replace function privado.modulo_habilitado(p_modulo text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from seguridad.empresa_modulo em
    where em.empresa_id = (select privado.empresa_actual_id())
      and em.modulo_clave = p_modulo
      and em.activo
  )
$$;
revoke all on function privado.modulo_habilitado(text) from public, anon;
grant execute on function privado.modulo_habilitado(text) to authenticated;

-- RPC que usa el frontend al iniciar sesión / restaurar sesión para saber
-- qué mostrar en el selector de módulos y el menú, sin tener que conocer
-- su propio empresa_id (resuelve privado.empresa_actual_id() del lado
-- del servidor, correcto también en modo soporte).
create or replace function seguridad.mis_modulos()
returns table (modulo_clave text)
language sql stable security definer set search_path = ''
as $$
  select em.modulo_clave
  from seguridad.empresa_modulo em
  where em.empresa_id = (select privado.empresa_actual_id())
    and em.activo
$$;
revoke all on function seguridad.mis_modulos() from public, anon;
grant execute on function seguridad.mis_modulos() to authenticated;

-- ── Política RESTRICTIVE: sin el módulo habilitado, ni lectura ni
-- escritura en ninguna de sus tablas. Seguridad y Panel de control NO
-- entran aquí (son base del sistema, no se venden por separado).
do $$
declare t record;
begin
  for t in
    select table_schema, table_name from information_schema.tables
    where table_type = 'BASE TABLE'
      and table_schema in ('wikidocs', 'presupuesto', 'proyectos', 'familia', 'inventario')
  loop
    execute format(
      'create policy modulo_habilitado on %I.%I as restrictive for all to authenticated
         using (privado.modulo_habilitado(%L))
         with check (privado.modulo_habilitado(%L))',
      t.table_schema, t.table_name, t.table_schema, t.table_schema);
  end loop;
end $$;

-- ── Límite de usuarios: se exige dentro de crear_perfil_usuario (09_empresas.sql),
-- porque tanto el alta propia como la Edge Function admin-usuarios terminan
-- insertando en auth.users y disparando este mismo trigger.
create or replace function privado.crear_perfil_usuario()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_nombre_usuario text;
  v_nombre text;
  v_rol text;
  v_empresa bigint;
  v_max_usuarios integer;
  v_usuarios_actuales integer;
begin
  v_empresa := coalesce(nullif(new.raw_user_meta_data->>'empresa_id', '')::bigint, 1);

  select max_usuarios into v_max_usuarios from seguridad.empresa where id = v_empresa;
  if v_max_usuarios is not null then
    select count(*) into v_usuarios_actuales from seguridad.usuario where empresa_id = v_empresa and activo;
    if v_usuarios_actuales >= v_max_usuarios then
      raise exception 'Esta empresa ya alcanzó su límite de % usuario(s).', v_max_usuarios;
    end if;
  end if;

  v_nombre_usuario := coalesce(
    nullif(new.raw_user_meta_data->>'nombre_usuario', ''),
    split_part(new.email, '@', 1)
  );
  if char_length(v_nombre_usuario) < 4 then
    v_nombre_usuario := rpad(v_nombre_usuario, 4, '0');
  end if;
  if exists (select 1 from seguridad.usuario where lower(nombre_usuario) = lower(v_nombre_usuario)) then
    v_nombre_usuario := v_nombre_usuario || '_' || substr(replace(new.id::text, '-', ''), 1, 4);
  end if;

  v_nombre := left(coalesce(nullif(trim(new.raw_user_meta_data->>'nombre'), ''), v_nombre_usuario), 30);
  if char_length(v_nombre) < 3 then
    v_nombre := rpad(v_nombre, 3, '.');
  end if;

  v_rol := case when exists (select 1 from seguridad.usuario where empresa_id = v_empresa) then 'viewer' else 'admin' end;

  insert into seguridad.usuario (auth_user_id, nombre_usuario, nombre, apellido_paterno, apellido_materno, email, role, empresa_id)
  values (
    new.id,
    v_nombre_usuario,
    v_nombre,
    nullif(left(new.raw_user_meta_data->>'apellido_paterno', 30), ''),
    nullif(left(new.raw_user_meta_data->>'apellido_materno', 30), ''),
    new.email,
    v_rol,
    v_empresa
  )
  on conflict do nothing;
  return new;
end;
$$;

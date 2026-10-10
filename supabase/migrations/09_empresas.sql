-- =====================================================================
-- Saurix · Supabase · 09 Varias empresas (clientes) en una sola base
--  - seguridad.empresa: cada cliente es una empresa.
--  - Cada usuario pertenece a una empresa (usuario.empresa_id).
--  - Todas las tablas de datos llevan empresa_id; se llena solo con la
--    empresa de quien inserta (default privado.empresa_actual_id()).
--  - Una política RESTRICTIVA por tabla obliga a que todo lo que se lee o
--    escribe sea de la empresa del usuario en sesión. Se suma (AND) a las
--    políticas que ya existían (personal, compartida, admin…).
--  - Archivos: la ruta en Storage empieza con empresa_<id>/.
--  - usuario.es_superadmin: puede crear empresas y usuarios en cualquier
--    empresa (desde la Edge Function admin-usuarios).
-- Lo existente queda en la empresa 1 ("Principal").
-- =====================================================================
set check_function_bodies = off;

create table seguridad.empresa (
  id     bigint generated always as identity primary key,
  clave  text not null,
  nombre text not null
);
create unique index empresa_clave_uk on seguridad.empresa (lower(clave));

alter table seguridad.empresa
  add column fecha_creacion     timestamptz not null default now(),
  add column fecha_modificacion timestamptz,
  add column creado_por         bigint,
  add column modificado_por     bigint,
  add column activo             boolean not null default true;
create trigger trg_auditoria before insert or update on seguridad.empresa
  for each row execute function privado.auditoria();

insert into seguridad.empresa (clave, nombre) overriding system value
values ('principal', 'Principal');   -- id 1
select setval(pg_get_serial_sequence('seguridad.empresa', 'id'), 1);

-- ── Usuario ───────────────────────────────────────────────────────────
alter table seguridad.usuario
  add column empresa_id    bigint not null default 1 references seguridad.empresa(id),
  add column es_superadmin boolean not null default false;
create index usuario_empresa_id_ix on seguridad.usuario (empresa_id);
update seguridad.usuario set es_superadmin = true where lower(nombre_usuario) = 'jcardenast';

-- Empresa del usuario en sesión (sin importar vigencia: la vigencia ya la
-- controla usuario_actual_id en las demás políticas). NULL si la empresa
-- está inactiva.
create or replace function privado.empresa_actual_id()
returns bigint
language sql stable security definer set search_path = ''
as $$
  select u.empresa_id
  from seguridad.usuario u
  join seguridad.empresa e on e.id = u.empresa_id and e.activo
  where u.auth_user_id = auth.uid()
$$;

create or replace function privado.es_superadmin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from seguridad.usuario u
    where u.auth_user_id = auth.uid() and u.es_superadmin and u.activo
  )
$$;

revoke all on function privado.empresa_actual_id(), privado.es_superadmin() from public, anon;
grant execute on function privado.empresa_actual_id(), privado.es_superadmin() to authenticated;

alter table seguridad.usuario alter column empresa_id set default privado.empresa_actual_id();

-- Un admin normal no puede cambiar la empresa ni volverse superadmin.
create or replace function privado.proteger_campos_usuario()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is not null and not privado.es_superadmin() then
    new.empresa_id    := old.empresa_id;
    new.es_superadmin := old.es_superadmin;
    if not privado.es_admin() then
      new.role                  := old.role;
      new.fecha_inicio_vigencia := old.fecha_inicio_vigencia;
      new.fecha_fin_vigencia    := old.fecha_fin_vigencia;
      new.activo                := old.activo;
      new.auth_user_id          := old.auth_user_id;
    end if;
  end if;
  return new;
end;
$$;

-- Perfil al crear la cuenta: la empresa viene en los metadatos (la pone la
-- Edge Function); el primer usuario de cada empresa queda como admin.
create or replace function privado.crear_perfil_usuario()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_nombre_usuario text;
  v_nombre text;
  v_rol text;
  v_empresa bigint;
begin
  v_empresa := coalesce(nullif(new.raw_user_meta_data->>'empresa_id', '')::bigint, 1);

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

-- ── empresa_id en todas las tablas de datos ──────────────────────────
do $$
declare t record;
begin
  for t in
    select table_schema, table_name from information_schema.tables
    where table_type = 'BASE TABLE'
      and table_schema in ('seguridad','panel_control','wikidocs','presupuesto','proyectos','familia')
      and not (table_schema = 'seguridad' and table_name in ('empresa', 'usuario'))
  loop
    -- default 1 deja lo existente en la empresa Principal; luego el default
    -- pasa a ser la empresa de quien inserta.
    execute format('alter table %I.%I add column empresa_id bigint not null default 1 references seguridad.empresa(id)', t.table_schema, t.table_name);
    execute format('alter table %I.%I alter column empresa_id set default privado.empresa_actual_id()', t.table_schema, t.table_name);
    execute format('create index %I on %I.%I (empresa_id)', left(t.table_name || '_empresa_id_ix', 63), t.table_schema, t.table_name);
  end loop;
end $$;

-- ── Política restrictiva por empresa ─────────────────────────────────
do $$
declare t record;
begin
  for t in
    select table_schema, table_name from information_schema.tables
    where table_type = 'BASE TABLE'
      and table_schema in ('seguridad','panel_control','wikidocs','presupuesto','proyectos','familia')
      and not (table_schema = 'seguridad' and table_name = 'empresa')
  loop
    execute format(
      'create policy solo_mi_empresa on %I.%I as restrictive for all to authenticated
         using (empresa_id = (select privado.empresa_actual_id()))
         with check (empresa_id = (select privado.empresa_actual_id()))',
      t.table_schema, t.table_name);
  end loop;
end $$;

-- Empresa: cada quien ve la suya; el superadmin administra todas.
alter table seguridad.empresa enable row level security;
grant select, insert, update, delete on seguridad.empresa to authenticated;
grant all on seguridad.empresa to service_role;
create policy empresa_ver on seguridad.empresa for select to authenticated
  using (id = (select privado.empresa_actual_id()) or (select privado.es_superadmin()));
create policy empresa_superadmin on seguridad.empresa for all to authenticated
  using ((select privado.es_superadmin())) with check ((select privado.es_superadmin()));

-- ── Claves únicas por empresa (las globales se quitan en 09b) ────────
create unique index proyecto_empresa_clave_uk     on proyectos.proyecto (empresa_id, clave);
create unique index ticket_tipo_empresa_clave_uk  on proyectos.ticket_tipo (empresa_id, clave);
create unique index ticket_prioridad_empresa_clave_uk on proyectos.ticket_prioridad (empresa_id, clave);
create unique index ticket_modulo_empresa_clave_uk on proyectos.ticket_modulo (empresa_id, clave);
create unique index rol_empresa_nombre_uk         on seguridad.rol (empresa_id, nombre);
create unique index permiso_empresa_nombre_uk     on seguridad.permiso (empresa_id, nombre);

-- ── Storage: rutas empresa_<id>/... ──────────────────────────────────
create policy adjuntos_solo_mi_empresa on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'adjuntos' or (storage.foldername(name))[1] = 'empresa_' || (select privado.empresa_actual_id()))
  with check (bucket_id <> 'adjuntos' or (storage.foldername(name))[1] = 'empresa_' || (select privado.empresa_actual_id()));

-- ── Datos de mi empresa para la app ─────────────────────────────────
create or replace function seguridad.mi_empresa()
returns table (id bigint, clave text, nombre text, es_superadmin boolean)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.clave, e.nombre, coalesce(u.es_superadmin, false)
  from seguridad.usuario u
  join seguridad.empresa e on e.id = u.empresa_id
  where u.auth_user_id = auth.uid()
$$;
revoke all on function seguridad.mi_empresa() from public, anon;
grant execute on function seguridad.mi_empresa() to authenticated;

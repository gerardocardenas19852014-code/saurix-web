-- =====================================================================
-- Saurix · Supabase · 11 Superadmin: trabajar dentro de otra empresa
--  - usuario.empresa_activa_id: si un superadmin la llena, toda la app
--    (lecturas, altas, archivos) opera sobre ESA empresa ("modo soporte").
--    NULL = su propia empresa.
--  - seguridad.cambiar_empresa_activa(id): solo superadmin.
--  - El propio perfil del superadmin sigue visible aunque esté en otra
--    empresa (para que no pierda la sesión).
-- =====================================================================
set check_function_bodies = off;

alter table seguridad.usuario add column empresa_activa_id bigint references seguridad.empresa(id) on delete set null;
create index usuario_empresa_activa_id_ix on seguridad.usuario (empresa_activa_id);

create or replace function privado.empresa_actual_id()
returns bigint
language sql stable security definer set search_path = ''
as $$
  select e.id
  from seguridad.usuario u
  join seguridad.empresa e
    on e.id = case when u.es_superadmin and u.empresa_activa_id is not null
                   then u.empresa_activa_id else u.empresa_id end
   and e.activo
  where u.auth_user_id = auth.uid()
$$;

alter policy solo_mi_empresa on seguridad.usuario
  using (empresa_id = (select privado.empresa_actual_id()) or auth_user_id = (select auth.uid()))
  with check (empresa_id = (select privado.empresa_actual_id()) or auth_user_id = (select auth.uid()));

create or replace function privado.proteger_campos_usuario()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is not null and not privado.es_superadmin() then
    new.empresa_id        := old.empresa_id;
    new.es_superadmin     := old.es_superadmin;
    new.empresa_activa_id := old.empresa_activa_id;
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

create or replace function seguridad.cambiar_empresa_activa(p_empresa bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not privado.es_superadmin() then
    raise exception 'Solo el superadministrador puede cambiar de empresa.';
  end if;
  if p_empresa is not null and not exists (select 1 from seguridad.empresa where id = p_empresa and activo) then
    raise exception 'La empresa no existe o está inactiva.';
  end if;
  update seguridad.usuario
     set empresa_activa_id = case when p_empresa = empresa_id then null else p_empresa end
   where auth_user_id = auth.uid();
end;
$$;
revoke all on function seguridad.cambiar_empresa_activa(bigint) from public, anon;
grant execute on function seguridad.cambiar_empresa_activa(bigint) to authenticated;

-- mi_empresa ahora devuelve la empresa ACTIVA (de ahí sale la carpeta de Storage).
create or replace function seguridad.mi_empresa()
returns table (id bigint, clave text, nombre text, es_superadmin boolean)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.clave, e.nombre, u.es_superadmin
  from seguridad.usuario u
  join seguridad.empresa e on e.id = privado.empresa_actual_id()
  where u.auth_user_id = auth.uid()
$$;

-- Empresa de la sesión para mostrar en pantalla, incluye si es modo soporte.
create or replace function seguridad.empresa_sesion()
returns table (id bigint, clave text, nombre text, es_superadmin boolean, es_soporte boolean)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.clave, e.nombre, u.es_superadmin, e.id <> u.empresa_id
  from seguridad.usuario u
  join seguridad.empresa e on e.id = privado.empresa_actual_id()
  where u.auth_user_id = auth.uid()
$$;
revoke all on function seguridad.empresa_sesion() from public, anon;
grant execute on function seguridad.empresa_sesion() to authenticated;

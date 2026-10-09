-- =====================================================================
-- Saurix · Supabase · 02 Auditoría, Auth, permisos y RLS
-- =====================================================================
set check_function_bodies = off;  -- las funciones referencian columnas de auditoría que se agregan más abajo

-- ---------------------------------------------------------------------
-- 1) Funciones auxiliares (esquema privado, no expuesto en la API)
-- ---------------------------------------------------------------------

-- Id de seguridad.usuario de la sesión actual; NULL si no hay sesión,
-- si el usuario está inactivo o fuera de su vigencia. Toda la RLS se apoya
-- en esto, así un usuario vencido/inactivo deja de ver datos automáticamente.
create or replace function privado.usuario_actual_id()
returns bigint
language sql stable security definer set search_path = ''
as $$
  select u.id
  from seguridad.usuario u
  where u.auth_user_id = auth.uid()
    and u.activo
    and current_date between u.fecha_inicio_vigencia and u.fecha_fin_vigencia
$$;

create or replace function privado.es_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from seguridad.usuario u
    where u.auth_user_id = auth.uid()
      and u.activo
      and current_date between u.fecha_inicio_vigencia and u.fecha_fin_vigencia
      and u.role = 'admin'
  )
$$;

-- Llena columnas de auditoría en cualquier tabla.
create or replace function privado.auditoria()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.fecha_creacion     := now();
    new.fecha_modificacion := null;
    new.creado_por         := coalesce(new.creado_por, privado.usuario_actual_id());
    new.modificado_por     := null;
  else
    new.fecha_creacion     := old.fecha_creacion;
    new.creado_por         := old.creado_por;
    new.fecha_modificacion := now();
    new.modificado_por     := privado.usuario_actual_id();
  end if;
  return new;
end;
$$;

-- Al registrarse alguien en Supabase Auth se crea su perfil en seguridad.usuario.
-- El PRIMER usuario del sistema queda como 'admin' (sustituye al root sembrado);
-- los siguientes como 'viewer'.
create or replace function privado.crear_perfil_usuario()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_nombre_usuario text;
  v_rol text;
begin
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

  v_rol := case when exists (select 1 from seguridad.usuario) then 'viewer' else 'admin' end;

  insert into seguridad.usuario (auth_user_id, nombre_usuario, nombre, apellido_paterno, apellido_materno, email, role)
  values (
    new.id,
    v_nombre_usuario,
    left(rpad(coalesce(nullif(new.raw_user_meta_data->>'nombre', ''), v_nombre_usuario), 3, ' '), 30),
    nullif(new.raw_user_meta_data->>'apellido_paterno', ''),
    nullif(new.raw_user_meta_data->>'apellido_materno', ''),
    new.email,
    v_rol
  )
  on conflict do nothing;
  return new;
end;
$$;

create trigger al_crear_usuario_auth
  after insert on auth.users
  for each row execute function privado.crear_perfil_usuario();

revoke all on function privado.usuario_actual_id(), privado.es_admin(),
  privado.auditoria(), privado.crear_perfil_usuario() from public, anon;
grant usage on schema privado to authenticated;
grant execute on function privado.usuario_actual_id(), privado.es_admin() to authenticated;

-- ---------------------------------------------------------------------
-- 2) Columnas de auditoría + trigger en TODAS las tablas de los módulos
-- ---------------------------------------------------------------------
do $$
declare t record;
begin
  for t in
    select table_schema, table_name from information_schema.tables
    where table_type = 'BASE TABLE'
      and table_schema in ('seguridad','panel_control','wikidocs','presupuesto','proyectos','familia')
  loop
    execute format($f$
      alter table %1$I.%2$I
        add column if not exists fecha_creacion     timestamptz not null default now(),
        add column if not exists fecha_modificacion timestamptz,
        add column if not exists creado_por         bigint,
        add column if not exists modificado_por     bigint,
        add column if not exists activo             boolean not null default true
    $f$, t.table_schema, t.table_name);
    execute format('create trigger trg_auditoria before insert or update on %I.%I
                    for each row execute function privado.auditoria()', t.table_schema, t.table_name);
  end loop;
end $$;

-- Los registros personales toman al dueño de la sesión si la app no lo manda.
do $$
declare t record;
begin
  for t in
    select table_schema, table_name from information_schema.columns
    where column_name = 'creado_por_usuario_id'
      and table_schema in ('presupuesto')
  loop
    execute format('alter table %I.%I alter column creado_por_usuario_id set default privado.usuario_actual_id()',
                   t.table_schema, t.table_name);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3) Índices en todas las llaves foráneas que no tengan uno
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tabla, n.nspname as esquema, cl.relname as nombre_tabla,
           a.attname as columna
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_namespace n on n.oid = cl.relnamespace
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and array_length(c.conkey, 1) = 1
      and n.nspname in ('seguridad','panel_control','wikidocs','presupuesto','proyectos','familia')
      and not exists (
        select 1 from pg_index i
        where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]
      )
  loop
    execute format('create index if not exists %I on %s (%I)',
                   left(r.nombre_tabla || '_' || r.columna || '_ix', 63), r.tabla, r.columna);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4) Permisos de rol (anon no tiene acceso a nada)
-- ---------------------------------------------------------------------
do $$
declare s text;
begin
  foreach s in array array['seguridad','panel_control','wikidocs','presupuesto','proyectos','familia'] loop
    execute format('revoke all on all tables in schema %I from anon', s);
    execute format('grant usage on schema %I to authenticated, service_role', s);
    execute format('grant select, insert, update, delete on all tables in schema %I to authenticated', s);
    execute format('grant all on all tables in schema %I to service_role', s);
    execute format('grant usage, select on all sequences in schema %I to authenticated, service_role', s);
    execute format('alter default privileges in schema %I grant select, insert, update, delete on tables to authenticated', s);
    execute format('alter default privileges in schema %I grant all on tables to service_role', s);
    execute format('alter default privileges in schema %I grant usage, select on sequences to authenticated, service_role', s);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5) RLS
-- ---------------------------------------------------------------------
do $$
declare t record;
begin
  for t in
    select table_schema, table_name from information_schema.tables
    where table_type = 'BASE TABLE'
      and table_schema in ('seguridad','panel_control','wikidocs','presupuesto','proyectos','familia')
  loop
    execute format('alter table %I.%I enable row level security', t.table_schema, t.table_name);
  end loop;
end $$;

-- 5a) Tablas COMPARTIDAS: cualquier usuario activo y vigente puede todo.
do $$
declare t text;
begin
  foreach t in array array[
    'panel_control.valor_lista',
    'wikidocs.tipo_sistema','wikidocs.categoria','wikidocs.seccion','wikidocs.documento',
    'wikidocs.documento_favorito','wikidocs.documento_version','wikidocs.plantilla_documento',
    'wikidocs.documento_adjunto',
    'presupuesto.categoria_presupuesto','presupuesto.cuenta_presupuesto','presupuesto.presupuesto_anual',
    'proyectos.proyecto','proyectos.ticket_tipo','proyectos.ticket_prioridad',
    'proyectos.ticket_prioridad_notificar','proyectos.ticket_modulo','proyectos.tablero_columna',
    'proyectos.sprint','proyectos.ticket','proyectos.ticket_comentario','proyectos.ticket_actividad',
    'proyectos.ticket_etiqueta','proyectos.ticket_adjunto','proyectos.ticket_historial_estado',
    'proyectos.ticket_dependencia','proyectos.ticket_seguidor',
    'familia.miembro_familia','familia.documento_familia','familia.documento_familia_adjunto',
    'familia.vacuna_miembro','familia.vacuna_miembro_adjunto','familia.cita_medica_miembro',
    'familia.cita_medica_miembro_adjunto','familia.poliza_seguro_miembro','familia.medicion_crecimiento',
    'familia.contacto_emergencia_miembro','familia.evento_familiar','familia.tarea_hogar',
    'familia.tramite_estado','familia.tramite_familiar'
  ] loop
    execute format('create policy compartida_todo on %s for all to authenticated
                    using ((select privado.usuario_actual_id()) is not null)
                    with check ((select privado.usuario_actual_id()) is not null)', t);
  end loop;
end $$;

-- 5b) Tablas PERSONALES de Presupuesto: solo el dueño (creado_por_usuario_id).
do $$
declare t text;
begin
  foreach t in array array[
    'presupuesto.movimiento_presupuesto','presupuesto.movimiento_recurrente_presupuesto',
    'presupuesto.deuda_presupuesto','presupuesto.deuda_presupuesto_abono',
    'presupuesto.meta_presupuesto','presupuesto.meta_presupuesto_aporte',
    'presupuesto.limite_presupuesto','presupuesto.proyeccion_ajuste'
  ] loop
    execute format('create policy personal_todo on %s for all to authenticated
                    using (creado_por_usuario_id = (select privado.usuario_actual_id()))
                    with check (creado_por_usuario_id = (select privado.usuario_actual_id()))', t);
  end loop;
end $$;

-- Adjuntos personales: heredan del movimiento padre.
create policy personal_todo on presupuesto.movimiento_presupuesto_adjunto for all to authenticated
  using (exists (select 1 from presupuesto.movimiento_presupuesto m
                 where m.id = movimiento_presupuesto_id
                   and m.creado_por_usuario_id = (select privado.usuario_actual_id())))
  with check (exists (select 1 from presupuesto.movimiento_presupuesto m
                 where m.id = movimiento_presupuesto_id
                   and m.creado_por_usuario_id = (select privado.usuario_actual_id())));

create policy personal_todo on presupuesto.movimiento_recurrente_presupuesto_adjunto for all to authenticated
  using (exists (select 1 from presupuesto.movimiento_recurrente_presupuesto m
                 where m.id = movimiento_recurrente_presupuesto_id
                   and m.creado_por_usuario_id = (select privado.usuario_actual_id())))
  with check (exists (select 1 from presupuesto.movimiento_recurrente_presupuesto m
                 where m.id = movimiento_recurrente_presupuesto_id
                   and m.creado_por_usuario_id = (select privado.usuario_actual_id())));

-- 5c) Por usuario_id (preferencias y avisos propios).
create policy propio_todo on panel_control.configuracion_apariencia for all to authenticated
  using (usuario_id = (select privado.usuario_actual_id()))
  with check (usuario_id = (select privado.usuario_actual_id()));

create policy propio_todo on presupuesto.aviso_tarjeta_ciclo for all to authenticated
  using (usuario_id = (select privado.usuario_actual_id()))
  with check (usuario_id = (select privado.usuario_actual_id()));

-- Notificaciones: cualquiera puede crearle una a otro usuario (p.ej. al asignar
-- un ticket); solo el destinatario las ve, marca como leídas o borra.
create policy notificacion_insertar on seguridad.notificacion for insert to authenticated
  with check ((select privado.usuario_actual_id()) is not null);
create policy notificacion_ver on seguridad.notificacion for select to authenticated
  using (usuario_id = (select privado.usuario_actual_id()));
create policy notificacion_actualizar on seguridad.notificacion for update to authenticated
  using (usuario_id = (select privado.usuario_actual_id()))
  with check (usuario_id = (select privado.usuario_actual_id()));
create policy notificacion_borrar on seguridad.notificacion for delete to authenticated
  using (usuario_id = (select privado.usuario_actual_id()));

-- 5d) Seguridad.usuario: todos los vigentes ven la lista (asignados, autores);
-- cada quien ve su propio registro aunque esté vencido; solo admin da de
-- alta/modifica/da de baja a otros.
create policy usuario_ver on seguridad.usuario for select to authenticated
  using ((select privado.usuario_actual_id()) is not null or auth_user_id = (select auth.uid()));
create policy usuario_admin_insertar on seguridad.usuario for insert to authenticated
  with check ((select privado.es_admin()));
create policy usuario_actualizar on seguridad.usuario for update to authenticated
  using ((select privado.es_admin()) or id = (select privado.usuario_actual_id()))
  with check ((select privado.es_admin()) or id = (select privado.usuario_actual_id()));
create policy usuario_admin_borrar on seguridad.usuario for delete to authenticated
  using ((select privado.es_admin()));

-- Un no-admin solo edita su propio perfil y sin tocar rol, vigencia ni activo.
create or replace function privado.proteger_campos_usuario()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is not null and not privado.es_admin() then
    new.role                  := old.role;
    new.fecha_inicio_vigencia := old.fecha_inicio_vigencia;
    new.fecha_fin_vigencia    := old.fecha_fin_vigencia;
    new.activo                := old.activo;
    new.auth_user_id          := old.auth_user_id;
  end if;
  return new;
end;
$$;
revoke all on function privado.proteger_campos_usuario() from public, anon;
create trigger trg_proteger_campos before update on seguridad.usuario
  for each row execute function privado.proteger_campos_usuario();

-- 5e) Roles y permisos: lectura para todos los vigentes, escritura solo admin.
do $$
declare t text;
begin
  foreach t in array array['seguridad.rol','seguridad.permiso','seguridad.rol_permiso'] loop
    execute format('create policy catalogo_ver on %s for select to authenticated
                    using ((select privado.usuario_actual_id()) is not null)', t);
    execute format('create policy catalogo_admin_insertar on %s for insert to authenticated
                    with check ((select privado.es_admin()))', t);
    execute format('create policy catalogo_admin_actualizar on %s for update to authenticated
                    using ((select privado.es_admin())) with check ((select privado.es_admin()))', t);
    execute format('create policy catalogo_admin_borrar on %s for delete to authenticated
                    using ((select privado.es_admin()))', t);
  end loop;
end $$;

-- 5f) Bitácora: cualquiera vigente escribe; solo admin consulta. Nadie la edita/borra.
create policy bitacora_insertar on seguridad.bitacora for insert to authenticated
  with check ((select privado.usuario_actual_id()) is not null);
create policy bitacora_ver on seguridad.bitacora for select to authenticated
  using ((select privado.es_admin()));

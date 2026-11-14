-- ============================================================================
-- SAURIX — Línea base reproducible (Etapa B5.1, corregida en Corrección 1,
-- 2026-11-11) — Esquema: privado. ESTE ES EL PRIMER ARCHIVO A EJECUTAR.
-- Generado por introspección de pg_catalog (pg_get_functiondef, pg_get_constraintdef,
-- pg_get_indexdef, pg_get_triggerdef, pg_policies) el 2026-11-11.
-- NO es un volcado pg_dump verificado byte a byte; ver limitaciones en el reporte
-- claude/saurix-correccion2-etapa-b5-1-linea-base-2026-11.md, sección Bloque A.
-- 0 tipos personalizados, 0 secuencias independientes en todo Saurix.
--
-- CORRECCIÓN 1 (2026-11-11): este archivo ahora incluye la tabla
-- privado.configuracion_entorno y la función privado.fn_config_imagenes_requerida(),
-- que parametrizan la URL/clave/secreto que antes estaban hardcoded en 3 funciones
-- trigger de otros archivos (ver 02_seguridad.sql y 09_inventario.sql, y el informe
-- claude/saurix-b5-1-correccion1-validacion-linea-base-2026-11.md, Bloque B).
-- Sin estos valores configurados explícitamente, esas 3 funciones trigger FALLAN
-- en vez de llamar a ningún proyecto — por diseño, para que nunca puedan apuntar
-- accidentalmente a producción.
-- ============================================================================

create schema if not exists privado;

-- ----------------------------------------------------------------------------
-- Configuración de entorno (NUEVO en Corrección 1): valores que deben fijarse
-- manualmente DESPUÉS de crear el proyecto B5 y ANTES de que cualquier trigger
-- intente procesar una imagen. Se guardan en una tabla (no en código) para que
-- nunca queden hardcoded en una función, y para que un `select` baste para
-- auditar en cualquier momento qué proyecto está configurado.
-- ----------------------------------------------------------------------------
create table if not exists privado.configuracion_entorno (
  clave text primary key,
  valor text,
  fecha_modificacion timestamptz not null default now()
);

insert into privado.configuracion_entorno (clave, valor) values
  ('imagenes_webhook_url', null),
  ('imagenes_anon_key', null)
on conflict (clave) do nothing;

-- Defensa en profundidad (B5.2, Fase 1 preflight): además de no otorgar
-- ningún GRANT a anon/authenticated/service_role sobre esta tabla (ver
-- 11_grants.sql), se habilita RLS sin ninguna política — denegación por
-- defecto para cualquier rol que no sea el propietario (postgres) o una
-- función SECURITY DEFINER de su propiedad. El propietario de la tabla
-- y las funciones SECURITY DEFINER que posee (como
-- privado.fn_config_imagenes_requerida(), abajo) no están sujetos a RLS,
-- así que esto no cambia el comportamiento funcional — es, únicamente,
-- una segunda barrera que no depende solo de que nadie otorgue un GRANT
-- por error en el futuro.
alter table privado.configuracion_entorno enable row level security;

-- Solo debe poder leerla/escribirla directamente el rol postgres/administrador
-- durante el aprovisionamiento, y la función SECURITY DEFINER de abajo (que
-- corre con los privilegios de su propietario, no los del invocador).

-- ----------------------------------------------------------------------------
-- privado.fn_config_imagenes_requerida(): única vía por la que las 3 funciones
-- trigger de procesamiento de imágenes obtienen la URL y la clave anon del
-- proyecto. Lanza una excepción (bloquea la llamada HTTP) en 3 casos:
--   1) el valor no está configurado (NULL o vacío) — nadie llenó la tabla;
--   2) la URL configurada es, literalmente, la del proyecto de PRODUCCIÓN
--      original (fcumlscwxcmzxkknjjgo) — lista de bloqueo explícita;
--   3) la clave configurada es, literalmente, la clave "anon" de producción
--      que existía hardcoded en el código original (comparación exacta, no
--      es un secreto nuevo: es el mismo valor público que ya estaba en las
--      3 funciones antes de esta corrección, usado aquí solo como entrada
--      de una lista de bloqueo, nunca para autenticar nada).
-- En los 3 casos el resultado es el mismo: ninguna llamada HTTP sale hacia
-- ningún proyecto. No hay una ruta de código que, por omisión o por copiar/
-- pegar el valor viejo, termine llamando a producción.
-- ----------------------------------------------------------------------------
create or replace function privado.fn_config_imagenes_requerida()
returns table(webhook_url text, anon_key text)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_url text;
  v_anon text;
  -- Lista de bloqueo: valores exactos del proyecto de producción original,
  -- nunca válidos como configuración de un proyecto nuevo.
  c_url_bloqueada constant text := '%fcumlscwxcmzxkknjjgo%';
  c_anon_bloqueada constant text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjdW1sc2N3eGNtenhra25qamdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NTc1NDYsImV4cCI6MjEwNzEzMzU0Nn0.MJvfRCTljg3cKgo_MNaEZtaDc5i-pllLrdRgdDHNCqg';
begin
  select valor into v_url from privado.configuracion_entorno where clave = 'imagenes_webhook_url';
  select valor into v_anon from privado.configuracion_entorno where clave = 'imagenes_anon_key';

  if v_url is null or btrim(v_url) = '' then
    raise exception 'privado.configuracion_entorno.imagenes_webhook_url no está configurada. Debe fijarse con la URL de la Edge Function "tienda-imagenes" del proyecto Supabase NUEVO antes de que cualquier trigger de imágenes pueda ejecutarse.';
  end if;

  if v_anon is null or btrim(v_anon) = '' then
    raise exception 'privado.configuracion_entorno.imagenes_anon_key no está configurada. Debe fijarse con la clave "anon"/publishable del proyecto NUEVO antes de que cualquier trigger de imágenes pueda ejecutarse.';
  end if;

  if v_url ilike c_url_bloqueada then
    raise exception 'imagenes_webhook_url contiene la referencia del proyecto de PRODUCCIÓN original (fcumlscwxcmzxkknjjgo). Bloqueado explícitamente: nunca se permite que este entorno llame al proyecto de producción.';
  end if;

  if v_anon = c_anon_bloqueada then
    raise exception 'imagenes_anon_key es, literalmente, la clave anon del proyecto de PRODUCCIÓN original. Bloqueado explícitamente: configure la clave anon del proyecto NUEVO, nunca la copiada de producción.';
  end if;

  webhook_url := v_url;
  anon_key := v_anon;
  return next;
end;
$function$
;

CREATE OR REPLACE FUNCTION privado.al_crear_empresa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform privado.sembrar_listas_empresa(new.id);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION privado.auditoria()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'INSERT' then
    new.fecha_creacion     := now();
    new.fecha_modificacion := null;
    new.creado_por         := coalesce(new.creado_por, privado.usuario_actual_id());
    new.modificado_por     := null;
  else
    new.fecha_creacion := old.fecha_creacion;
    new.creado_por     := old.creado_por;
    if coalesce(current_setting('privado.sincronizacion_interna', true), 'off') = 'on' then
      -- Sincronización interna del sistema (p.ej. recalcular
      -- ticket.resuelto tras reordenar columnas del tablero): no es una
      -- edición real del usuario, se conserva fecha_modificacion/
      -- modificado_por tal como estaban.
      new.fecha_modificacion := old.fecha_modificacion;
      new.modificado_por     := old.modificado_por;
    else
      new.fecha_modificacion := now();
      new.modificado_por     := privado.usuario_actual_id();
    end if;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION privado.crear_perfil_usuario()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION privado.empresa_actual_id()
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select e.id
  from seguridad.usuario u
  join seguridad.empresa e
    on e.id = case when u.es_superadmin and u.empresa_activa_id is not null
                   then u.empresa_activa_id else u.empresa_id end
   and e.activo
  where u.auth_user_id = auth.uid()
$function$
;

CREATE OR REPLACE FUNCTION privado.es_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from seguridad.usuario u
    where u.auth_user_id = auth.uid()
      and u.activo
      and current_date between u.fecha_inicio_vigencia and u.fecha_fin_vigencia
      and u.role = 'admin'
  )
$function$
;

CREATE OR REPLACE FUNCTION privado.es_superadmin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from seguridad.usuario u
    where u.auth_user_id = auth.uid() and u.es_superadmin and u.activo
  )
$function$
;

CREATE OR REPLACE FUNCTION privado.fn_sincronizar_resuelto_proyecto(p_proyecto_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform set_config('privado.sincronizacion_interna', 'on', true);

  update proyectos.ticket t
  set resuelto = (t.tablero_columna_id = uc.columna_id)
  from (
    select id as columna_id
    from proyectos.tablero_columna
    where proyecto_id = p_proyecto_id
    order by orden desc
    limit 1
  ) uc
  where t.proyecto_id = p_proyecto_id
    and t.resuelto is distinct from (t.tablero_columna_id = uc.columna_id);

  perform set_config('privado.sincronizacion_interna', 'off', true);
end;
$function$
;

CREATE OR REPLACE FUNCTION privado.fn_tablero_columna_sincronizar_resueltos()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'DELETE' then
    perform privado.fn_sincronizar_resuelto_proyecto(old.proyecto_id);
  else
    perform privado.fn_sincronizar_resuelto_proyecto(new.proyecto_id);
    if tg_op = 'UPDATE' and old.proyecto_id is distinct from new.proyecto_id then
      perform privado.fn_sincronizar_resuelto_proyecto(old.proyecto_id);
    end if;
  end if;
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION privado.fn_ticket_calcular_resuelto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ultima_columna_id bigint;
begin
  select tc.id into v_ultima_columna_id
  from proyectos.tablero_columna tc
  where tc.proyecto_id = new.proyecto_id
  order by tc.orden desc
  limit 1;

  new.resuelto := (new.tablero_columna_id = v_ultima_columna_id);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION privado.fn_verificar_secreto_webhook(p_valor text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select p_valor is not null
     and p_valor = (select decrypted_secret from vault.decrypted_secrets where name = 'webhook_tienda_imagenes');
$function$
;

CREATE OR REPLACE FUNCTION privado.importar_entidad(p_entidad text, p_filas jsonb, p_usuarios jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_yo          bigint := privado.usuario_actual_id();
  v_tabla       text := lower(regexp_replace(p_entidad, '([a-z0-9])([A-Z])', '\1_\2', 'g'));
  v_esquema     text;
  v_mapa        jsonb := '{}';
  v_usr         jsonb;
  v_id          bigint;
  v_fila        jsonb;
  v_r           jsonb;
  v_limpia      jsonb;
  v_valor       jsonb;
  v_cols        text[];
  v_autorefs    text[];
  v_tiene_id    boolean;
  v_n           integer;
  v_ok          integer := 0;
  v_omitidos    integer := 0;
  v_errores     jsonb := '[]';
  v_col         text;
  v_cols_usuario text[] := array['usuario_id','creado_por_usuario_id','asignado_usuario_id','reportado_por_usuario_id','creado_por'];
  v_nombres     text[];
  v_tipos       text[];
  v_nulos       boolean[];
  i             integer;
begin
  if not privado.es_admin() then
    raise exception 'Solo un administrador puede importar respaldos.';
  end if;

  select table_schema into v_esquema
  from information_schema.tables
  where table_name = v_tabla
    and table_schema in ('seguridad','panel_control','wikidocs','presupuesto','proyectos','familia')
  limit 1;
  if v_esquema is null or v_tabla = 'usuario' then
    return jsonb_build_object('entidad', p_entidad, 'sinTabla', true, 'filas', jsonb_array_length(coalesce(p_filas, '[]')));
  end if;

  for v_usr in select * from jsonb_array_elements(coalesce(p_usuarios, '[]')) loop
    select u.id into v_id from seguridad.usuario u where lower(u.nombre_usuario) = lower(v_usr->>'nombreUsuario');
    v_mapa := v_mapa || jsonb_build_object(v_usr->>'id', coalesce(v_id, v_yo));
  end loop;

  select coalesce(array_agg(a.attname::text), '{}') into v_autorefs
  from pg_constraint k
  join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
  where k.contype = 'f' and k.conrelid = format('%I.%I', v_esquema, v_tabla)::regclass and k.confrelid = k.conrelid;

  select array_agg(column_name::text order by ordinal_position),
         array_agg(data_type::text order by ordinal_position),
         array_agg(is_nullable = 'YES' order by ordinal_position)
    into v_nombres, v_tipos, v_nulos
  from information_schema.columns
  where table_schema = v_esquema and table_name = v_tabla;

  v_tiene_id := v_tabla not in ('bitacora');

  execute format('alter table %I.%I disable trigger trg_auditoria', v_esquema, v_tabla);

  for v_fila in select * from jsonb_array_elements(coalesce(p_filas, '[]')) loop
    select coalesce(jsonb_object_agg(lower(regexp_replace(k, '([a-z0-9])([A-Z])', '\1_\2', 'g')), v), '{}')
      into v_r from jsonb_each(v_fila) e(k, v);

    v_limpia := '{}';
    v_cols := '{}';
    for i in 1 .. coalesce(array_length(v_nombres, 1), 0) loop
      v_col := v_nombres[i];
      continue when not (v_r ? v_col);
      continue when v_col = 'id' and not v_tiene_id;
      continue when v_col = any (v_autorefs);
      v_valor := v_r -> v_col;
      if v_col like '%\_id' and v_col <> 'id' and v_valor = '0'::jsonb then v_valor := 'null'; end if;
      if v_tipos[i] not in ('text', 'character varying') and v_valor = '""'::jsonb then v_valor := 'null'; end if;
      if v_col = any (v_cols_usuario) and jsonb_typeof(v_valor) = 'number' then
        v_valor := coalesce(v_mapa -> (v_valor #>> '{}'), to_jsonb(v_yo));
      end if;
      continue when v_valor = 'null'::jsonb and not v_nulos[i];
      v_limpia := v_limpia || jsonb_build_object(v_col, v_valor);
      v_cols := v_cols || v_col;
    end loop;

    if not ('creado_por' = any (v_cols)) then
      v_limpia := v_limpia || jsonb_build_object('creado_por', v_yo);
      v_cols := v_cols || 'creado_por'::text;
    end if;

    begin
      execute format(
        'insert into %I.%I (%s) overriding system value select %s from jsonb_populate_record(null::%I.%I, $1) on conflict do nothing',
        v_esquema, v_tabla,
        (select string_agg(format('%I', x), ', ') from unnest(v_cols) x),
        (select string_agg(format('%I', x), ', ') from unnest(v_cols) x),
        v_esquema, v_tabla)
      using v_limpia;
      get diagnostics v_n = row_count;
      if v_n > 0 then v_ok := v_ok + 1; else v_omitidos := v_omitidos + 1; end if;
    exception when others then
      v_omitidos := v_omitidos + 1;
      if jsonb_array_length(v_errores) < 5 then
        v_errores := v_errores || to_jsonb(format('id %s: %s', v_fila->>'id', sqlerrm));
      end if;
    end;
  end loop;

  if array_length(v_autorefs, 1) > 0 then
    for v_fila in select * from jsonb_array_elements(coalesce(p_filas, '[]')) loop
      select coalesce(jsonb_object_agg(lower(regexp_replace(k, '([a-z0-9])([A-Z])', '\1_\2', 'g')), v), '{}')
        into v_r from jsonb_each(v_fila) e(k, v);
      foreach v_col in array v_autorefs loop
        if v_r ? v_col and jsonb_typeof(v_r -> v_col) = 'number' and (v_r ->> v_col)::bigint <> 0 then
          begin
            execute format('update %I.%I set %I = $1 where id = $2', v_esquema, v_tabla, v_col)
              using (v_r ->> v_col)::bigint, (v_r ->> 'id')::bigint;
          exception when others then
            if jsonb_array_length(v_errores) < 5 then
              v_errores := v_errores || to_jsonb(format('id %s (%s): %s', v_r->>'id', v_col, sqlerrm));
            end if;
          end;
        end if;
      end loop;
    end loop;
  end if;

  execute format('alter table %I.%I enable trigger trg_auditoria', v_esquema, v_tabla);

  if v_tiene_id then
    execute format(
      'select setval(pg_get_serial_sequence(%L, ''id''), greatest((select coalesce(max(id), 0) from %I.%I), 1))',
      v_esquema || '.' || v_tabla, v_esquema, v_tabla);
  end if;

  return jsonb_build_object('entidad', p_entidad, 'importados', v_ok, 'omitidos', v_omitidos, 'errores', v_errores);
end;
$function$
;

CREATE OR REPLACE FUNCTION privado.modulo_habilitado(p_modulo text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from seguridad.empresa_modulo em
    where em.empresa_id = (select privado.empresa_actual_id())
      and em.modulo_clave = p_modulo
      and em.activo
  )
$function$
;

CREATE OR REPLACE FUNCTION privado.proteger_campos_usuario()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

-- NOTA (Bloque B, B5.1): privado.prueba_temporal / prueba_temporal2 / prueba_temporal3
-- son funciones de prueba residuales, sin uso funcional conocido (devuelven 1, 1 y 2
-- respectivamente). Se conservan aquí porque existen hoy en producción y esta etapa
-- no debe modificar producción para retirarlas primero. SE RECOMIENDA EXCLUIRLAS
-- manualmente al aprovisionar B5, o retirarlas de producción en una corrección futura
-- (ya recomendado en B4.5) para que la futura línea base no vuelva a incluirlas.
CREATE OR REPLACE FUNCTION privado.prueba_temporal()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
begin
  return 1;
end;
$function$
;

CREATE OR REPLACE FUNCTION privado.prueba_temporal2()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  return 1;
end;
$function$
;

CREATE OR REPLACE FUNCTION privado.prueba_temporal3()
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
declare
  v_x bigint := 1 + 1;
begin
  return v_x;
end;
$function$
;

CREATE OR REPLACE FUNCTION privado.sembrar_listas_empresa(p_empresa bigint)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION privado.usuario_actual_id()
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select u.id
  from seguridad.usuario u
  where u.auth_user_id = auth.uid()
    and u.activo
    and current_date between u.fecha_inicio_vigencia and u.fecha_fin_vigencia
$function$
;

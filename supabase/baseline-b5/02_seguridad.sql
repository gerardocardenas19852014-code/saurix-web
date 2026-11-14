-- ============================================================================
-- SAURIX — Línea base reproducible (Etapa B5.1, corregida en Corrección 1,
-- 2026-11-11) — Esquema: seguridad. SEGUNDO archivo a ejecutar (después de
-- 01_privado.sql; ANTES de 03_comercial.sql..10_ventas.sql, porque todos los
-- demás esquemas de aplicación tienen llaves foráneas hacia seguridad.empresa/
-- seguridad.usuario — ver 13_procedimiento_reconstruccion.md, orden corregido).
-- Generado por introspección de pg_catalog el 2026-11-11. Ver limitaciones en
-- claude/saurix-correccion2-etapa-b5-1-linea-base-2026-11.md, Bloque A.
--
-- CORRECCIÓN 1 (2026-11-11): las 2 funciones trigger de imágenes de este archivo
-- (fn_trigger_procesar_logo_empresa, fn_trigger_procesar_portada_empresa) ya NO
-- tienen la URL ni la clave anon codificadas (hardcoded) en su cuerpo. Ahora
-- obtienen ambos valores de privado.fn_config_imagenes_requerida() (definida en
-- 01_privado.sql), que lanza una excepción si no están configurados o si
-- contienen los valores del proyecto de producción original — ver el detalle
-- completo en claude/saurix-b5-1-correccion1-validacion-linea-base-2026-11.md,
-- Bloque B. Antes de que estos triggers puedan procesar una imagen en el
-- proyecto B5, debe ejecutarse:
--   update privado.configuracion_entorno set valor = '<url edge function B5>', fecha_modificacion = now() where clave = 'imagenes_webhook_url';
--   update privado.configuracion_entorno set valor = '<clave anon/publishable B5>', fecha_modificacion = now() where clave = 'imagenes_anon_key';
-- ============================================================================

create schema if not exists seguridad;

create table seguridad.bitacora (
  id bigint generated always as identity not null,
  modulo text not null,
  entidad text not null,
  accion text not null,
  registro_id bigint,
  usuario text not null,
  fecha timestamp with time zone not null default now(),
  cambios jsonb not null default '[]'::jsonb,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table seguridad.empresa (
  id bigint generated always as identity not null,
  clave text not null,
  nombre text not null,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  max_usuarios integer,
  descripcion_publica text,
  telefono_pedidos text,
  correo_pedidos text,
  logo_publico text,
  catalogo_publico_activo boolean not null default false,
  horario_atencion jsonb,
  metodos_pago jsonb,
  pedido_minimo numeric(14,2),
  envio_origen_lat numeric(10,6),
  envio_origen_lng numeric(10,6),
  envio_precio_km numeric(14,2),
  envio_minimo numeric(14,2),
  envio_distancia_maxima_km numeric(10,2),
  volver_pedir_activo boolean not null default true,
  color_acento text,
  color_texto_banner text,
  catalogo_publico_acepta_pedidos boolean not null default true,
  envio_propio_activo boolean not null default true,
  envio_propio_pedido_minimo integer,
  recoleccion_activa boolean not null default false,
  direccion_publica text,
  envio_plataforma_activo boolean not null default false,
  envio_plataforma_negocio_solicita boolean not null default true,
  envio_plataforma_cliente_solicita boolean not null default false,
  logo_url text,
  logo_version bigint not null default 0,
  modo_tienda text not null default 'pedidos_online'::text,
  siguiente_folio_tienda bigint not null default 1,
  imagen_portada_publica text,
  imagen_portada_url text,
  imagen_portada_version integer not null default 0
);

create table seguridad.empresa_modulo (
  id bigint generated always as identity not null,
  empresa_id bigint not null,
  modulo_clave text not null,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true
);

create table seguridad.permiso (
  id bigint generated always as identity not null,
  nombre text not null,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table seguridad.rol (
  id bigint generated always as identity not null,
  nombre text not null,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table seguridad.rol_permiso (
  id bigint generated always as identity not null,
  rol_id bigint not null,
  permiso_id bigint not null,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table seguridad.usuario (
  id bigint generated always as identity not null,
  auth_user_id uuid,
  nombre_usuario text not null,
  nombre text not null,
  apellido_paterno text,
  apellido_materno text,
  email text not null,
  role text not null default 'viewer'::text,
  fecha_inicio_vigencia date not null default CURRENT_DATE,
  fecha_fin_vigencia date not null default '2100-12-31'::date,
  ultimo_acceso timestamp with time zone,
  debe_cambiar_password boolean not null default false,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id(),
  es_superadmin boolean not null default false,
  empresa_activa_id bigint
);

alter table seguridad.bitacora enable row level security;

alter table seguridad.empresa enable row level security;

alter table seguridad.empresa_modulo enable row level security;

alter table seguridad.permiso enable row level security;

alter table seguridad.rol enable row level security;

alter table seguridad.rol_permiso enable row level security;

alter table seguridad.usuario enable row level security;

alter table seguridad.bitacora add constraint bitacora_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table seguridad.bitacora add constraint bitacora_pkey PRIMARY KEY (id);

alter table seguridad.empresa add constraint empresa_pkey PRIMARY KEY (id);

alter table seguridad.empresa add constraint empresa_modo_tienda_check CHECK ((modo_tienda = ANY (ARRAY['menu_visual'::text, 'menu_orden'::text, 'pedidos_online'::text])));

alter table seguridad.empresa_modulo add constraint empresa_modulo_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id) ON DELETE CASCADE;

alter table seguridad.empresa_modulo add constraint empresa_modulo_pkey PRIMARY KEY (id);

alter table seguridad.empresa_modulo add constraint empresa_modulo_empresa_id_modulo_clave_key UNIQUE (empresa_id, modulo_clave);

alter table seguridad.permiso add constraint permiso_pkey PRIMARY KEY (id);

alter table seguridad.permiso add constraint permiso_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table seguridad.rol add constraint rol_pkey PRIMARY KEY (id);

alter table seguridad.rol add constraint rol_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table seguridad.rol_permiso add constraint rol_permiso_rol_id_fkey FOREIGN KEY (rol_id) REFERENCES seguridad.rol(id) ON DELETE CASCADE;

alter table seguridad.rol_permiso add constraint rol_permiso_pkey PRIMARY KEY (id);

alter table seguridad.rol_permiso add constraint rol_permiso_permiso_id_fkey FOREIGN KEY (permiso_id) REFERENCES seguridad.permiso(id) ON DELETE CASCADE;

alter table seguridad.rol_permiso add constraint rol_permiso_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table seguridad.rol_permiso add constraint rol_permiso_rol_id_permiso_id_key UNIQUE (rol_id, permiso_id);

alter table seguridad.usuario add constraint usuario_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table seguridad.usuario add constraint usuario_apellido_materno_check CHECK (((apellido_materno IS NULL) OR (char_length(apellido_materno) <= 30)));

alter table seguridad.usuario add constraint usuario_apellido_paterno_check CHECK (((apellido_paterno IS NULL) OR (char_length(apellido_paterno) <= 30)));

alter table seguridad.usuario add constraint usuario_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table seguridad.usuario add constraint usuario_auth_user_id_key UNIQUE (auth_user_id);

alter table seguridad.usuario add constraint usuario_empresa_activa_id_fkey FOREIGN KEY (empresa_activa_id) REFERENCES seguridad.empresa(id) ON DELETE SET NULL;

alter table seguridad.usuario add constraint usuario_nombre_check CHECK (((char_length(nombre) >= 3) AND (char_length(nombre) <= 30)));

alter table seguridad.usuario add constraint usuario_nombre_usuario_check CHECK ((char_length(nombre_usuario) >= 4));

alter table seguridad.usuario add constraint usuario_pkey PRIMARY KEY (id);

alter table seguridad.usuario add constraint usuario_vigencia_ck CHECK ((fecha_fin_vigencia >= fecha_inicio_vigencia));

CREATE INDEX bitacora_empresa_id_ix ON seguridad.bitacora USING btree (empresa_id);

CREATE INDEX bitacora_fecha_ix ON seguridad.bitacora USING btree (fecha DESC);

CREATE UNIQUE INDEX empresa_clave_uk ON seguridad.empresa USING btree (lower(clave));

CREATE INDEX empresa_modulo_empresa_id_ix ON seguridad.empresa_modulo USING btree (empresa_id);

CREATE INDEX permiso_empresa_id_ix ON seguridad.permiso USING btree (empresa_id);

CREATE UNIQUE INDEX permiso_empresa_nombre_uk ON seguridad.permiso USING btree (empresa_id, nombre);

CREATE INDEX rol_empresa_id_ix ON seguridad.rol USING btree (empresa_id);

CREATE UNIQUE INDEX rol_empresa_nombre_uk ON seguridad.rol USING btree (empresa_id, nombre);

CREATE INDEX rol_permiso_empresa_id_ix ON seguridad.rol_permiso USING btree (empresa_id);

CREATE INDEX rol_permiso_permiso_id_ix ON seguridad.rol_permiso USING btree (permiso_id);

CREATE INDEX usuario_empresa_id_ix ON seguridad.usuario USING btree (empresa_id);

CREATE INDEX usuario_empresa_activa_id_ix ON seguridad.usuario USING btree (empresa_activa_id);

CREATE UNIQUE INDEX usuario_nombre_usuario_uk ON seguridad.usuario USING btree (lower(nombre_usuario));

CREATE UNIQUE INDEX usuario_email_uk ON seguridad.usuario USING btree (lower(email));

create policy solo_mi_empresa on seguridad.bitacora as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy bitacora_ver on seguridad.bitacora as permissive for SELECT to authenticated
  using (( SELECT privado.es_admin() AS es_admin));

create policy bitacora_insertar on seguridad.bitacora as permissive for INSERT to authenticated
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy empresa_superadmin on seguridad.empresa as permissive for ALL to authenticated
  using (( SELECT privado.es_superadmin() AS es_superadmin))
  with check (( SELECT privado.es_superadmin() AS es_superadmin));

create policy empresa_ver on seguridad.empresa as permissive for SELECT to authenticated
  using (((id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)) OR ( SELECT privado.es_superadmin() AS es_superadmin)));

create policy ver_modulos on seguridad.empresa_modulo as permissive for SELECT to authenticated
  using (((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)) OR ( SELECT privado.es_superadmin() AS es_superadmin)));

create policy escribir_modulos_superadmin on seguridad.empresa_modulo as permissive for ALL to authenticated
  using (( SELECT privado.es_superadmin() AS es_superadmin))
  with check (( SELECT privado.es_superadmin() AS es_superadmin));

create policy catalogo_ver on seguridad.permiso as permissive for SELECT to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy catalogo_admin_actualizar on seguridad.permiso as permissive for UPDATE to authenticated
  using (( SELECT privado.es_admin() AS es_admin))
  with check (( SELECT privado.es_admin() AS es_admin));

create policy catalogo_admin_borrar on seguridad.permiso as permissive for DELETE to authenticated
  using (( SELECT privado.es_admin() AS es_admin));

create policy catalogo_admin_insertar on seguridad.permiso as permissive for INSERT to authenticated
  with check (( SELECT privado.es_admin() AS es_admin));

create policy solo_mi_empresa on seguridad.permiso as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy catalogo_admin_borrar on seguridad.rol as permissive for DELETE to authenticated
  using (( SELECT privado.es_admin() AS es_admin));

create policy catalogo_admin_actualizar on seguridad.rol as permissive for UPDATE to authenticated
  using (( SELECT privado.es_admin() AS es_admin))
  with check (( SELECT privado.es_admin() AS es_admin));

create policy catalogo_admin_insertar on seguridad.rol as permissive for INSERT to authenticated
  with check (( SELECT privado.es_admin() AS es_admin));

create policy catalogo_ver on seguridad.rol as permissive for SELECT to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on seguridad.rol as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy solo_mi_empresa on seguridad.rol_permiso as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy catalogo_ver on seguridad.rol_permiso as permissive for SELECT to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy catalogo_admin_insertar on seguridad.rol_permiso as permissive for INSERT to authenticated
  with check (( SELECT privado.es_admin() AS es_admin));

create policy catalogo_admin_borrar on seguridad.rol_permiso as permissive for DELETE to authenticated
  using (( SELECT privado.es_admin() AS es_admin));

create policy catalogo_admin_actualizar on seguridad.rol_permiso as permissive for UPDATE to authenticated
  using (( SELECT privado.es_admin() AS es_admin))
  with check (( SELECT privado.es_admin() AS es_admin));

create policy usuario_admin_borrar on seguridad.usuario as permissive for DELETE to authenticated
  using (( SELECT privado.es_admin() AS es_admin));

create policy solo_mi_empresa on seguridad.usuario as restrictive for ALL to authenticated
  using (((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)) OR (auth_user_id = ( SELECT auth.uid() AS uid))))
  with check (((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)) OR (auth_user_id = ( SELECT auth.uid() AS uid))));

create policy usuario_actualizar on seguridad.usuario as permissive for UPDATE to authenticated
  using ((( SELECT privado.es_admin() AS es_admin) OR (id = ( SELECT privado.usuario_actual_id() AS usuario_actual_id))))
  with check ((( SELECT privado.es_admin() AS es_admin) OR (id = ( SELECT privado.usuario_actual_id() AS usuario_actual_id))));

create policy usuario_admin_insertar on seguridad.usuario as permissive for INSERT to authenticated
  with check (( SELECT privado.es_admin() AS es_admin));

create policy usuario_ver on seguridad.usuario as permissive for SELECT to authenticated
  using (((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL) OR (auth_user_id = ( SELECT auth.uid() AS uid))));

CREATE OR REPLACE FUNCTION seguridad.cambiar_empresa_activa(p_empresa bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION seguridad.crear_mensaje_contacto(p_nombre text, p_correo text, p_telefono text, p_mensaje text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id bigint;
begin
  if coalesce(trim(p_nombre), '') = '' then
    raise exception 'El nombre es obligatorio.';
  end if;

  if coalesce(trim(p_correo), '') = '' or position('@' in p_correo) = 0 then
    raise exception 'Correo electronico invalido.';
  end if;

  if coalesce(trim(p_mensaje), '') = '' then
    raise exception 'El mensaje es obligatorio.';
  end if;

  if length(p_mensaje) > 4000 then
    raise exception 'El mensaje es demasiado largo.';
  end if;

  insert into comercial.mensaje_contacto (nombre, correo, telefono, mensaje)
  values (
    trim(p_nombre),
    trim(lower(p_correo)),
    nullif(trim(coalesce(p_telefono, '')), ''),
    trim(p_mensaje)
  )
  returning id into v_id;

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION seguridad.crear_orden_menu_qr(p_clave text, p_nombre_cliente text DEFAULT NULL::text, p_items jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_empresa_id bigint;
  v_modo text;
  v_resultado jsonb;
  v_items_guardar jsonb;
  v_total numeric;
  v_cantidad_total int;
  v_id bigint;
  v_folio text;
  v_token text;
begin
  select e.id, e.modo_tienda into v_empresa_id, v_modo
    from seguridad.empresa e
    where e.clave = lower(trim(p_clave)) and e.activo and e.catalogo_publico_activo
    limit 1;

  if v_empresa_id is null then
    return jsonb_build_object('error', 'tienda_no_encontrada');
  end if;

  if v_modo <> 'menu_orden' then
    return jsonb_build_object('error', 'modo_no_disponible');
  end if;

  v_resultado := seguridad.fn_revalidar_items_pedido(v_empresa_id, p_items);
  if v_resultado ? 'error' then
    return v_resultado;
  end if;

  v_items_guardar := v_resultado->'items';
  v_total := (v_resultado->>'total')::numeric;
  v_cantidad_total := (v_resultado->>'cantidadTotal')::int;

  insert into ventas.pedido_tienda
    (empresa_id, nombre_cliente, telefono_cliente, nombre_mostrar_en, items, total, origen, estado)
  values
    (v_empresa_id, null, null, nullif(trim(coalesce(p_nombre_cliente, '')), ''), v_items_guardar, v_total, 'menu_qr', 'Pendiente')
  returning id, folio, token_publico into v_id, v_folio, v_token;

  return jsonb_build_object(
    'id', v_id,
    'folio', v_folio,
    'token', v_token,
    'articulos', v_cantidad_total,
    'total', v_total
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION seguridad.crear_pedido_tienda(p_clave text, p_nombre text, p_telefono text, p_notas text, p_lat numeric, p_lng numeric, p_items jsonb, p_total numeric)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_empresa_id bigint;
  v_id bigint;
  v_resultado jsonb;
begin
  select e.id into v_empresa_id
    from seguridad.empresa e
    where e.clave = lower(trim(p_clave)) and e.activo and e.catalogo_publico_activo
    limit 1;

  if v_empresa_id is null then
    raise exception 'Tienda no encontrada o inactiva.';
  end if;

  if coalesce(trim(p_nombre), '') = '' or coalesce(trim(p_telefono), '') = '' then
    raise exception 'Nombre y teléfono son obligatorios.';
  end if;

  v_resultado := seguridad.fn_revalidar_items_pedido(v_empresa_id, p_items);
  if v_resultado ? 'error' then
    raise exception '%', v_resultado->>'error';
  end if;

  insert into ventas.pedido_tienda
    (empresa_id, nombre_cliente, telefono_cliente, notas_cliente, ubicacion_lat, ubicacion_lng, items, total)
  values
    (v_empresa_id, trim(p_nombre), trim(p_telefono), nullif(trim(coalesce(p_notas, '')), ''), p_lat, p_lng, v_resultado->'items', (v_resultado->>'total')::numeric)
  returning id into v_id;

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION seguridad.eliminar_empresa(p_empresa bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_mia    bigint;
  t        record;
  v_pasada int;
begin
  if not privado.es_superadmin() then
    raise exception 'Solo el superadministrador puede eliminar empresas.';
  end if;
  select empresa_id into v_mia from seguridad.usuario where auth_user_id = auth.uid();
  if p_empresa = v_mia then
    raise exception 'No puedes eliminar tu propia empresa.';
  end if;
  if not exists (select 1 from seguridad.empresa where id = p_empresa) then
    raise exception 'Esa empresa ya no existe.';
  end if;

  update seguridad.usuario set empresa_activa_id = null where empresa_activa_id = p_empresa;

  begin
    for v_pasada in 1..15 loop
      for t in
        select c.table_schema, c.table_name
        from information_schema.tables c
        where c.table_type = 'BASE TABLE'
          and c.table_schema in ('seguridad', 'panel_control', 'wikidocs', 'presupuesto', 'proyectos', 'familia', 'inventario', 'ventas')
          and exists (
            select 1 from information_schema.columns k
            where k.table_schema = c.table_schema and k.table_name = c.table_name and k.column_name = 'empresa_id'
          )
      loop
        begin
          execute format('delete from %I.%I where empresa_id = $1', t.table_schema, t.table_name) using p_empresa;
        exception when foreign_key_violation then
          null;
        end;
      end loop;
    end loop;

    for t in
      select c.table_schema, c.table_name
      from information_schema.tables c
      where c.table_type = 'BASE TABLE'
        and c.table_schema in ('seguridad', 'panel_control', 'wikidocs', 'presupuesto', 'proyectos', 'familia', 'inventario', 'ventas')
        and exists (
          select 1 from information_schema.columns k
          where k.table_schema = c.table_schema and k.table_name = c.table_name and k.column_name = 'empresa_id'
        )
    loop
      execute format('delete from %I.%I where empresa_id = $1', t.table_schema, t.table_name) using p_empresa;
    end loop;
  exception when foreign_key_violation then
    raise exception 'No se pudo eliminar: después de varios intentos todavía queda algo (fuera del orden normal de dependencias) referenciando datos de esta empresa.';
  end;

  begin
    delete from seguridad.empresa where id = p_empresa;
  exception when foreign_key_violation then
    raise exception 'No se pudo eliminar: todavía queda algo referenciando a esta empresa.';
  end;
end;
$function$
;

CREATE OR REPLACE FUNCTION seguridad.email_para_login(p_usuario text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when position('@' in coalesce(p_usuario, '')) > 0 then trim(p_usuario)
    else (select u.email from seguridad.usuario u
          where lower(u.nombre_usuario) = lower(trim(p_usuario))
          limit 1)
  end
$function$
;

CREATE OR REPLACE FUNCTION seguridad.empresa_sesion()
 RETURNS TABLE(id bigint, clave text, nombre text, es_superadmin boolean, es_soporte boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select e.id, e.clave, e.nombre, u.es_superadmin, e.id <> u.empresa_id
  from seguridad.usuario u
  join seguridad.empresa e on e.id = privado.empresa_actual_id()
  where u.auth_user_id = auth.uid()
$function$
;

CREATE OR REPLACE FUNCTION seguridad.fn_catalogo_tienda_pagina(p_clave text, p_busqueda text DEFAULT NULL::text, p_categoria_id bigint DEFAULT NULL::bigint, p_orden text DEFAULT 'categoria'::text, p_cursor_categoria_nombre text DEFAULT NULL::text, p_cursor_nombre text DEFAULT NULL::text, p_cursor_precio numeric DEFAULT NULL::numeric, p_cursor_id bigint DEFAULT NULL::bigint, p_cantidad integer DEFAULT 24)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_empresa_id bigint;
  v_modo_tienda text;
  v_cantidad int := least(greatest(coalesce(p_cantidad, 24), 1), 100);
  v_busqueda text := nullif(trim(coalesce(p_busqueda, '')), '');
  v_resultado jsonb;
begin
  select e.id, e.modo_tienda into v_empresa_id, v_modo_tienda
  from seguridad.empresa e
  where e.clave = lower(trim(p_clave)) and e.activo and e.catalogo_publico_activo
  limit 1;

  if v_empresa_id is null then
    return jsonb_build_object('error', 'tienda_no_encontrada');
  end if;

  if p_orden = 'precio' then
    with base as (
      select
        pr.id, pr.nombre, pr.descripcion, pr.precio_unitario as precio, pr.destacado, pr.fecha_creacion,
        cp.id as categoria_id, cp.nombre as categoria_nombre,
        pr.foto_thumb_url, pr.foto_detalle_url,
        coalesce(per.existencia_total, pr.existencia) as existencia_resuelta,
        pr.nivel_minimo
      from inventario.producto pr
      join inventario.categoria_producto cp on cp.id = pr.categoria_producto_id
      left join inventario.existencia_producto_resumen per on per.producto_id = pr.id
      where pr.empresa_id = v_empresa_id
        and pr.activo
        and (p_categoria_id is null or pr.categoria_producto_id = p_categoria_id)
        and (v_busqueda is null or pr.nombre ilike '%' || v_busqueda || '%')
        and (
          v_modo_tienda = 'menu_visual'
          or coalesce(per.existencia_total, pr.existencia) is null
          or coalesce(per.existencia_total, pr.existencia) > 0
        )
        and (
          p_cursor_id is null
          or (pr.precio_unitario, pr.id) > (p_cursor_precio, p_cursor_id)
        )
      order by pr.precio_unitario, pr.id
      limit v_cantidad + 1
    ),
    numerado as (
      select *, row_number() over (order by precio, id) as rn from base
    )
    select jsonb_build_object(
      'productos', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', n.id, 'nombre', n.nombre, 'descripcion', n.descripcion, 'precio', n.precio,
          'fotoThumbUrl', n.foto_thumb_url, 'fotoDetalleUrl', n.foto_detalle_url,
          'disponible', (n.existencia_resuelta is null or n.existencia_resuelta > 0),
          'destacado', n.destacado, 'fechaCreacion', n.fecha_creacion,
          'pocasExistencias', (n.existencia_resuelta is not null and n.nivel_minimo is not null
            and n.existencia_resuelta > 0 and n.existencia_resuelta <= n.nivel_minimo),
          'categoriaId', n.categoria_id, 'categoriaNombre', n.categoria_nombre,
          'opciones', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', g.id, 'nombre', g.nombre, 'tipoSeleccion', g.tipo_seleccion, 'requerido', g.requerido,
              'minimo', g.minimo, 'maximo', g.maximo,
              'valores', coalesce((
                select jsonb_agg(jsonb_build_object('id', v.id, 'nombre', v.nombre, 'precioAdicional', v.precio_adicional) order by v.orden, v.id)
                from inventario.producto_opcion_valor v where v.grupo_id = g.id and v.activo
              ), '[]'::jsonb)
            ) order by g.orden, g.id)
            from inventario.producto_opcion_grupo g where g.producto_id = n.id and g.activo
          ), '[]'::jsonb)
        ) order by n.rn)
        from numerado n where n.rn <= v_cantidad
      ), '[]'::jsonb),
      'hayMas', coalesce(bool_or(rn > v_cantidad), false),
      'cursor', (
        select jsonb_build_object('precio', n.precio, 'id', n.id)
        from numerado n where n.rn <= v_cantidad order by n.rn desc limit 1
      )
    ) into v_resultado
    from numerado;
  else
    with base as (
      select
        pr.id, pr.nombre, pr.descripcion, pr.precio_unitario as precio, pr.destacado, pr.fecha_creacion,
        cp.id as categoria_id, cp.nombre as categoria_nombre,
        pr.foto_thumb_url, pr.foto_detalle_url,
        coalesce(per.existencia_total, pr.existencia) as existencia_resuelta,
        pr.nivel_minimo
      from inventario.producto pr
      join inventario.categoria_producto cp on cp.id = pr.categoria_producto_id
      left join inventario.existencia_producto_resumen per on per.producto_id = pr.id
      where pr.empresa_id = v_empresa_id
        and pr.activo
        and (p_categoria_id is null or pr.categoria_producto_id = p_categoria_id)
        and (v_busqueda is null or pr.nombre ilike '%' || v_busqueda || '%')
        and (
          v_modo_tienda = 'menu_visual'
          or coalesce(per.existencia_total, pr.existencia) is null
          or coalesce(per.existencia_total, pr.existencia) > 0
        )
        and (
          p_cursor_id is null
          or (cp.nombre, pr.nombre, pr.id) > (p_cursor_categoria_nombre, p_cursor_nombre, p_cursor_id)
        )
      order by cp.nombre, pr.nombre, pr.id
      limit v_cantidad + 1
    ),
    numerado as (
      select *, row_number() over (order by categoria_nombre, nombre, id) as rn from base
    )
    select jsonb_build_object(
      'productos', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', n.id, 'nombre', n.nombre, 'descripcion', n.descripcion, 'precio', n.precio,
          'fotoThumbUrl', n.foto_thumb_url, 'fotoDetalleUrl', n.foto_detalle_url,
          'disponible', (n.existencia_resuelta is null or n.existencia_resuelta > 0),
          'destacado', n.destacado, 'fechaCreacion', n.fecha_creacion,
          'pocasExistencias', (n.existencia_resuelta is not null and n.nivel_minimo is not null
            and n.existencia_resuelta > 0 and n.existencia_resuelta <= n.nivel_minimo),
          'categoriaId', n.categoria_id, 'categoriaNombre', n.categoria_nombre,
          'opciones', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', g.id, 'nombre', g.nombre, 'tipoSeleccion', g.tipo_seleccion, 'requerido', g.requerido,
              'minimo', g.minimo, 'maximo', g.maximo,
              'valores', coalesce((
                select jsonb_agg(jsonb_build_object('id', v.id, 'nombre', v.nombre, 'precioAdicional', v.precio_adicional) order by v.orden, v.id)
                from inventario.producto_opcion_valor v where v.grupo_id = g.id and v.activo
              ), '[]'::jsonb)
            ) order by g.orden, g.id)
            from inventario.producto_opcion_grupo g where g.producto_id = n.id and g.activo
          ), '[]'::jsonb)
        ) order by n.rn)
        from numerado n where n.rn <= v_cantidad
      ), '[]'::jsonb),
      'hayMas', coalesce(bool_or(rn > v_cantidad), false),
      'cursor', (
        select jsonb_build_object('categoriaNombre', n.categoria_nombre, 'nombre', n.nombre, 'id', n.id)
        from numerado n where n.rn <= v_cantidad order by n.rn desc limit 1
      )
    ) into v_resultado
    from numerado;
  end if;

  return v_resultado;
end;
$function$
;

CREATE OR REPLACE FUNCTION seguridad.fn_revalidar_items_pedido(p_empresa_id bigint, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_item jsonb;
  v_producto_id bigint;
  v_cantidad int;
  v_nombre_producto text;
  v_opcion_ids bigint[];
  v_opcion_pedidos int;
  v_opcion_encontrados int;
  v_opciones_detalle jsonb;
  v_precio_base numeric;
  v_activo boolean;
  v_extra numeric;
  v_total numeric := 0;
  v_cantidad_total int := 0;
  v_items_guardar jsonb := '[]'::jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('error', 'orden_vacia');
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_producto_id := nullif(v_item->>'productoId', '')::bigint;
    v_cantidad := coalesce((v_item->>'cantidad')::int, 0);

    if v_producto_id is null or v_cantidad <= 0 or v_cantidad > 999 then
      return jsonb_build_object('error', 'item_invalido');
    end if;

    select pr.precio_unitario, pr.activo, pr.nombre into v_precio_base, v_activo, v_nombre_producto
      from inventario.producto pr
      where pr.id = v_producto_id and pr.empresa_id = p_empresa_id;

    if v_precio_base is null or v_activo is not true then
      return jsonb_build_object('error', 'producto_no_disponible', 'productoId', v_producto_id);
    end if;

    v_opcion_ids := array(
      select nullif(x, '')::bigint
      from jsonb_array_elements_text(coalesce(v_item->'opcionValorIds', '[]'::jsonb)) as x
    );
    v_opcion_pedidos := coalesce(array_length(v_opcion_ids, 1), 0);
    v_extra := 0;
    v_opcion_encontrados := 0;
    v_opciones_detalle := '[]'::jsonb;

    if v_opcion_pedidos > 0 then
      select coalesce(sum(pov.precio_adicional), 0), count(*),
             coalesce(jsonb_agg(jsonb_build_object('grupoNombre', pog.nombre, 'valorNombre', pov.nombre, 'precioAdicional', pov.precio_adicional)), '[]'::jsonb)
        into v_extra, v_opcion_encontrados, v_opciones_detalle
        from inventario.producto_opcion_valor pov
        join inventario.producto_opcion_grupo pog on pog.id = pov.grupo_id
        where pov.id = any(v_opcion_ids)
          and pog.producto_id = v_producto_id
          and pov.empresa_id = p_empresa_id;

      if v_opcion_encontrados <> v_opcion_pedidos then
        return jsonb_build_object('error', 'opcion_invalida', 'productoId', v_producto_id);
      end if;
    end if;

    v_total := v_total + ((v_precio_base + v_extra) * v_cantidad);
    v_cantidad_total := v_cantidad_total + v_cantidad;

    v_items_guardar := v_items_guardar || jsonb_build_array(jsonb_build_object(
      'productoId', v_producto_id,
      'nombreProducto', v_nombre_producto,
      'precioBase', v_precio_base,
      'opcionesElegidas', v_opciones_detalle,
      'cantidad', v_cantidad
    ));
  end loop;

  return jsonb_build_object('items', v_items_guardar, 'total', v_total, 'cantidadTotal', v_cantidad_total);
end;
$function$
;

CREATE OR REPLACE FUNCTION seguridad.fn_tienda_categorias(p_clave text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre) order by c.nombre), '[]'::jsonb)
  from (
    select distinct cp.id, cp.nombre
    from inventario.producto pr
    join inventario.categoria_producto cp on cp.id = pr.categoria_producto_id
    join seguridad.empresa e on e.id = pr.empresa_id
    where e.clave = lower(trim(p_clave)) and e.activo and e.catalogo_publico_activo
      and pr.activo
  ) c;
$function$
;

CREATE OR REPLACE FUNCTION seguridad.fn_tienda_destacados(p_clave text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with base as (
    select
      pr.id, pr.nombre, pr.descripcion, pr.precio_unitario as precio, pr.destacado, pr.fecha_creacion,
      cp.id as categoria_id, cp.nombre as categoria_nombre,
      pr.foto_thumb_url, pr.foto_detalle_url,
      coalesce(per.existencia_total, pr.existencia) as existencia_resuelta,
      pr.nivel_minimo
    from inventario.producto pr
    join inventario.categoria_producto cp on cp.id = pr.categoria_producto_id
    join seguridad.empresa e on e.id = pr.empresa_id
    left join inventario.existencia_producto_resumen per on per.producto_id = pr.id
    where e.clave = lower(trim(p_clave)) and e.activo and e.catalogo_publico_activo
      and pr.activo and pr.destacado
      and (
        e.modo_tienda = 'menu_visual'
        or coalesce(per.existencia_total, pr.existencia) is null
        or coalesce(per.existencia_total, pr.existencia) > 0
      )
    order by cp.nombre, pr.nombre
    limit 20
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'nombre', b.nombre, 'descripcion', b.descripcion, 'precio', b.precio,
    'fotoThumbUrl', b.foto_thumb_url, 'fotoDetalleUrl', b.foto_detalle_url,
    'disponible', (b.existencia_resuelta is null or b.existencia_resuelta > 0),
    'destacado', b.destacado, 'fechaCreacion', b.fecha_creacion,
    'pocasExistencias', (b.existencia_resuelta is not null and b.nivel_minimo is not null
      and b.existencia_resuelta > 0 and b.existencia_resuelta <= b.nivel_minimo),
    'categoriaId', b.categoria_id, 'categoriaNombre', b.categoria_nombre,
    'opciones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id, 'nombre', g.nombre, 'tipoSeleccion', g.tipo_seleccion, 'requerido', g.requerido,
        'minimo', g.minimo, 'maximo', g.maximo,
        'valores', coalesce((
          select jsonb_agg(jsonb_build_object('id', v.id, 'nombre', v.nombre, 'precioAdicional', v.precio_adicional) order by v.orden, v.id)
          from inventario.producto_opcion_valor v where v.grupo_id = g.id and v.activo
        ), '[]'::jsonb)
      ) order by g.orden, g.id)
      from inventario.producto_opcion_grupo g where g.producto_id = b.id and g.activo
    ), '[]'::jsonb)
  )), '[]'::jsonb)
  from base b;
$function$
;

-- *** CORRECCIÓN 1: parametrizada. Usa privado.fn_config_imagenes_requerida()
-- (01_privado.sql) en vez de valores hardcoded. Si la configuración no existe
-- o apunta a producción, lanza excepción y NO llama a ninguna URL. ***
CREATE OR REPLACE FUNCTION seguridad.fn_trigger_procesar_logo_empresa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_secreto text;
  v_cfg record;
begin
  if tg_op = 'UPDATE' and old.logo_publico is not distinct from new.logo_publico then
    return new;
  end if;

  if new.logo_publico is null then
    update seguridad.empresa set logo_url = null where id = new.id;
    return new;
  end if;

  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'webhook_tienda_imagenes';

  select * into v_cfg from privado.fn_config_imagenes_requerida();

  perform net.http_post(
    url := v_cfg.webhook_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_cfg.anon_key,
      'x-webhook-secret', v_secreto
    ),
    body := jsonb_build_object('accion', 'procesar_empresa_logo', 'empresaId', new.id)
  );
  return new;
end;
$function$
;

-- *** CORRECCIÓN 1: parametrizada. Usa privado.fn_config_imagenes_requerida()
-- (01_privado.sql) en vez de valores hardcoded. Si la configuración no existe
-- o apunta a producción, lanza excepción y NO llama a ninguna URL. ***
CREATE OR REPLACE FUNCTION seguridad.fn_trigger_procesar_portada_empresa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_secreto text;
  v_cfg record;
begin
  if tg_op = 'UPDATE' and old.imagen_portada_publica is not distinct from new.imagen_portada_publica then
    return new;
  end if;

  if new.imagen_portada_publica is null then
    update seguridad.empresa set imagen_portada_url = null where id = new.id;
    return new;
  end if;

  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'webhook_tienda_imagenes';

  select * into v_cfg from privado.fn_config_imagenes_requerida();

  perform net.http_post(
    url := v_cfg.webhook_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_cfg.anon_key,
      'x-webhook-secret', v_secreto
    ),
    body := jsonb_build_object('accion', 'procesar_empresa_portada', 'empresaId', new.id)
  );
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION seguridad.fn_verificar_secreto_webhook(p_valor text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select p_valor is not null
     and p_valor = (select decrypted_secret from vault.decrypted_secrets where name = 'webhook_tienda_imagenes');
$function$
;

CREATE OR REPLACE FUNCTION seguridad.mi_empresa()
 RETURNS TABLE(id bigint, clave text, nombre text, es_superadmin boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select e.id, e.clave, e.nombre, u.es_superadmin
  from seguridad.usuario u
  join seguridad.empresa e on e.id = privado.empresa_actual_id()
  where u.auth_user_id = auth.uid()
$function$
;

CREATE OR REPLACE FUNCTION seguridad.mis_modulos()
 RETURNS TABLE(modulo_clave text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select em.modulo_clave
  from seguridad.empresa_modulo em
  where em.empresa_id = (select privado.empresa_actual_id())
    and em.activo
$function$
;

CREATE OR REPLACE FUNCTION seguridad.tienda_detalle(p_clave text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_empresa record;
begin
  select e.id, e.clave, e.nombre, e.descripcion_publica, e.telefono_pedidos, e.correo_pedidos, e.logo_url,
         e.imagen_portada_url,
         e.horario_atencion, e.metodos_pago, e.pedido_minimo, e.volver_pedir_activo, e.color_acento, e.color_texto_banner,
         e.envio_origen_lat, e.envio_origen_lng, e.envio_precio_km, e.envio_minimo, e.envio_distancia_maxima_km,
         e.modo_tienda,
         e.envio_propio_activo, e.envio_propio_pedido_minimo, e.recoleccion_activa, e.direccion_publica,
         e.envio_plataforma_activo, e.envio_plataforma_negocio_solicita, e.envio_plataforma_cliente_solicita
    into v_empresa
    from seguridad.empresa e
    where e.clave = lower(trim(p_clave)) and e.activo and e.catalogo_publico_activo
    limit 1;

  if v_empresa.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'empresa', jsonb_build_object(
      'clave', v_empresa.clave,
      'nombre', v_empresa.nombre,
      'descripcion', v_empresa.descripcion_publica,
      'telefono', v_empresa.telefono_pedidos,
      'correo', v_empresa.correo_pedidos,
      'logo', v_empresa.logo_url,
      'imagenPortada', v_empresa.imagen_portada_url,
      'horario', coalesce(v_empresa.horario_atencion, '[]'::jsonb),
      'metodosPago', coalesce(v_empresa.metodos_pago, '[]'::jsonb),
      'pedidoMinimo', v_empresa.pedido_minimo,
      'volverPedirActivo', v_empresa.volver_pedir_activo,
      'colorAcento', v_empresa.color_acento,
      'colorTextoBanner', v_empresa.color_texto_banner,
      'envioOrigenLat', v_empresa.envio_origen_lat,
      'envioOrigenLng', v_empresa.envio_origen_lng,
      'envioPrecioKm', v_empresa.envio_precio_km,
      'envioMinimo', v_empresa.envio_minimo,
      'envioDistanciaMaximaKm', v_empresa.envio_distancia_maxima_km,
      'modo', v_empresa.modo_tienda,
      'envioPropioActivo', v_empresa.envio_propio_activo,
      'envioPropioPedidoMinimo', v_empresa.envio_propio_pedido_minimo,
      'recoleccionActiva', v_empresa.recoleccion_activa,
      'direccionPublica', v_empresa.direccion_publica,
      'envioPlataformaActivo', v_empresa.envio_plataforma_activo,
      'envioPlataformaNegocioSolicita', v_empresa.envio_plataforma_negocio_solicita,
      'envioPlataformaClienteSolicita', v_empresa.envio_plataforma_cliente_solicita
    )
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION seguridad.tiendas_activas()
 RETURNS TABLE(clave text, nombre text, descripcion text, logo text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select e.clave, e.nombre, e.descripcion_publica, e.logo_url
  from seguridad.empresa e
  where e.activo and e.catalogo_publico_activo
  order by e.nombre
$function$
;

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON seguridad.bitacora FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_sembrar_listas AFTER INSERT ON seguridad.empresa FOR EACH ROW EXECUTE FUNCTION privado.al_crear_empresa();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON seguridad.empresa FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_procesar_logo_empresa AFTER INSERT OR UPDATE OF logo_publico ON seguridad.empresa FOR EACH ROW EXECUTE FUNCTION seguridad.fn_trigger_procesar_logo_empresa();

CREATE TRIGGER trg_procesar_portada_empresa AFTER INSERT OR UPDATE OF imagen_portada_publica ON seguridad.empresa FOR EACH ROW EXECUTE FUNCTION seguridad.fn_trigger_procesar_portada_empresa();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON seguridad.empresa_modulo FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON seguridad.permiso FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON seguridad.rol FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON seguridad.rol_permiso FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON seguridad.usuario FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_proteger_campos BEFORE UPDATE ON seguridad.usuario FOR EACH ROW EXECUTE FUNCTION privado.proteger_campos_usuario();

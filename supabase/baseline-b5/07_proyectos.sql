-- ============================================================================
-- SAURIX — Línea base reproducible (Etapa B5.1) — Esquema: proyectos
-- Generado por introspección de pg_catalog el 2026-11-11. Ver limitaciones en
-- claude/saurix-correccion2-etapa-b5-1-linea-base-2026-11.md, Bloque A.
-- ============================================================================

create schema if not exists proyectos;

create table proyectos.proyecto (
  id bigint generated always as identity not null,
  nombre text not null,
  clave text not null,
  codigo_hex text not null default '#4f46e5'::text,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id(),
  es_prueba boolean not null default false
);

create table proyectos.sprint (
  id bigint generated always as identity not null,
  proyecto_id bigint not null,
  nombre text not null,
  objetivo text,
  fecha_inicio date,
  fecha_fin date,
  estado text not null default 'planeado'::text,
  orden integer,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table proyectos.tablero_columna (
  id bigint generated always as identity not null,
  proyecto_id bigint not null,
  clave text not null,
  nombre text not null,
  orden integer not null default 0,
  permite_actividades boolean not null default true,
  permite_anexos boolean not null default true,
  permite_asociados boolean not null default true,
  configuracion_campos_json text,
  transiciones_permitidas_json text,
  posicion_diagrama_json text,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table proyectos.ticket (
  id bigint generated always as identity not null,
  proyecto_id bigint not null,
  tablero_columna_id bigint not null,
  ticket_tipo_id bigint not null,
  ticket_prioridad_id bigint not null,
  ticket_modulo_id bigint,
  asignado_usuario_id bigint,
  reportado_por_usuario_id bigint not null,
  numero_ticket text not null,
  folio_interno text,
  titulo text not null,
  descripcion text,
  planeado boolean not null default false,
  tiempo_estimado_min integer,
  fecha_fin_analisis date,
  fecha_fin_desarrollo date,
  fecha_fin_cliente date,
  fecha_inicio date,
  fecha_fin date,
  solucion text,
  ticket_padre_id bigint,
  sprint_id bigint,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id(),
  resuelto boolean not null default false
);

create table proyectos.ticket_actividad (
  id bigint generated always as identity not null,
  ticket_id bigint not null,
  texto text not null,
  tiempo_min integer not null default 0,
  creado_por bigint,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table proyectos.ticket_adjunto (
  id bigint generated always as identity not null,
  ticket_id bigint not null,
  nombre_archivo text not null,
  tipo_contenido text,
  ruta_storage text not null,
  tamano_bytes bigint,
  comentario text,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table proyectos.ticket_comentario (
  id bigint generated always as identity not null,
  ticket_id bigint not null,
  texto text not null,
  creado_por bigint,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table proyectos.ticket_dependencia (
  id bigint generated always as identity not null,
  ticket_id bigint not null,
  ticket_relacionado_id bigint not null,
  tipo text not null default 'relacionado'::text,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table proyectos.ticket_etiqueta (
  id bigint generated always as identity not null,
  ticket_id bigint not null,
  texto text not null,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table proyectos.ticket_historial_estado (
  id bigint generated always as identity not null,
  ticket_id bigint not null,
  tablero_columna_anterior_id bigint,
  tablero_columna_nueva_id bigint,
  usuario_id bigint,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table proyectos.ticket_modulo (
  id bigint generated always as identity not null,
  nombre text not null,
  clave text not null,
  icono text,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table proyectos.ticket_prioridad (
  id bigint generated always as identity not null,
  nombre text not null,
  clave text not null,
  codigo_hex text not null default '#888888'::text,
  vigencia_horas integer not null default 0,
  aviso_horas integer not null default 0,
  critica boolean not null default false,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table proyectos.ticket_seguidor (
  id bigint generated always as identity not null,
  ticket_id bigint not null,
  usuario_id bigint not null,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table proyectos.ticket_tipo (
  id bigint generated always as identity not null,
  nombre text not null,
  clave text not null,
  icono text,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

alter table proyectos.proyecto enable row level security;

alter table proyectos.sprint enable row level security;

alter table proyectos.tablero_columna enable row level security;

alter table proyectos.ticket enable row level security;

alter table proyectos.ticket_actividad enable row level security;

alter table proyectos.ticket_adjunto enable row level security;

alter table proyectos.ticket_comentario enable row level security;

alter table proyectos.ticket_dependencia enable row level security;

alter table proyectos.ticket_etiqueta enable row level security;

alter table proyectos.ticket_historial_estado enable row level security;

alter table proyectos.ticket_modulo enable row level security;

alter table proyectos.ticket_prioridad enable row level security;

alter table proyectos.ticket_seguidor enable row level security;

alter table proyectos.ticket_tipo enable row level security;

alter table proyectos.proyecto add constraint proyecto_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table proyectos.proyecto add constraint proyecto_pkey PRIMARY KEY (id);

alter table proyectos.sprint add constraint sprint_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table proyectos.sprint add constraint sprint_estado_check CHECK ((estado = ANY (ARRAY['planeado'::text, 'activo'::text, 'cerrado'::text])));

alter table proyectos.sprint add constraint sprint_proyecto_id_fkey FOREIGN KEY (proyecto_id) REFERENCES proyectos.proyecto(id) ON DELETE CASCADE;

alter table proyectos.sprint add constraint sprint_pkey PRIMARY KEY (id);

alter table proyectos.tablero_columna add constraint tablero_columna_pkey PRIMARY KEY (id);

alter table proyectos.tablero_columna add constraint tablero_columna_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table proyectos.tablero_columna add constraint tablero_columna_proyecto_id_clave_key UNIQUE (proyecto_id, clave);

alter table proyectos.tablero_columna add constraint tablero_columna_proyecto_id_fkey FOREIGN KEY (proyecto_id) REFERENCES proyectos.proyecto(id) ON DELETE CASCADE;

alter table proyectos.ticket add constraint ticket_tablero_columna_id_fkey FOREIGN KEY (tablero_columna_id) REFERENCES proyectos.tablero_columna(id);

alter table proyectos.ticket add constraint ticket_sprint_id_fkey FOREIGN KEY (sprint_id) REFERENCES proyectos.sprint(id) ON DELETE SET NULL;

alter table proyectos.ticket add constraint ticket_ticket_padre_id_fkey FOREIGN KEY (ticket_padre_id) REFERENCES proyectos.ticket(id) ON DELETE SET NULL;

alter table proyectos.ticket add constraint ticket_ticket_prioridad_id_fkey FOREIGN KEY (ticket_prioridad_id) REFERENCES proyectos.ticket_prioridad(id);

alter table proyectos.ticket add constraint ticket_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table proyectos.ticket add constraint ticket_reportado_por_usuario_id_fkey FOREIGN KEY (reportado_por_usuario_id) REFERENCES seguridad.usuario(id);

alter table proyectos.ticket add constraint ticket_pkey PRIMARY KEY (id);

alter table proyectos.ticket add constraint ticket_proyecto_id_fkey FOREIGN KEY (proyecto_id) REFERENCES proyectos.proyecto(id) ON DELETE CASCADE;

alter table proyectos.ticket add constraint ticket_ticket_tipo_id_fkey FOREIGN KEY (ticket_tipo_id) REFERENCES proyectos.ticket_tipo(id);

alter table proyectos.ticket add constraint ticket_asignado_usuario_id_fkey FOREIGN KEY (asignado_usuario_id) REFERENCES seguridad.usuario(id) ON DELETE SET NULL;

alter table proyectos.ticket add constraint ticket_ticket_modulo_id_fkey FOREIGN KEY (ticket_modulo_id) REFERENCES proyectos.ticket_modulo(id) ON DELETE SET NULL;

alter table proyectos.ticket_actividad add constraint ticket_actividad_pkey PRIMARY KEY (id);

alter table proyectos.ticket_actividad add constraint ticket_actividad_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES proyectos.ticket(id) ON DELETE CASCADE;

alter table proyectos.ticket_actividad add constraint ticket_actividad_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table proyectos.ticket_adjunto add constraint ticket_adjunto_pkey PRIMARY KEY (id);

alter table proyectos.ticket_adjunto add constraint ticket_adjunto_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table proyectos.ticket_adjunto add constraint ticket_adjunto_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES proyectos.ticket(id) ON DELETE CASCADE;

alter table proyectos.ticket_comentario add constraint ticket_comentario_pkey PRIMARY KEY (id);

alter table proyectos.ticket_comentario add constraint ticket_comentario_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table proyectos.ticket_comentario add constraint ticket_comentario_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES proyectos.ticket(id) ON DELETE CASCADE;

alter table proyectos.ticket_dependencia add constraint ticket_dependencia_pkey PRIMARY KEY (id);

alter table proyectos.ticket_dependencia add constraint ticket_dependencia_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table proyectos.ticket_dependencia add constraint ticket_dependencia_check CHECK ((ticket_id <> ticket_relacionado_id));

alter table proyectos.ticket_dependencia add constraint ticket_dependencia_ticket_relacionado_id_fkey FOREIGN KEY (ticket_relacionado_id) REFERENCES proyectos.ticket(id) ON DELETE CASCADE;

alter table proyectos.ticket_dependencia add constraint ticket_dependencia_tipo_check CHECK ((tipo = ANY (ARRAY['relacionado'::text, 'bloquea'::text, 'bloqueado_por'::text, 'duplica'::text, 'duplicado_por'::text])));

alter table proyectos.ticket_dependencia add constraint ticket_dependencia_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES proyectos.ticket(id) ON DELETE CASCADE;

alter table proyectos.ticket_etiqueta add constraint ticket_etiqueta_pkey PRIMARY KEY (id);

alter table proyectos.ticket_etiqueta add constraint ticket_etiqueta_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES proyectos.ticket(id) ON DELETE CASCADE;

alter table proyectos.ticket_etiqueta add constraint ticket_etiqueta_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table proyectos.ticket_historial_estado add constraint ticket_historial_estado_tablero_columna_nueva_id_fkey FOREIGN KEY (tablero_columna_nueva_id) REFERENCES proyectos.tablero_columna(id) ON DELETE SET NULL;

alter table proyectos.ticket_historial_estado add constraint ticket_historial_estado_pkey PRIMARY KEY (id);

alter table proyectos.ticket_historial_estado add constraint ticket_historial_estado_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table proyectos.ticket_historial_estado add constraint ticket_historial_estado_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES proyectos.ticket(id) ON DELETE CASCADE;

alter table proyectos.ticket_historial_estado add constraint ticket_historial_estado_tablero_columna_anterior_id_fkey FOREIGN KEY (tablero_columna_anterior_id) REFERENCES proyectos.tablero_columna(id) ON DELETE SET NULL;

alter table proyectos.ticket_historial_estado add constraint ticket_historial_estado_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES seguridad.usuario(id) ON DELETE SET NULL;

alter table proyectos.ticket_modulo add constraint ticket_modulo_pkey PRIMARY KEY (id);

alter table proyectos.ticket_modulo add constraint ticket_modulo_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table proyectos.ticket_prioridad add constraint ticket_prioridad_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table proyectos.ticket_prioridad add constraint ticket_prioridad_pkey PRIMARY KEY (id);

alter table proyectos.ticket_seguidor add constraint ticket_seguidor_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES seguridad.usuario(id) ON DELETE CASCADE;

alter table proyectos.ticket_seguidor add constraint ticket_seguidor_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES proyectos.ticket(id) ON DELETE CASCADE;

alter table proyectos.ticket_seguidor add constraint ticket_seguidor_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table proyectos.ticket_seguidor add constraint ticket_seguidor_pkey PRIMARY KEY (id);

alter table proyectos.ticket_seguidor add constraint ticket_seguidor_ticket_id_usuario_id_key UNIQUE (ticket_id, usuario_id);

alter table proyectos.ticket_tipo add constraint ticket_tipo_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table proyectos.ticket_tipo add constraint ticket_tipo_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX proyecto_empresa_clave_uk ON proyectos.proyecto USING btree (empresa_id, clave);

CREATE INDEX proyecto_empresa_id_ix ON proyectos.proyecto USING btree (empresa_id);

CREATE INDEX sprint_proyecto_id_ix ON proyectos.sprint USING btree (proyecto_id);

CREATE INDEX sprint_empresa_id_ix ON proyectos.sprint USING btree (empresa_id);

CREATE INDEX tablero_columna_empresa_id_ix ON proyectos.tablero_columna USING btree (empresa_id);

CREATE INDEX ticket_tablero_columna_id_ix ON proyectos.ticket USING btree (tablero_columna_id);

CREATE INDEX ticket_ticket_tipo_id_ix ON proyectos.ticket USING btree (ticket_tipo_id);

CREATE INDEX ticket_empresa_id_ix ON proyectos.ticket USING btree (empresa_id);

CREATE INDEX ticket_asignado_usuario_id_ix ON proyectos.ticket USING btree (asignado_usuario_id);

CREATE INDEX ticket_ticket_modulo_id_ix ON proyectos.ticket USING btree (ticket_modulo_id);

CREATE INDEX ticket_numero_ix ON proyectos.ticket USING btree (proyecto_id, numero_ticket);

CREATE INDEX ticket_ticket_padre_id_ix ON proyectos.ticket USING btree (ticket_padre_id);

CREATE INDEX ticket_sprint_id_ix ON proyectos.ticket USING btree (sprint_id);

CREATE INDEX ticket_reportado_por_usuario_id_ix ON proyectos.ticket USING btree (reportado_por_usuario_id);

CREATE INDEX ticket_ticket_prioridad_id_ix ON proyectos.ticket USING btree (ticket_prioridad_id);

CREATE INDEX ticket_actividad_empresa_id_ix ON proyectos.ticket_actividad USING btree (empresa_id);

CREATE INDEX ticket_actividad_ticket_id_ix ON proyectos.ticket_actividad USING btree (ticket_id);

CREATE INDEX ticket_adjunto_ticket_id_ix ON proyectos.ticket_adjunto USING btree (ticket_id);

CREATE INDEX ticket_adjunto_empresa_id_ix ON proyectos.ticket_adjunto USING btree (empresa_id);

CREATE INDEX ticket_comentario_empresa_id_ix ON proyectos.ticket_comentario USING btree (empresa_id);

CREATE INDEX ticket_comentario_ticket_id_ix ON proyectos.ticket_comentario USING btree (ticket_id);

CREATE INDEX ticket_dependencia_ticket_relacionado_id_ix ON proyectos.ticket_dependencia USING btree (ticket_relacionado_id);

CREATE INDEX ticket_dependencia_ticket_id_ix ON proyectos.ticket_dependencia USING btree (ticket_id);

CREATE INDEX ticket_dependencia_empresa_id_ix ON proyectos.ticket_dependencia USING btree (empresa_id);

CREATE INDEX ticket_etiqueta_ticket_id_ix ON proyectos.ticket_etiqueta USING btree (ticket_id);

CREATE INDEX ticket_etiqueta_empresa_id_ix ON proyectos.ticket_etiqueta USING btree (empresa_id);

CREATE INDEX ticket_historial_estado_empresa_id_ix ON proyectos.ticket_historial_estado USING btree (empresa_id);

CREATE INDEX ticket_historial_estado_tablero_columna_anterior_id_ix ON proyectos.ticket_historial_estado USING btree (tablero_columna_anterior_id);

CREATE INDEX ticket_historial_estado_usuario_id_ix ON proyectos.ticket_historial_estado USING btree (usuario_id);

CREATE INDEX ticket_historial_estado_tablero_columna_nueva_id_ix ON proyectos.ticket_historial_estado USING btree (tablero_columna_nueva_id);

CREATE INDEX ticket_historial_estado_ticket_id_ix ON proyectos.ticket_historial_estado USING btree (ticket_id);

CREATE UNIQUE INDEX ticket_modulo_empresa_clave_uk ON proyectos.ticket_modulo USING btree (empresa_id, clave);

CREATE INDEX ticket_modulo_empresa_id_ix ON proyectos.ticket_modulo USING btree (empresa_id);

CREATE UNIQUE INDEX ticket_prioridad_empresa_clave_uk ON proyectos.ticket_prioridad USING btree (empresa_id, clave);

CREATE INDEX ticket_prioridad_empresa_id_ix ON proyectos.ticket_prioridad USING btree (empresa_id);

CREATE INDEX ticket_seguidor_usuario_id_ix ON proyectos.ticket_seguidor USING btree (usuario_id);

CREATE INDEX ticket_seguidor_empresa_id_ix ON proyectos.ticket_seguidor USING btree (empresa_id);

CREATE UNIQUE INDEX ticket_tipo_empresa_clave_uk ON proyectos.ticket_tipo USING btree (empresa_id, clave);

CREATE INDEX ticket_tipo_empresa_id_ix ON proyectos.ticket_tipo USING btree (empresa_id);

create policy modulo_habilitado on proyectos.proyecto as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('proyectos'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('proyectos'::text) AS modulo_habilitado));

create policy compartida_todo on proyectos.proyecto as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on proyectos.proyecto as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on proyectos.sprint as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on proyectos.sprint as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy modulo_habilitado on proyectos.sprint as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('proyectos'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('proyectos'::text) AS modulo_habilitado));

create policy compartida_todo on proyectos.tablero_columna as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy modulo_habilitado on proyectos.tablero_columna as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('proyectos'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('proyectos'::text) AS modulo_habilitado));

create policy solo_mi_empresa on proyectos.tablero_columna as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on proyectos.ticket as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on proyectos.ticket as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy modulo_habilitado on proyectos.ticket as restrictive for ALL to authenticated
  using (( SELECT ( SELECT privado.modulo_habilitado('proyectos'::text) AS modulo_habilitado) AS modulo_habilitado))
  with check (( SELECT ( SELECT privado.modulo_habilitado('proyectos'::text) AS modulo_habilitado) AS modulo_habilitado));

create policy modulo_habilitado on proyectos.ticket_actividad as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('proyectos'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('proyectos'::text) AS modulo_habilitado));

create policy compartida_todo on proyectos.ticket_actividad as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on proyectos.ticket_actividad as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on proyectos.ticket_adjunto as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy modulo_habilitado on proyectos.ticket_adjunto as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('proyectos'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('proyectos'::text) AS modulo_habilitado));

create policy solo_mi_empresa on proyectos.ticket_adjunto as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on proyectos.ticket_comentario as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on proyectos.ticket_comentario as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy modulo_habilitado on proyectos.ticket_comentario as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('proyectos'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('proyectos'::text) AS modulo_habilitado));

create policy modulo_habilitado on proyectos.ticket_dependencia as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('proyectos'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('proyectos'::text) AS modulo_habilitado));

create policy solo_mi_empresa on proyectos.ticket_dependencia as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on proyectos.ticket_dependencia as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy modulo_habilitado on proyectos.ticket_etiqueta as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('proyectos'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('proyectos'::text) AS modulo_habilitado));

create policy solo_mi_empresa on proyectos.ticket_etiqueta as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on proyectos.ticket_etiqueta as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy modulo_habilitado on proyectos.ticket_historial_estado as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('proyectos'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('proyectos'::text) AS modulo_habilitado));

create policy compartida_todo on proyectos.ticket_historial_estado as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on proyectos.ticket_historial_estado as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy modulo_habilitado on proyectos.ticket_modulo as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('proyectos'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('proyectos'::text) AS modulo_habilitado));

create policy compartida_todo on proyectos.ticket_modulo as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on proyectos.ticket_modulo as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy solo_mi_empresa on proyectos.ticket_prioridad as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy modulo_habilitado on proyectos.ticket_prioridad as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('proyectos'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('proyectos'::text) AS modulo_habilitado));

create policy compartida_todo on proyectos.ticket_prioridad as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy compartida_todo on proyectos.ticket_seguidor as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on proyectos.ticket_seguidor as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy modulo_habilitado on proyectos.ticket_seguidor as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('proyectos'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('proyectos'::text) AS modulo_habilitado));

create policy solo_mi_empresa on proyectos.ticket_tipo as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy modulo_habilitado on proyectos.ticket_tipo as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('proyectos'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('proyectos'::text) AS modulo_habilitado));

create policy compartida_todo on proyectos.ticket_tipo as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

-- NOTA: la política "modulo_habilitado" de proyectos.ticket está anidada dos veces
-- (SELECT (SELECT privado.modulo_habilitado(...))), a diferencia del resto de tablas
-- de este mismo esquema que la llaman una sola vez. Es funcionalmente equivalente,
-- probablemente resultado de una re-creación posterior de esta política específica.
-- Se conserva tal cual existe en producción.

CREATE OR REPLACE FUNCTION proyectos.fn_tickets_lista_pagina(p_proyecto_id bigint, p_busqueda text DEFAULT NULL::text, p_tipo_id bigint DEFAULT NULL::bigint, p_modulo_id bigint DEFAULT NULL::bigint, p_prioridad_id bigint DEFAULT NULL::bigint, p_estado_ids bigint[] DEFAULT NULL::bigint[], p_asignado_usuario_id bigint DEFAULT NULL::bigint, p_planeado smallint DEFAULT 0, p_sprint_id bigint DEFAULT NULL::bigint, p_sprint_sin_asignar boolean DEFAULT false, p_vigencia_estado text DEFAULT NULL::text, p_mostrar_inactivos boolean DEFAULT false, p_mostrar_resueltos boolean DEFAULT false, p_orden_columna text DEFAULT 'numero_ticket'::text, p_orden_direccion text DEFAULT 'asc'::text, p_desde integer DEFAULT 0, p_cantidad integer DEFAULT 50)
 RETURNS TABLE(id bigint, proyecto_id bigint, tablero_columna_id bigint, ticket_tipo_id bigint, ticket_prioridad_id bigint, ticket_modulo_id bigint, asignado_usuario_id bigint, reportado_por_usuario_id bigint, numero_ticket text, folio_interno text, titulo text, descripcion text, planeado boolean, tiempo_estimado_min integer, fecha_fin_analisis date, fecha_fin_desarrollo date, fecha_fin_cliente date, fecha_inicio date, fecha_fin date, solucion text, ticket_padre_id bigint, sprint_id bigint, fecha_creacion timestamp with time zone, fecha_modificacion timestamp with time zone, creado_por bigint, modificado_por bigint, activo boolean, vigencia_estado text, total_filas bigint, desde_efectivo bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_ultima_columna_id    bigint;
  v_orden_columna        text;
  v_orden_direccion      text;
  v_cantidad             integer;
  v_total                bigint;
  v_ultima_pagina_desde  bigint;
  v_desde_efectivo       bigint;
  v_base_sql text;
begin
  select tc.id into v_ultima_columna_id
    from proyectos.tablero_columna tc
   where tc.proyecto_id = p_proyecto_id
   order by tc.orden desc
   limit 1;

  v_orden_columna := case p_orden_columna
    when 'numero_ticket'       then 'numero_ticket'
    when 'folio_interno'       then 'folio_interno'
    when 'titulo'              then 'titulo'
    when 'ticket_tipo_id'      then 'ticket_tipo_id'
    when 'ticket_modulo_id'    then 'ticket_modulo_id'
    when 'sprint_id'           then 'sprint_id'
    when 'ticket_prioridad_id' then 'ticket_prioridad_id'
    when 'tablero_columna_id'  then 'tablero_columna_id'
    when 'asignado_usuario_id' then 'asignado_usuario_id'
    when 'planeado'            then 'planeado'
    when 'fecha_creacion'      then 'fecha_creacion'
    when 'vigencia_estado'     then 'vigencia_estado'
    else 'numero_ticket'
  end;
  v_orden_direccion := case when lower(p_orden_direccion) = 'desc' then 'desc' else 'asc' end;

  v_cantidad := least(100, greatest(1, coalesce(p_cantidad, 50)));

  v_base_sql := '
    select
      t.id, t.proyecto_id, t.tablero_columna_id, t.ticket_tipo_id,
      t.ticket_prioridad_id, t.ticket_modulo_id, t.asignado_usuario_id,
      t.reportado_por_usuario_id, t.numero_ticket, t.folio_interno, t.titulo,
      t.descripcion, t.planeado, t.tiempo_estimado_min,
      t.fecha_fin_analisis, t.fecha_fin_desarrollo, t.fecha_fin_cliente,
      t.fecha_inicio, t.fecha_fin, t.solucion,
      t.ticket_padre_id, t.sprint_id, t.fecha_creacion,
      t.fecha_modificacion, t.creado_por, t.modificado_por, t.activo,
      case
        when tp.vigencia_horas is null or tp.vigencia_horas = 0
             or t.fecha_creacion is null or t.tablero_columna_id = $1
          then ''sin_vigencia''
        when now() >= t.fecha_creacion + (tp.vigencia_horas * interval ''1 hour'')
          then ''vencido''
        when now() >= t.fecha_creacion + (tp.vigencia_horas * interval ''1 hour'')
                       - (coalesce(tp.aviso_horas, 0) * interval ''1 hour'')
          then ''por_vencer''
        else ''vigente''
      end as vigencia_estado
    from proyectos.ticket t
    left join proyectos.ticket_prioridad tp on tp.id = t.ticket_prioridad_id
    where t.proyecto_id = $2
      and ($3 or t.activo is distinct from false)
      and ($4 or t.tablero_columna_id is distinct from $1)
      and ($5::bigint is null or t.ticket_tipo_id = $5)
      and (
        $6::bigint is null
        or ($6 = -1 and t.ticket_modulo_id is null)
        or t.ticket_modulo_id = $6
      )
      and ($7::bigint is null or t.ticket_prioridad_id = $7)
      and ($8::bigint[] is null or cardinality($8) = 0 or t.tablero_columna_id = any($8))
      and ($9::bigint is null or t.asignado_usuario_id = $9)
      and (
        $10 = 0
        or ($10 = 1 and t.planeado is distinct from false)
        or ($10 = 2 and t.planeado is false)
      )
      and (
        case
          when $12 then t.sprint_id is null
          when $11::bigint is not null then t.sprint_id = $11
          else true
        end
      )
      and (
        $13::text is null or $13 = ''''
        or exists (
          select 1
          from unnest(string_to_array($13, '','')) as termino(valor)
          where length(trim(termino.valor)) > 0
            and (
              t.numero_ticket ilike ''%%'' || trim(termino.valor) || ''%%''
              or coalesce(t.folio_interno, '''') ilike ''%%'' || trim(termino.valor) || ''%%''
              or t.titulo ilike ''%%'' || trim(termino.valor) || ''%%''
              or exists (
                   select 1 from proyectos.ticket_etiqueta te
                    where te.ticket_id = t.id and te.activo is distinct from false
                      and te.texto ilike ''%%'' || trim(termino.valor) || ''%%''
                 )
              or exists (
                   select 1 from proyectos.sprint sp
                    where sp.id = t.sprint_id
                      and sp.nombre ilike ''%%'' || trim(termino.valor) || ''%%''
                 )
              or (t.sprint_id is null and ''backlog'' ilike ''%%'' || trim(termino.valor) || ''%%'')
            )
        )
      )
  ';

  execute 'select count(*) from (' || v_base_sql || ') base
           where ($14::text is null or base.vigencia_estado = $14)'
    into v_total
    using v_ultima_columna_id, p_proyecto_id, p_mostrar_inactivos, p_mostrar_resueltos,
          p_tipo_id, p_modulo_id, p_prioridad_id, p_estado_ids, p_asignado_usuario_id,
          p_planeado, p_sprint_id, p_sprint_sin_asignar, p_busqueda, p_vigencia_estado;

  if v_total = 0 then
    v_desde_efectivo := 0;
  else
    v_ultima_pagina_desde := ((v_total - 1) / v_cantidad) * v_cantidad;
    v_desde_efectivo := case
      when p_desde < 0 then 0
      when p_desde > v_ultima_pagina_desde then v_ultima_pagina_desde
      else p_desde
    end;
  end if;

  return query execute
    'select base.*, $15::bigint as total_filas, $16::bigint as desde_efectivo
     from (' || v_base_sql || ') base
     where ($14::text is null or base.vigencia_estado = $14)
     order by ' || format('%I %s', v_orden_columna, v_orden_direccion) || ' nulls last, base.id asc
     offset $16
     limit $17'
    using v_ultima_columna_id, p_proyecto_id, p_mostrar_inactivos, p_mostrar_resueltos,
          p_tipo_id, p_modulo_id, p_prioridad_id, p_estado_ids, p_asignado_usuario_id,
          p_planeado, p_sprint_id, p_sprint_sin_asignar, p_busqueda, p_vigencia_estado,
          v_total, v_desde_efectivo, v_cantidad;
end;
$function$
;

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON proyectos.proyecto FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON proyectos.sprint FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON proyectos.tablero_columna FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_tablero_columna_sincronizar_resueltos AFTER INSERT OR DELETE OR UPDATE ON proyectos.tablero_columna FOR EACH ROW EXECUTE FUNCTION privado.fn_tablero_columna_sincronizar_resueltos();

CREATE TRIGGER trg_ticket_calcular_resuelto BEFORE INSERT OR UPDATE OF tablero_columna_id, proyecto_id ON proyectos.ticket FOR EACH ROW EXECUTE FUNCTION privado.fn_ticket_calcular_resuelto();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON proyectos.ticket FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON proyectos.ticket_actividad FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON proyectos.ticket_adjunto FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON proyectos.ticket_comentario FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON proyectos.ticket_dependencia FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON proyectos.ticket_etiqueta FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON proyectos.ticket_historial_estado FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON proyectos.ticket_modulo FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON proyectos.ticket_prioridad FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON proyectos.ticket_seguidor FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON proyectos.ticket_tipo FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

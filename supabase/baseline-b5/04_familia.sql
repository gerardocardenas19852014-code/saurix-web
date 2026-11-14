-- ============================================================================
-- SAURIX — Línea base reproducible (Etapa B5.1) — Esquema: familia
-- Generado por introspección de pg_catalog el 2026-11-11. Ver limitaciones en
-- claude/saurix-correccion2-etapa-b5-1-linea-base-2026-11.md, Bloque A.
-- ============================================================================

create schema if not exists familia;

create table familia.cita_medica_miembro (
  id bigint generated always as identity not null,
  miembro_familia_id bigint not null,
  motivo text not null,
  especialidad text,
  fecha date,
  lugar text,
  notas text,
  completada boolean not null default false,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table familia.cita_medica_miembro_adjunto (
  id bigint generated always as identity not null,
  cita_medica_miembro_id bigint not null,
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

create table familia.contacto_emergencia_miembro (
  id bigint generated always as identity not null,
  miembro_familia_id bigint not null,
  nombre text not null,
  relacion text,
  telefono text,
  notas text,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table familia.contacto_familiar (
  id bigint generated always as identity not null,
  nombre text not null,
  categoria text not null,
  telefono text,
  correo text,
  direccion text,
  notas text,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table familia.documento_familia (
  id bigint generated always as identity not null,
  miembro_familia_id bigint not null,
  tipo_documento_clave text not null,
  fecha_vencimiento date,
  notas text,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table familia.documento_familia_adjunto (
  id bigint generated always as identity not null,
  documento_familia_id bigint not null,
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

create table familia.evento_familiar (
  id bigint generated always as identity not null,
  miembro_familia_id bigint,
  titulo text not null,
  fecha date not null,
  notas text,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table familia.medicion_crecimiento (
  id bigint generated always as identity not null,
  miembro_familia_id bigint not null,
  fecha date not null,
  peso_kg numeric(6,2),
  estatura_cm numeric(6,2),
  notas text,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table familia.miembro_familia (
  id bigint generated always as identity not null,
  nombre text not null,
  apellido_paterno text,
  apellido_materno text,
  parentesco_clave text,
  fecha_nacimiento date,
  sexo text,
  entidad_nacimiento text,
  tipo_sangre text,
  telefono text,
  foto text,
  rfc text,
  curp text,
  alergias text,
  condiciones_cronicas text,
  medicamentos text,
  numero_seguro_social text,
  contacto_emergencia_nombre text,
  contacto_emergencia_telefono text,
  aseguradora text,
  numero_poliza text,
  padre_id bigint,
  madre_id bigint,
  conyuge_id bigint,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table familia.pariente_referencia (
  id bigint generated always as identity not null,
  miembro_familia_id bigint not null,
  nombre text not null,
  parentesco text not null,
  fecha_nacimiento date,
  fallecido boolean not null default false,
  fecha_fallecimiento date,
  notas text,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table familia.poliza_seguro_miembro (
  id bigint generated always as identity not null,
  miembro_familia_id bigint not null,
  tipo text,
  aseguradora text,
  numero_poliza text,
  fecha_vigencia_inicio date,
  fecha_vigencia_fin date,
  notas text,
  suma_asegurada numeric(14,2),
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table familia.tarea_hogar (
  id bigint generated always as identity not null,
  titulo text not null,
  miembro_familia_id bigint,
  frecuencia text not null default 'unica'::text,
  completada boolean not null default false,
  fecha_limite date,
  notas text,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table familia.tramite_estado (
  id bigint generated always as identity not null,
  nombre text not null,
  orden integer not null default 0,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table familia.tramite_familiar (
  id bigint generated always as identity not null,
  titulo text not null,
  miembro_familia_id bigint,
  tramite_estado_id bigint not null,
  fecha_limite date,
  notas text,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table familia.vacuna_miembro (
  id bigint generated always as identity not null,
  miembro_familia_id bigint not null,
  nombre text not null,
  fecha_aplicacion date,
  dosis text,
  notas text,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table familia.vacuna_miembro_adjunto (
  id bigint generated always as identity not null,
  vacuna_miembro_id bigint not null,
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

alter table familia.cita_medica_miembro enable row level security;

alter table familia.cita_medica_miembro_adjunto enable row level security;

alter table familia.contacto_emergencia_miembro enable row level security;

alter table familia.contacto_familiar enable row level security;

alter table familia.documento_familia enable row level security;

alter table familia.documento_familia_adjunto enable row level security;

alter table familia.evento_familiar enable row level security;

alter table familia.medicion_crecimiento enable row level security;

alter table familia.miembro_familia enable row level security;

alter table familia.pariente_referencia enable row level security;

alter table familia.poliza_seguro_miembro enable row level security;

alter table familia.tarea_hogar enable row level security;

alter table familia.tramite_estado enable row level security;

alter table familia.tramite_familiar enable row level security;

alter table familia.vacuna_miembro enable row level security;

alter table familia.vacuna_miembro_adjunto enable row level security;

alter table familia.cita_medica_miembro add constraint cita_medica_miembro_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table familia.cita_medica_miembro add constraint cita_medica_miembro_miembro_familia_id_fkey FOREIGN KEY (miembro_familia_id) REFERENCES familia.miembro_familia(id) ON DELETE CASCADE;

alter table familia.cita_medica_miembro add constraint cita_medica_miembro_pkey PRIMARY KEY (id);

alter table familia.cita_medica_miembro_adjunto add constraint cita_medica_miembro_adjunto_cita_medica_miembro_id_fkey FOREIGN KEY (cita_medica_miembro_id) REFERENCES familia.cita_medica_miembro(id) ON DELETE CASCADE;

alter table familia.cita_medica_miembro_adjunto add constraint cita_medica_miembro_adjunto_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table familia.cita_medica_miembro_adjunto add constraint cita_medica_miembro_adjunto_pkey PRIMARY KEY (id);

alter table familia.contacto_emergencia_miembro add constraint contacto_emergencia_miembro_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table familia.contacto_emergencia_miembro add constraint contacto_emergencia_miembro_pkey PRIMARY KEY (id);

alter table familia.contacto_emergencia_miembro add constraint contacto_emergencia_miembro_miembro_familia_id_fkey FOREIGN KEY (miembro_familia_id) REFERENCES familia.miembro_familia(id) ON DELETE CASCADE;

alter table familia.contacto_familiar add constraint contacto_familiar_pkey PRIMARY KEY (id);

alter table familia.contacto_familiar add constraint contacto_familiar_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table familia.documento_familia add constraint documento_familia_pkey PRIMARY KEY (id);

alter table familia.documento_familia add constraint documento_familia_miembro_familia_id_fkey FOREIGN KEY (miembro_familia_id) REFERENCES familia.miembro_familia(id) ON DELETE CASCADE;

alter table familia.documento_familia add constraint documento_familia_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table familia.documento_familia_adjunto add constraint documento_familia_adjunto_pkey PRIMARY KEY (id);

alter table familia.documento_familia_adjunto add constraint documento_familia_adjunto_documento_familia_id_fkey FOREIGN KEY (documento_familia_id) REFERENCES familia.documento_familia(id) ON DELETE CASCADE;

alter table familia.documento_familia_adjunto add constraint documento_familia_adjunto_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table familia.evento_familiar add constraint evento_familiar_pkey PRIMARY KEY (id);

alter table familia.evento_familiar add constraint evento_familiar_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table familia.evento_familiar add constraint evento_familiar_miembro_familia_id_fkey FOREIGN KEY (miembro_familia_id) REFERENCES familia.miembro_familia(id) ON DELETE SET NULL;

alter table familia.medicion_crecimiento add constraint medicion_crecimiento_pkey PRIMARY KEY (id);

alter table familia.medicion_crecimiento add constraint medicion_crecimiento_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table familia.medicion_crecimiento add constraint medicion_crecimiento_miembro_familia_id_fkey FOREIGN KEY (miembro_familia_id) REFERENCES familia.miembro_familia(id) ON DELETE CASCADE;

alter table familia.miembro_familia add constraint miembro_familia_pkey PRIMARY KEY (id);

alter table familia.miembro_familia add constraint miembro_familia_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table familia.miembro_familia add constraint miembro_familia_madre_id_fkey FOREIGN KEY (madre_id) REFERENCES familia.miembro_familia(id) ON DELETE SET NULL;

alter table familia.miembro_familia add constraint miembro_familia_padre_id_fkey FOREIGN KEY (padre_id) REFERENCES familia.miembro_familia(id) ON DELETE SET NULL;

alter table familia.miembro_familia add constraint miembro_familia_conyuge_id_fkey FOREIGN KEY (conyuge_id) REFERENCES familia.miembro_familia(id) ON DELETE SET NULL;

alter table familia.pariente_referencia add constraint pariente_referencia_miembro_familia_id_fkey FOREIGN KEY (miembro_familia_id) REFERENCES familia.miembro_familia(id) ON DELETE CASCADE;

alter table familia.pariente_referencia add constraint pariente_referencia_pkey PRIMARY KEY (id);

alter table familia.pariente_referencia add constraint pariente_referencia_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table familia.poliza_seguro_miembro add constraint poliza_seguro_miembro_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table familia.poliza_seguro_miembro add constraint poliza_seguro_miembro_miembro_familia_id_fkey FOREIGN KEY (miembro_familia_id) REFERENCES familia.miembro_familia(id) ON DELETE CASCADE;

alter table familia.poliza_seguro_miembro add constraint poliza_seguro_miembro_pkey PRIMARY KEY (id);

alter table familia.tarea_hogar add constraint tarea_hogar_frecuencia_check CHECK ((frecuencia = ANY (ARRAY['unica'::text, 'diaria'::text, 'semanal'::text, 'mensual'::text])));

alter table familia.tarea_hogar add constraint tarea_hogar_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table familia.tarea_hogar add constraint tarea_hogar_miembro_familia_id_fkey FOREIGN KEY (miembro_familia_id) REFERENCES familia.miembro_familia(id) ON DELETE SET NULL;

alter table familia.tarea_hogar add constraint tarea_hogar_pkey PRIMARY KEY (id);

alter table familia.tramite_estado add constraint tramite_estado_pkey PRIMARY KEY (id);

alter table familia.tramite_estado add constraint tramite_estado_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table familia.tramite_familiar add constraint tramite_familiar_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table familia.tramite_familiar add constraint tramite_familiar_tramite_estado_id_fkey FOREIGN KEY (tramite_estado_id) REFERENCES familia.tramite_estado(id);

alter table familia.tramite_familiar add constraint tramite_familiar_pkey PRIMARY KEY (id);

alter table familia.tramite_familiar add constraint tramite_familiar_miembro_familia_id_fkey FOREIGN KEY (miembro_familia_id) REFERENCES familia.miembro_familia(id) ON DELETE SET NULL;

alter table familia.vacuna_miembro add constraint vacuna_miembro_pkey PRIMARY KEY (id);

alter table familia.vacuna_miembro add constraint vacuna_miembro_miembro_familia_id_fkey FOREIGN KEY (miembro_familia_id) REFERENCES familia.miembro_familia(id) ON DELETE CASCADE;

alter table familia.vacuna_miembro add constraint vacuna_miembro_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table familia.vacuna_miembro_adjunto add constraint vacuna_miembro_adjunto_vacuna_miembro_id_fkey FOREIGN KEY (vacuna_miembro_id) REFERENCES familia.vacuna_miembro(id) ON DELETE CASCADE;

alter table familia.vacuna_miembro_adjunto add constraint vacuna_miembro_adjunto_pkey PRIMARY KEY (id);

alter table familia.vacuna_miembro_adjunto add constraint vacuna_miembro_adjunto_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

CREATE INDEX cita_medica_miembro_miembro_familia_id_ix ON familia.cita_medica_miembro USING btree (miembro_familia_id);

CREATE INDEX cita_medica_miembro_empresa_id_ix ON familia.cita_medica_miembro USING btree (empresa_id);

CREATE INDEX cita_medica_miembro_adjunto_empresa_id_ix ON familia.cita_medica_miembro_adjunto USING btree (empresa_id);

CREATE INDEX cita_medica_miembro_adjunto_cita_medica_miembro_id_ix ON familia.cita_medica_miembro_adjunto USING btree (cita_medica_miembro_id);

CREATE INDEX contacto_emergencia_miembro_empresa_id_ix ON familia.contacto_emergencia_miembro USING btree (empresa_id);

CREATE INDEX contacto_emergencia_miembro_miembro_familia_id_ix ON familia.contacto_emergencia_miembro USING btree (miembro_familia_id);

CREATE INDEX contacto_familiar_empresa_id_ix ON familia.contacto_familiar USING btree (empresa_id);

CREATE INDEX documento_familia_miembro_familia_id_ix ON familia.documento_familia USING btree (miembro_familia_id);

CREATE INDEX documento_familia_empresa_id_ix ON familia.documento_familia USING btree (empresa_id);

CREATE INDEX documento_familia_adjunto_empresa_id_ix ON familia.documento_familia_adjunto USING btree (empresa_id);

CREATE INDEX documento_familia_adjunto_documento_familia_id_ix ON familia.documento_familia_adjunto USING btree (documento_familia_id);

CREATE INDEX evento_familiar_miembro_familia_id_ix ON familia.evento_familiar USING btree (miembro_familia_id);

CREATE INDEX evento_familiar_empresa_id_ix ON familia.evento_familiar USING btree (empresa_id);

CREATE INDEX medicion_crecimiento_miembro_familia_id_ix ON familia.medicion_crecimiento USING btree (miembro_familia_id);

CREATE INDEX medicion_crecimiento_empresa_id_ix ON familia.medicion_crecimiento USING btree (empresa_id);

CREATE INDEX miembro_familia_madre_id_ix ON familia.miembro_familia USING btree (madre_id);

CREATE INDEX miembro_familia_padre_id_ix ON familia.miembro_familia USING btree (padre_id);

CREATE INDEX miembro_familia_conyuge_id_ix ON familia.miembro_familia USING btree (conyuge_id);

CREATE INDEX miembro_familia_empresa_id_ix ON familia.miembro_familia USING btree (empresa_id);

CREATE INDEX pariente_referencia_empresa_id_ix ON familia.pariente_referencia USING btree (empresa_id);

CREATE INDEX pariente_referencia_miembro_familia_id_ix ON familia.pariente_referencia USING btree (miembro_familia_id);

CREATE INDEX poliza_seguro_miembro_miembro_familia_id_ix ON familia.poliza_seguro_miembro USING btree (miembro_familia_id);

CREATE INDEX poliza_seguro_miembro_empresa_id_ix ON familia.poliza_seguro_miembro USING btree (empresa_id);

CREATE INDEX tarea_hogar_empresa_id_ix ON familia.tarea_hogar USING btree (empresa_id);

CREATE INDEX tarea_hogar_miembro_familia_id_ix ON familia.tarea_hogar USING btree (miembro_familia_id);

CREATE INDEX tramite_estado_empresa_id_ix ON familia.tramite_estado USING btree (empresa_id);

CREATE INDEX tramite_familiar_empresa_id_ix ON familia.tramite_familiar USING btree (empresa_id);

CREATE INDEX tramite_familiar_tramite_estado_id_ix ON familia.tramite_familiar USING btree (tramite_estado_id);

CREATE INDEX tramite_familiar_miembro_familia_id_ix ON familia.tramite_familiar USING btree (miembro_familia_id);

CREATE INDEX vacuna_miembro_miembro_familia_id_ix ON familia.vacuna_miembro USING btree (miembro_familia_id);

CREATE INDEX vacuna_miembro_empresa_id_ix ON familia.vacuna_miembro USING btree (empresa_id);

CREATE INDEX vacuna_miembro_adjunto_vacuna_miembro_id_ix ON familia.vacuna_miembro_adjunto USING btree (vacuna_miembro_id);

CREATE INDEX vacuna_miembro_adjunto_empresa_id_ix ON familia.vacuna_miembro_adjunto USING btree (empresa_id);

create policy modulo_habilitado on familia.cita_medica_miembro as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('familia'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('familia'::text) AS modulo_habilitado));

create policy compartida_todo on familia.cita_medica_miembro as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on familia.cita_medica_miembro as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on familia.cita_medica_miembro_adjunto as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy modulo_habilitado on familia.cita_medica_miembro_adjunto as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('familia'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('familia'::text) AS modulo_habilitado));

create policy solo_mi_empresa on familia.cita_medica_miembro_adjunto as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on familia.contacto_emergencia_miembro as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on familia.contacto_emergencia_miembro as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy modulo_habilitado on familia.contacto_emergencia_miembro as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('familia'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('familia'::text) AS modulo_habilitado));

create policy compartida_todo on familia.contacto_familiar as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy modulo_habilitado on familia.contacto_familiar as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('familia'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('familia'::text) AS modulo_habilitado));

create policy solo_mi_empresa on familia.contacto_familiar as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy solo_mi_empresa on familia.documento_familia as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy modulo_habilitado on familia.documento_familia as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('familia'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('familia'::text) AS modulo_habilitado));

create policy compartida_todo on familia.documento_familia as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy compartida_todo on familia.documento_familia_adjunto as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on familia.documento_familia_adjunto as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy modulo_habilitado on familia.documento_familia_adjunto as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('familia'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('familia'::text) AS modulo_habilitado));

create policy modulo_habilitado on familia.evento_familiar as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('familia'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('familia'::text) AS modulo_habilitado));

create policy compartida_todo on familia.evento_familiar as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on familia.evento_familiar as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy solo_mi_empresa on familia.medicion_crecimiento as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy modulo_habilitado on familia.medicion_crecimiento as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('familia'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('familia'::text) AS modulo_habilitado));

create policy compartida_todo on familia.medicion_crecimiento as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on familia.miembro_familia as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on familia.miembro_familia as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy modulo_habilitado on familia.miembro_familia as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('familia'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('familia'::text) AS modulo_habilitado));

create policy modulo_habilitado on familia.pariente_referencia as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('familia'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('familia'::text) AS modulo_habilitado));

create policy solo_mi_empresa on familia.pariente_referencia as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on familia.pariente_referencia as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on familia.poliza_seguro_miembro as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy modulo_habilitado on familia.poliza_seguro_miembro as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('familia'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('familia'::text) AS modulo_habilitado));

create policy compartida_todo on familia.poliza_seguro_miembro as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on familia.tarea_hogar as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on familia.tarea_hogar as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy modulo_habilitado on familia.tarea_hogar as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('familia'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('familia'::text) AS modulo_habilitado));

create policy modulo_habilitado on familia.tramite_estado as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('familia'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('familia'::text) AS modulo_habilitado));

create policy compartida_todo on familia.tramite_estado as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on familia.tramite_estado as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy solo_mi_empresa on familia.tramite_familiar as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy modulo_habilitado on familia.tramite_familiar as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('familia'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('familia'::text) AS modulo_habilitado));

create policy compartida_todo on familia.tramite_familiar as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on familia.vacuna_miembro as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy modulo_habilitado on familia.vacuna_miembro as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('familia'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('familia'::text) AS modulo_habilitado));

create policy compartida_todo on familia.vacuna_miembro as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on familia.vacuna_miembro_adjunto as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy modulo_habilitado on familia.vacuna_miembro_adjunto as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('familia'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('familia'::text) AS modulo_habilitado));

create policy compartida_todo on familia.vacuna_miembro_adjunto as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON familia.cita_medica_miembro FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON familia.cita_medica_miembro_adjunto FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON familia.contacto_emergencia_miembro FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON familia.contacto_familiar FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON familia.documento_familia FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON familia.documento_familia_adjunto FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON familia.evento_familiar FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON familia.medicion_crecimiento FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON familia.miembro_familia FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON familia.pariente_referencia FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON familia.poliza_seguro_miembro FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON familia.tarea_hogar FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON familia.tramite_estado FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON familia.tramite_familiar FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON familia.vacuna_miembro FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON familia.vacuna_miembro_adjunto FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

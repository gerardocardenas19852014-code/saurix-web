-- ============================================================================
-- SAURIX — Línea base reproducible (Etapa B5.1) — Esquema: wikidocs
-- Generado por introspección de pg_catalog el 2026-11-11. Ver limitaciones en
-- claude/saurix-correccion2-etapa-b5-1-linea-base-2026-11.md, Bloque A.
-- ============================================================================

create schema if not exists wikidocs;

create table wikidocs.categoria (
  id bigint generated always as identity not null,
  tipo_sistema_id bigint not null,
  nombre text not null,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table wikidocs.documento (
  id bigint generated always as identity not null,
  seccion_id bigint not null,
  titulo text not null,
  contenido text not null default ''::text,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table wikidocs.documento_adjunto (
  id bigint generated always as identity not null,
  documento_id bigint not null,
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

create table wikidocs.documento_favorito (
  id bigint generated always as identity not null,
  documento_id bigint not null,
  usuario text not null,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table wikidocs.documento_referencia_modulo (
  id bigint generated always as identity not null,
  documento_id bigint not null,
  ruta text not null,
  etiqueta text not null,
  grupo text not null,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table wikidocs.documento_referencia_proceso (
  id bigint generated always as identity not null,
  documento_id bigint not null,
  texto text not null,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table wikidocs.documento_referencia_tabla (
  id bigint generated always as identity not null,
  documento_id bigint not null,
  texto text not null,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table wikidocs.documento_relacion (
  id bigint generated always as identity not null,
  documento_id bigint not null,
  documento_relacionado_id bigint not null,
  tipo text not null,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table wikidocs.documento_version (
  id bigint generated always as identity not null,
  documento_id bigint not null,
  titulo text not null,
  contenido text not null default ''::text,
  usuario text not null,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table wikidocs.plantilla_documento (
  id bigint generated always as identity not null,
  nombre text not null,
  contenido text not null default ''::text,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table wikidocs.seccion (
  id bigint generated always as identity not null,
  categoria_id bigint not null,
  nombre text not null,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table wikidocs.tipo_sistema (
  id bigint generated always as identity not null,
  nombre text not null,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

alter table wikidocs.categoria enable row level security;

alter table wikidocs.documento enable row level security;

alter table wikidocs.documento_adjunto enable row level security;

alter table wikidocs.documento_favorito enable row level security;

alter table wikidocs.documento_referencia_modulo enable row level security;

alter table wikidocs.documento_referencia_proceso enable row level security;

alter table wikidocs.documento_referencia_tabla enable row level security;

alter table wikidocs.documento_relacion enable row level security;

alter table wikidocs.documento_version enable row level security;

alter table wikidocs.plantilla_documento enable row level security;

alter table wikidocs.seccion enable row level security;

alter table wikidocs.tipo_sistema enable row level security;

alter table wikidocs.categoria add constraint categoria_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table wikidocs.categoria add constraint categoria_tipo_sistema_id_fkey FOREIGN KEY (tipo_sistema_id) REFERENCES wikidocs.tipo_sistema(id);

alter table wikidocs.categoria add constraint categoria_pkey PRIMARY KEY (id);

alter table wikidocs.documento add constraint documento_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table wikidocs.documento add constraint documento_pkey PRIMARY KEY (id);

alter table wikidocs.documento add constraint documento_seccion_id_fkey FOREIGN KEY (seccion_id) REFERENCES wikidocs.seccion(id);

alter table wikidocs.documento_adjunto add constraint documento_adjunto_pkey PRIMARY KEY (id);

alter table wikidocs.documento_adjunto add constraint documento_adjunto_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table wikidocs.documento_adjunto add constraint documento_adjunto_documento_id_fkey FOREIGN KEY (documento_id) REFERENCES wikidocs.documento(id) ON DELETE CASCADE;

alter table wikidocs.documento_favorito add constraint documento_favorito_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table wikidocs.documento_favorito add constraint documento_favorito_documento_id_fkey FOREIGN KEY (documento_id) REFERENCES wikidocs.documento(id) ON DELETE CASCADE;

alter table wikidocs.documento_favorito add constraint documento_favorito_documento_id_usuario_key UNIQUE (documento_id, usuario);

alter table wikidocs.documento_favorito add constraint documento_favorito_pkey PRIMARY KEY (id);

alter table wikidocs.documento_referencia_modulo add constraint documento_referencia_modulo_pkey PRIMARY KEY (id);

alter table wikidocs.documento_referencia_modulo add constraint documento_referencia_modulo_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table wikidocs.documento_referencia_modulo add constraint documento_referencia_modulo_documento_id_fkey FOREIGN KEY (documento_id) REFERENCES wikidocs.documento(id) ON DELETE CASCADE;

alter table wikidocs.documento_referencia_proceso add constraint documento_referencia_proceso_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table wikidocs.documento_referencia_proceso add constraint documento_referencia_proceso_documento_id_fkey FOREIGN KEY (documento_id) REFERENCES wikidocs.documento(id) ON DELETE CASCADE;

alter table wikidocs.documento_referencia_proceso add constraint documento_referencia_proceso_pkey PRIMARY KEY (id);

alter table wikidocs.documento_referencia_tabla add constraint documento_referencia_tabla_pkey PRIMARY KEY (id);

alter table wikidocs.documento_referencia_tabla add constraint documento_referencia_tabla_documento_id_fkey FOREIGN KEY (documento_id) REFERENCES wikidocs.documento(id) ON DELETE CASCADE;

alter table wikidocs.documento_referencia_tabla add constraint documento_referencia_tabla_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table wikidocs.documento_relacion add constraint documento_relacion_pkey PRIMARY KEY (id);

alter table wikidocs.documento_relacion add constraint documento_relacion_tipo_check CHECK ((tipo = ANY (ARRAY['relacionado'::text, 'depende_de'::text, 'reemplaza_a'::text])));

alter table wikidocs.documento_relacion add constraint documento_relacion_documento_id_fkey FOREIGN KEY (documento_id) REFERENCES wikidocs.documento(id) ON DELETE CASCADE;

alter table wikidocs.documento_relacion add constraint documento_relacion_documento_relacionado_id_fkey FOREIGN KEY (documento_relacionado_id) REFERENCES wikidocs.documento(id) ON DELETE CASCADE;

alter table wikidocs.documento_relacion add constraint documento_relacion_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table wikidocs.documento_version add constraint documento_version_pkey PRIMARY KEY (id);

alter table wikidocs.documento_version add constraint documento_version_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table wikidocs.documento_version add constraint documento_version_documento_id_fkey FOREIGN KEY (documento_id) REFERENCES wikidocs.documento(id) ON DELETE CASCADE;

alter table wikidocs.plantilla_documento add constraint plantilla_documento_pkey PRIMARY KEY (id);

alter table wikidocs.plantilla_documento add constraint plantilla_documento_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table wikidocs.seccion add constraint seccion_pkey PRIMARY KEY (id);

alter table wikidocs.seccion add constraint seccion_categoria_id_fkey FOREIGN KEY (categoria_id) REFERENCES wikidocs.categoria(id);

alter table wikidocs.seccion add constraint seccion_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table wikidocs.tipo_sistema add constraint tipo_sistema_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table wikidocs.tipo_sistema add constraint tipo_sistema_pkey PRIMARY KEY (id);

CREATE INDEX categoria_empresa_id_ix ON wikidocs.categoria USING btree (empresa_id);

CREATE INDEX categoria_tipo_sistema_id_ix ON wikidocs.categoria USING btree (tipo_sistema_id);

CREATE INDEX documento_empresa_id_ix ON wikidocs.documento USING btree (empresa_id);

CREATE INDEX documento_seccion_id_ix ON wikidocs.documento USING btree (seccion_id);

CREATE INDEX documento_adjunto_documento_id_ix ON wikidocs.documento_adjunto USING btree (documento_id);

CREATE INDEX documento_adjunto_empresa_id_ix ON wikidocs.documento_adjunto USING btree (empresa_id);

CREATE INDEX documento_favorito_empresa_id_ix ON wikidocs.documento_favorito USING btree (empresa_id);

CREATE INDEX documento_referencia_modulo_documento_id_ix ON wikidocs.documento_referencia_modulo USING btree (documento_id);

CREATE INDEX documento_referencia_modulo_empresa_id_ix ON wikidocs.documento_referencia_modulo USING btree (empresa_id);

CREATE INDEX documento_referencia_proceso_empresa_id_ix ON wikidocs.documento_referencia_proceso USING btree (empresa_id);

CREATE INDEX documento_referencia_proceso_documento_id_ix ON wikidocs.documento_referencia_proceso USING btree (documento_id);

CREATE INDEX documento_referencia_tabla_documento_id_ix ON wikidocs.documento_referencia_tabla USING btree (documento_id);

CREATE INDEX documento_referencia_tabla_empresa_id_ix ON wikidocs.documento_referencia_tabla USING btree (empresa_id);

CREATE INDEX documento_relacion_empresa_id_ix ON wikidocs.documento_relacion USING btree (empresa_id);

CREATE INDEX documento_relacion_documento_id_ix ON wikidocs.documento_relacion USING btree (documento_id);

CREATE INDEX documento_relacion_documento_relacionado_id_ix ON wikidocs.documento_relacion USING btree (documento_relacionado_id);

CREATE INDEX documento_version_empresa_id_ix ON wikidocs.documento_version USING btree (empresa_id);

CREATE INDEX documento_version_documento_id_ix ON wikidocs.documento_version USING btree (documento_id);

CREATE INDEX plantilla_documento_empresa_id_ix ON wikidocs.plantilla_documento USING btree (empresa_id);

CREATE INDEX seccion_categoria_id_ix ON wikidocs.seccion USING btree (categoria_id);

CREATE INDEX seccion_empresa_id_ix ON wikidocs.seccion USING btree (empresa_id);

CREATE INDEX tipo_sistema_empresa_id_ix ON wikidocs.tipo_sistema USING btree (empresa_id);

create policy modulo_habilitado on wikidocs.categoria as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('wikidocs'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('wikidocs'::text) AS modulo_habilitado));

create policy solo_mi_empresa on wikidocs.categoria as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on wikidocs.categoria as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy compartida_todo on wikidocs.documento as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy modulo_habilitado on wikidocs.documento as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('wikidocs'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('wikidocs'::text) AS modulo_habilitado));

create policy solo_mi_empresa on wikidocs.documento as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy solo_mi_empresa on wikidocs.documento_adjunto as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy modulo_habilitado on wikidocs.documento_adjunto as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('wikidocs'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('wikidocs'::text) AS modulo_habilitado));

create policy compartida_todo on wikidocs.documento_adjunto as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on wikidocs.documento_favorito as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on wikidocs.documento_favorito as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy modulo_habilitado on wikidocs.documento_favorito as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('wikidocs'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('wikidocs'::text) AS modulo_habilitado));

create policy solo_mi_empresa on wikidocs.documento_referencia_modulo as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on wikidocs.documento_referencia_modulo as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy modulo_habilitado on wikidocs.documento_referencia_modulo as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('wikidocs'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('wikidocs'::text) AS modulo_habilitado));

create policy compartida_todo on wikidocs.documento_referencia_proceso as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on wikidocs.documento_referencia_proceso as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy modulo_habilitado on wikidocs.documento_referencia_proceso as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('wikidocs'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('wikidocs'::text) AS modulo_habilitado));

create policy solo_mi_empresa on wikidocs.documento_referencia_tabla as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on wikidocs.documento_referencia_tabla as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy modulo_habilitado on wikidocs.documento_referencia_tabla as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('wikidocs'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('wikidocs'::text) AS modulo_habilitado));

create policy compartida_todo on wikidocs.documento_relacion as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy modulo_habilitado on wikidocs.documento_relacion as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('wikidocs'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('wikidocs'::text) AS modulo_habilitado));

create policy solo_mi_empresa on wikidocs.documento_relacion as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on wikidocs.documento_version as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on wikidocs.documento_version as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy modulo_habilitado on wikidocs.documento_version as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('wikidocs'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('wikidocs'::text) AS modulo_habilitado));

create policy modulo_habilitado on wikidocs.plantilla_documento as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('wikidocs'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('wikidocs'::text) AS modulo_habilitado));

create policy solo_mi_empresa on wikidocs.plantilla_documento as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on wikidocs.plantilla_documento as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy compartida_todo on wikidocs.seccion as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on wikidocs.seccion as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy modulo_habilitado on wikidocs.seccion as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('wikidocs'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('wikidocs'::text) AS modulo_habilitado));

create policy modulo_habilitado on wikidocs.tipo_sistema as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('wikidocs'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('wikidocs'::text) AS modulo_habilitado));

create policy compartida_todo on wikidocs.tipo_sistema as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on wikidocs.tipo_sistema as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON wikidocs.categoria FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON wikidocs.documento FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON wikidocs.documento_adjunto FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON wikidocs.documento_favorito FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON wikidocs.documento_referencia_modulo FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON wikidocs.documento_referencia_proceso FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON wikidocs.documento_referencia_tabla FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON wikidocs.documento_relacion FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON wikidocs.documento_version FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON wikidocs.plantilla_documento FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON wikidocs.seccion FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON wikidocs.tipo_sistema FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

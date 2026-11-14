-- ============================================================================
-- SAURIX — Línea base reproducible (Etapa B5.1) — Esquema: panel_control
-- Generado por introspección de pg_catalog el 2026-11-11. Ver limitaciones en
-- claude/saurix-correccion2-etapa-b5-1-linea-base-2026-11.md, Bloque A.
-- ============================================================================

create schema if not exists panel_control;

create table panel_control.configuracion_apariencia (
  id bigint generated always as identity not null,
  empresa_id bigint not null default privado.empresa_actual_id(),
  usuario_id bigint not null,
  tema text not null default 'claro'::text,
  asistente_ia_activo boolean not null default true,
  tamano_pagina_grid integer not null default 10,
  vista_proyectos_preferida text not null default 'tablero'::text,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true
);

create table panel_control.valor_lista (
  id bigint generated always as identity not null,
  empresa_id bigint not null default privado.empresa_actual_id(),
  grupo text not null,
  clave text not null,
  etiqueta text not null,
  orden integer not null default 0,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true
);

alter table panel_control.configuracion_apariencia enable row level security;

alter table panel_control.valor_lista enable row level security;

alter table panel_control.configuracion_apariencia add constraint configuracion_apariencia_usuario_id_key UNIQUE (usuario_id);

alter table panel_control.configuracion_apariencia add constraint configuracion_apariencia_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table panel_control.configuracion_apariencia add constraint configuracion_apariencia_pkey PRIMARY KEY (id);

alter table panel_control.configuracion_apariencia add constraint configuracion_apariencia_tamano_pagina_grid_check CHECK ((tamano_pagina_grid > 0));

alter table panel_control.configuracion_apariencia add constraint configuracion_apariencia_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES seguridad.usuario(id) ON DELETE CASCADE;

alter table panel_control.valor_lista add constraint valor_lista_pkey PRIMARY KEY (id);

alter table panel_control.valor_lista add constraint valor_lista_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

CREATE INDEX configuracion_apariencia_empresa_id_ix ON panel_control.configuracion_apariencia USING btree (empresa_id);

CREATE UNIQUE INDEX valor_lista_empresa_grupo_clave_uk ON panel_control.valor_lista USING btree (empresa_id, grupo, clave);

create policy propio_todo on panel_control.configuracion_apariencia as permissive for ALL to authenticated
  using ((usuario_id = ( SELECT privado.usuario_actual_id() AS usuario_actual_id)))
  with check ((usuario_id = ( SELECT privado.usuario_actual_id() AS usuario_actual_id)));

create policy solo_mi_empresa on panel_control.configuracion_apariencia as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on panel_control.valor_lista as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on panel_control.valor_lista as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

CREATE OR REPLACE FUNCTION panel_control.importar_entidad(p_entidad text, p_filas jsonb, p_usuarios jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select privado.importar_entidad(p_entidad, p_filas, p_usuarios) $function$
;

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON panel_control.configuracion_apariencia FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON panel_control.valor_lista FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

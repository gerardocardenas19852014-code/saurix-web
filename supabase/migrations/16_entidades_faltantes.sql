-- =====================================================================
-- Saurix · Supabase · 16 Entidades que faltaban en NUBE (Familia/WikiDocs)
--  Estas 6 tablas ya las usaba el frontend (Árbol genealógico → "familiar
--  de referencia", Directorio familiar, y WikiDocs → referencias de
--  documento a tablas/procesos/módulos y relaciones entre documentos) pero
--  nunca se crearon en Supabase ni se registraron en supabase-esquema.ts
--  — por eso fallaban con "La entidad 'X' no existe en Supabase" en modo
--  Nube, aunque sí funcionaban en local (IndexedDB).
-- =====================================================================
set check_function_bodies = off;

-- ---------------------------------------------------------------------
-- Familia
-- ---------------------------------------------------------------------
create table familia.pariente_referencia (
  id                  bigint generated always as identity primary key,
  miembro_familia_id  bigint not null references familia.miembro_familia(id) on delete cascade,
  nombre              text not null,
  parentesco          text not null,
  fecha_nacimiento    date,
  fallecido           boolean not null default false,
  fecha_fallecimiento date,
  notas               text
);

create table familia.contacto_familiar (
  id        bigint generated always as identity primary key,
  nombre    text not null,
  categoria text not null,
  telefono  text,
  correo    text,
  direccion text,
  notas     text
);

-- ---------------------------------------------------------------------
-- WikiDocs
-- ---------------------------------------------------------------------
create table wikidocs.documento_referencia_tabla (
  id           bigint generated always as identity primary key,
  documento_id bigint not null references wikidocs.documento(id) on delete cascade,
  texto        text not null
);

create table wikidocs.documento_referencia_proceso (
  id           bigint generated always as identity primary key,
  documento_id bigint not null references wikidocs.documento(id) on delete cascade,
  texto        text not null
);

create table wikidocs.documento_referencia_modulo (
  id           bigint generated always as identity primary key,
  documento_id bigint not null references wikidocs.documento(id) on delete cascade,
  ruta         text not null,
  etiqueta     text not null,
  grupo        text not null
);

create table wikidocs.documento_relacion (
  id                       bigint generated always as identity primary key,
  documento_id             bigint not null references wikidocs.documento(id) on delete cascade,
  documento_relacionado_id bigint not null references wikidocs.documento(id) on delete cascade,
  tipo                     text not null check (tipo in ('relacionado', 'depende_de', 'reemplaza_a'))
);

-- ---------------------------------------------------------------------
-- Auditoría + empresa_id + permisos + RLS en las 6 tablas nuevas, igual
-- que el resto de los módulos (ver 02_seguridad_rls.sql, 09_empresas.sql
-- y 15_licencias_modulos.sql).
-- ---------------------------------------------------------------------
do $$
declare t record;
begin
  for t in
    select table_schema, table_name from information_schema.tables
    where table_type = 'BASE TABLE'
      and (table_schema, table_name) in (
        ('familia', 'pariente_referencia'),
        ('familia', 'contacto_familiar'),
        ('wikidocs', 'documento_referencia_tabla'),
        ('wikidocs', 'documento_referencia_proceso'),
        ('wikidocs', 'documento_referencia_modulo'),
        ('wikidocs', 'documento_relacion')
      )
  loop
    execute format($f$
      alter table %1$I.%2$I
        add column fecha_creacion     timestamptz not null default now(),
        add column fecha_modificacion timestamptz,
        add column creado_por         bigint,
        add column modificado_por     bigint,
        add column activo             boolean not null default true,
        add column empresa_id         bigint not null default privado.empresa_actual_id() references seguridad.empresa(id)
    $f$, t.table_schema, t.table_name);

    execute format('create trigger trg_auditoria before insert or update on %I.%I
                    for each row execute function privado.auditoria()', t.table_schema, t.table_name);

    execute format('create index %I on %I.%I (empresa_id)',
                   left(t.table_name || '_empresa_id_ix', 63), t.table_schema, t.table_name);

    execute format('revoke all on %I.%I from anon', t.table_schema, t.table_name);
    execute format('grant select, insert, update, delete on %I.%I to authenticated', t.table_schema, t.table_name);
    execute format('grant all on %I.%I to service_role', t.table_schema, t.table_name);
    execute format('grant usage, select on sequence %I.%I to authenticated, service_role',
                   t.table_schema, left(t.table_name || '_id_seq', 63));

    execute format('alter table %I.%I enable row level security', t.table_schema, t.table_name);

    execute format('create policy compartida_todo on %I.%I for all to authenticated
                    using ((select privado.usuario_actual_id()) is not null)
                    with check ((select privado.usuario_actual_id()) is not null)',
                   t.table_schema, t.table_name);

    execute format('create policy solo_mi_empresa on %I.%I as restrictive for all to authenticated
                    using (empresa_id = (select privado.empresa_actual_id()))
                    with check (empresa_id = (select privado.empresa_actual_id()))',
                   t.table_schema, t.table_name);

    execute format('create policy modulo_habilitado on %I.%I as restrictive for all to authenticated
                    using (privado.modulo_habilitado(%L))
                    with check (privado.modulo_habilitado(%L))',
                   t.table_schema, t.table_name, t.table_schema, t.table_schema);
  end loop;
end $$;

-- Índices en las FKs que no los traen automáticos.
create index pariente_referencia_miembro_familia_id_ix on familia.pariente_referencia (miembro_familia_id);
create index documento_referencia_tabla_documento_id_ix on wikidocs.documento_referencia_tabla (documento_id);
create index documento_referencia_proceso_documento_id_ix on wikidocs.documento_referencia_proceso (documento_id);
create index documento_referencia_modulo_documento_id_ix on wikidocs.documento_referencia_modulo (documento_id);
create index documento_relacion_documento_id_ix on wikidocs.documento_relacion (documento_id);
create index documento_relacion_documento_relacionado_id_ix on wikidocs.documento_relacion (documento_relacionado_id);

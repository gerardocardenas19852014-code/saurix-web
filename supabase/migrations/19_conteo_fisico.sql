-- =====================================================================
-- Saurix · Supabase · 19 Conteo físico con historial propio
--  - inventario.conteo_fisico: encabezado de UNA sesión de conteo físico
--    ya guardada (bodega, quién la hizo, cuándo, cuántos productos y
--    cuántas diferencias) — antes esto se perdía: un conteo sin
--    diferencias no dejaba ningún rastro, y uno con diferencias solo se
--    veía indirectamente como ajustes sueltos en movimiento_inventario,
--    sin nada que diga "esto fue UN conteo".
--  - inventario.conteo_fisico_detalle: una línea por CADA producto
--    contado en esa sesión (sistema/contado/diferencia), tenga diferencia
--    o no — así el historial muestra el conteo completo, no solo las
--    discrepancias.
--  - Mismo patrón que 17_compras.sql / 18_nivel_minimo_bodega.sql: tablas
--    nuevas dentro de un esquema (inventario) que YA está module-gated
--    desde 15_licencias_modulos.sql — hay que repetir aquí la política
--    RESTRICTIVE modulo_habilitado explícitamente.
-- =====================================================================
set check_function_bodies = off;

create table inventario.conteo_fisico (
  id                bigint generated always as identity primary key,
  bodega_id         bigint not null references inventario.bodega(id) on delete cascade,
  usuario_id        bigint not null references seguridad.usuario(id) on delete cascade,
  fecha             timestamptz not null default now(),
  total_productos   integer not null default 0,
  total_diferencias integer not null default 0,
  notas             text
);

create table inventario.conteo_fisico_detalle (
  id               bigint generated always as identity primary key,
  conteo_fisico_id bigint not null references inventario.conteo_fisico(id) on delete cascade,
  producto_id      bigint not null references inventario.producto(id) on delete cascade,
  sistema          numeric(14,2) not null,
  contado          numeric(14,2) not null,
  diferencia       numeric(14,2) not null
);

-- ---------------------------------------------------------------------
-- Auditoría + empresa_id + permisos + RLS en las 2 tablas nuevas, igual
-- patrón que 17_compras.sql / 18_nivel_minimo_bodega.sql.
-- ---------------------------------------------------------------------
do $$
declare t record;
begin
  for t in
    select table_schema, table_name from information_schema.tables
    where table_type = 'BASE TABLE'
      and (table_schema, table_name) in (
        ('inventario', 'conteo_fisico'),
        ('inventario', 'conteo_fisico_detalle')
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
create index conteo_fisico_bodega_id_ix               on inventario.conteo_fisico (bodega_id);
create index conteo_fisico_usuario_id_ix               on inventario.conteo_fisico (usuario_id);
create index conteo_fisico_detalle_conteo_fisico_id_ix on inventario.conteo_fisico_detalle (conteo_fisico_id);
create index conteo_fisico_detalle_producto_id_ix      on inventario.conteo_fisico_detalle (producto_id);

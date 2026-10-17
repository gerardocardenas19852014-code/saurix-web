-- =====================================================================
-- Saurix · Supabase · 24 Lotes y caducidad
--  - producto.maneja_lotes: opt-in (ver LoteProducto.model.ts / producto.model.ts).
--  - inventario.lote_producto: registro INFORMATIVO de lotes con fecha de
--    caducidad — NO reemplaza ni recalcula inventario.existencia_bodega
--    (ver el comentario completo en lote-producto.model.ts). Tabla NUEVA
--    dentro de un esquema (inventario) YA module-gated desde
--    15_licencias_modulos.sql — hay que repetir aquí la política
--    RESTRICTIVE modulo_habilitado explícitamente, mismo patrón exacto
--    que 23_aviso_orden_vencida.sql.
-- =====================================================================
set check_function_bodies = off;

alter table inventario.producto
  add column maneja_lotes boolean not null default false;

create table inventario.lote_producto (
  id                bigint generated always as identity primary key,
  producto_id       bigint not null references inventario.producto(id) on delete cascade,
  bodega_id         bigint references inventario.bodega(id),
  lote              text not null,
  fecha_caducidad   date,
  cantidad          numeric(14,2),
  notas             text
);

do $$
declare t record;
begin
  for t in
    select table_schema, table_name from information_schema.tables
    where table_type = 'BASE TABLE'
      and (table_schema, table_name) = ('inventario', 'lote_producto')
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

create index lote_producto_producto_id_ix on inventario.lote_producto (producto_id);
create index lote_producto_bodega_id_ix    on inventario.lote_producto (bodega_id);
create index lote_producto_fecha_caducidad_ix on inventario.lote_producto (fecha_caducidad);

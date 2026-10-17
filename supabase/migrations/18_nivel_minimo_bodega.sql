-- =====================================================================
-- Saurix · Supabase · 18 Nivel mínimo por bodega
--  - inventario.nivel_minimo_bodega: nivel mínimo de existencia PROPIO de
--    un producto en UNA bodega concreta — a diferencia de
--    inventario.producto.nivel_minimo (un solo valor global), permite que
--    el mismo producto tenga un mínimo distinto en cada bodega. Mismo
--    patrón que 17_compras.sql: tabla nueva dentro de un esquema
--    (inventario) que YA está module-gated desde 15_licencias_modulos.sql
--    — hay que repetir aquí la política RESTRICTIVE modulo_habilitado
--    explícitamente.
--  - Mientras un producto no tenga NINGÚN registro aquí, el frontend sigue
--    usando su producto.nivel_minimo "heredado" contra la existencia TOTAL
--    (ver alertasStockBajo() en producto.util.ts) — mismo patrón "heredado"
--    que existencia_bodega con producto.existencia y producto_proveedor con
--    producto.proveedor_id.
--  - inventario.aviso_stock_bajo (dedupe de la alerta persistente) gana una
--    columna bodega_id opcional: ahora un mismo producto puede tener una
--    alerta por cada bodega que esté baja a la vez (o una sola alerta
--    "global" con bodega_id null, si no tiene mínimos propios), así que el
--    dedupe por (producto, usuario, día) de antes se vuelve a (producto,
--    bodega, usuario, día) — usando coalesce(bodega_id, 0) porque NULL no
--    es comparable a sí mismo en un índice único normal.
-- =====================================================================
set check_function_bodies = off;

create table inventario.nivel_minimo_bodega (
  id            bigint generated always as identity primary key,
  producto_id   bigint not null references inventario.producto(id) on delete cascade,
  bodega_id     bigint not null references inventario.bodega(id) on delete cascade,
  nivel_minimo  numeric(14,2) not null,
  unique (producto_id, bodega_id)
);

alter table inventario.aviso_stock_bajo
  add column bodega_id bigint references inventario.bodega(id) on delete cascade;

alter table inventario.aviso_stock_bajo
  drop constraint aviso_stock_bajo_producto_id_usuario_id_dia_key;

create unique index aviso_stock_bajo_producto_bodega_usuario_dia_uk
  on inventario.aviso_stock_bajo (producto_id, usuario_id, dia, coalesce(bodega_id, 0));

create index aviso_stock_bajo_bodega_id_ix on inventario.aviso_stock_bajo (bodega_id);

-- ---------------------------------------------------------------------
-- Auditoría + empresa_id + permisos + RLS en la tabla nueva, igual patrón
-- que 16_entidades_faltantes.sql / 17_compras.sql.
-- ---------------------------------------------------------------------
do $$
declare t record;
begin
  for t in
    select table_schema, table_name from information_schema.tables
    where table_type = 'BASE TABLE'
      and (table_schema, table_name) = ('inventario', 'nivel_minimo_bodega')
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
create index nivel_minimo_bodega_producto_id_ix on inventario.nivel_minimo_bodega (producto_id);
create index nivel_minimo_bodega_bodega_id_ix   on inventario.nivel_minimo_bodega (bodega_id);

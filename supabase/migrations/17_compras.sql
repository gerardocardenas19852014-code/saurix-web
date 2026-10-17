-- =====================================================================
-- Saurix · Supabase · 17 Compras (Órdenes de compra + múltiples
-- proveedores por producto)
--  - inventario.producto_proveedor: proveedores alternativos de un
--    producto, con su propio precio de compra y tiempo de entrega; uno de
--    ellos puede marcarse "preferido" (ver proveedor-productos.component.ts
--    en el frontend). Mientras un producto no tenga ningún registro aquí,
--    el frontend sigue usando el proveedor_id "heredado" de
--    inventario.producto (mismo patrón que existencia_bodega con
--    producto.existencia).
--  - inventario.orden_compra / orden_compra_item: encabezado + líneas de
--    una orden de compra a un proveedor, con su folio (OC-0001...) y
--    estado (pendiente / recibida_parcial / recibida_completa /
--    cancelada). Al recibir mercancía (ver orden-compra.service.ts en el
--    frontend) se registra un inventario.movimiento_inventario de Entrada
--    y se actualiza producto.costo con costeo promedio ponderado — por
--    eso movimiento_inventario gana aquí dos columnas opcionales:
--    orden_compra_id (para poder mostrar "de qué orden vino") y
--    costo_unitario (el costo con el que entró ESE movimiento, que puede
--    diferir del costo promedio ya actualizado del producto).
--  - Mismo patrón que 16_entidades_faltantes.sql: tablas nuevas dentro de
--    un esquema (inventario) que YA está module-gated desde
--    15_licencias_modulos.sql — por eso hay que repetir aquí la política
--    RESTRICTIVE modulo_habilitado('inventario') explícitamente; el loop
--    de 15 solo corrió sobre las tablas que existían en ese momento.
-- =====================================================================
set check_function_bodies = off;

create table inventario.producto_proveedor (
  id                   bigint generated always as identity primary key,
  producto_id          bigint not null references inventario.producto(id) on delete cascade,
  proveedor_id         bigint not null references inventario.proveedor(id) on delete cascade,
  precio_compra        numeric(14,2) not null default 0,
  tiempo_entrega_dias  integer,
  preferido            boolean not null default false,
  unique (producto_id, proveedor_id)
);

create table inventario.orden_compra (
  id                     bigint generated always as identity primary key,
  folio                  text not null,
  proveedor_id           bigint not null references inventario.proveedor(id) on delete cascade,
  bodega_destino_id      bigint not null references inventario.bodega(id) on delete cascade,
  estado                 text not null default 'pendiente'
    check (estado in ('pendiente', 'recibida_parcial', 'recibida_completa', 'cancelada')),
  fecha                  date not null default current_date,
  fecha_entrega_estimada date,
  notas                  text
);

create table inventario.orden_compra_item (
  id                bigint generated always as identity primary key,
  orden_compra_id   bigint not null references inventario.orden_compra(id) on delete cascade,
  producto_id       bigint not null references inventario.producto(id) on delete cascade,
  cantidad          numeric(14,2) not null,
  costo_unitario    numeric(14,2) not null default 0,
  cantidad_recibida numeric(14,2) not null default 0
);

-- Dos columnas opcionales nuevas en movimiento_inventario (tabla ya
-- existente desde 14_inventario.sql, ya con RLS/auditoría/empresa_id —
-- no hace falta repetir nada de eso, solo las columnas + su índice).
alter table inventario.movimiento_inventario
  add column orden_compra_id bigint references inventario.orden_compra(id) on delete set null,
  add column costo_unitario  numeric(14,2);
create index movimiento_inventario_orden_compra_id_ix on inventario.movimiento_inventario (orden_compra_id);

-- ---------------------------------------------------------------------
-- Auditoría + empresa_id + permisos + RLS en las 3 tablas nuevas, igual
-- patrón que 16_entidades_faltantes.sql.
-- ---------------------------------------------------------------------
do $$
declare t record;
begin
  for t in
    select table_schema, table_name from information_schema.tables
    where table_type = 'BASE TABLE'
      and (table_schema, table_name) in (
        ('inventario', 'producto_proveedor'),
        ('inventario', 'orden_compra'),
        ('inventario', 'orden_compra_item')
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
create index producto_proveedor_producto_id_ix     on inventario.producto_proveedor (producto_id);
create index producto_proveedor_proveedor_id_ix    on inventario.producto_proveedor (proveedor_id);
create index orden_compra_proveedor_id_ix          on inventario.orden_compra (proveedor_id);
create index orden_compra_bodega_destino_id_ix     on inventario.orden_compra (bodega_destino_id);
create index orden_compra_item_orden_compra_id_ix  on inventario.orden_compra_item (orden_compra_id);
create index orden_compra_item_producto_id_ix      on inventario.orden_compra_item (producto_id);

-- Folio único por empresa (igual criterio que bodega/categoria_producto/etc.
-- en 14_inventario.sql).
create unique index orden_compra_empresa_folio_uk on inventario.orden_compra (empresa_id, folio);

-- A lo más un proveedor "preferido" por producto (mismo criterio que ya
-- aplica el frontend en proveedor-productos.component.ts al marcarlo, pero
-- reforzado aquí por si alguien llama la API directo).
create unique index producto_proveedor_un_preferido_uk
  on inventario.producto_proveedor (producto_id) where preferido;

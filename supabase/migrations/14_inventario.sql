-- =====================================================================
-- Saurix · Supabase · 14 Inventario
--  - Esquema inventario: catálogos (bodega, categoría de producto, unidad
--    de medida, proveedor, tipo de lista de precio), producto, existencia
--    por bodega, movimientos de inventario, precios por lista de precio y
--    avisos de stock bajo.
--  - Mismo patrón que los demás módulos (ver 01_esquema.sql / 02_seguridad_rls.sql /
--    09_empresas.sql): auditoría automática, índices en FK, permisos de rol,
--    RLS y multiempresa (empresa_id + política restrictiva solo_mi_empresa).
--  - Todas las tablas son "compartidas" dentro de la empresa (como
--    proyectos/wikidocs: cualquier usuario activo y vigente puede todo),
--    salvo aviso_stock_bajo que es "propia" del usuario que recibe el aviso
--    (mismo patrón que presupuesto.aviso_tarjeta_ciclo).
-- =====================================================================
set check_function_bodies = off;

create schema if not exists inventario;

-- ---------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------
create table inventario.bodega (
  id        bigint generated always as identity primary key,
  nombre    text not null,
  clave     text not null,
  direccion text
);

create table inventario.categoria_producto (
  id          bigint generated always as identity primary key,
  nombre      text not null,
  clave       text not null,
  descripcion text
);

create table inventario.unidad_medida (
  id     bigint generated always as identity primary key,
  nombre text not null,
  clave  text not null
);

create table inventario.proveedor (
  id       bigint generated always as identity primary key,
  nombre   text not null,
  contacto text,
  telefono text,
  correo   text
);

create table inventario.tipo_lista_precio (
  id          bigint generated always as identity primary key,
  nombre      text not null,
  clave       text not null,
  descripcion text
);

create table inventario.producto (
  id                     bigint generated always as identity primary key,
  nombre                 text not null,
  codigo                 text,
  categoria_producto_id  bigint not null references inventario.categoria_producto(id),
  unidad_medida_id       bigint not null references inventario.unidad_medida(id),
  descripcion            text,
  costo                  numeric(14,2) not null default 0,
  precio_unitario        numeric(14,2) not null default 0,
  existencia             numeric(14,2),
  nivel_minimo           numeric(14,2),
  proveedor_id           bigint references inventario.proveedor(id) on delete set null,
  foto                   text
);

create table inventario.existencia_bodega (
  id          bigint generated always as identity primary key,
  producto_id bigint not null references inventario.producto(id) on delete cascade,
  bodega_id   bigint not null references inventario.bodega(id) on delete cascade,
  existencia  numeric(14,2) not null default 0,
  unique (producto_id, bodega_id)
);

create table inventario.movimiento_inventario (
  id                bigint generated always as identity primary key,
  producto_id       bigint not null references inventario.producto(id) on delete cascade,
  bodega_origen_id  bigint references inventario.bodega(id) on delete set null,
  bodega_destino_id bigint references inventario.bodega(id) on delete set null,
  cantidad          numeric(14,2) not null,
  fecha             date not null default current_date,
  nota              text,
  check (bodega_origen_id is not null or bodega_destino_id is not null)
);

create table inventario.precio_lista (
  id                     bigint generated always as identity primary key,
  tipo_lista_precio_id   bigint not null references inventario.tipo_lista_precio(id) on delete cascade,
  producto_id            bigint not null references inventario.producto(id) on delete cascade,
  precio                 numeric(14,2) not null default 0,
  unique (tipo_lista_precio_id, producto_id)
);

create table inventario.aviso_stock_bajo (
  id          bigint generated always as identity primary key,
  producto_id bigint not null references inventario.producto(id) on delete cascade,
  usuario_id  bigint not null references seguridad.usuario(id) on delete cascade,
  dia         date not null default current_date,
  unique (producto_id, usuario_id, dia)
);

-- ---------------------------------------------------------------------
-- Columnas de auditoría + trigger (igual que 02_seguridad_rls.sql §2)
-- ---------------------------------------------------------------------
do $$
declare t record;
begin
  for t in
    select table_schema, table_name from information_schema.tables
    where table_type = 'BASE TABLE' and table_schema = 'inventario'
  loop
    execute format($f$
      alter table %1$I.%2$I
        add column if not exists fecha_creacion     timestamptz not null default now(),
        add column if not exists fecha_modificacion timestamptz,
        add column if not exists creado_por         bigint,
        add column if not exists modificado_por     bigint,
        add column if not exists activo             boolean not null default true
    $f$, t.table_schema, t.table_name);
    execute format('create trigger trg_auditoria before insert or update on %I.%I
                    for each row execute function privado.auditoria()', t.table_schema, t.table_name);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Índices en llaves foráneas que no tengan uno (igual que §3)
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tabla, n.nspname as esquema, cl.relname as nombre_tabla,
           a.attname as columna
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_namespace n on n.oid = cl.relnamespace
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and array_length(c.conkey, 1) = 1
      and n.nspname = 'inventario'
      and not exists (
        select 1 from pg_index i
        where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]
      )
  loop
    execute format('create index if not exists %I on %s (%I)',
                   left(r.nombre_tabla || '_' || r.columna || '_ix', 63), r.tabla, r.columna);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Permisos de rol (anon no tiene acceso a nada, igual que §4)
-- ---------------------------------------------------------------------
revoke all on all tables in schema inventario from anon;
grant usage on schema inventario to authenticated, service_role;
grant select, insert, update, delete on all tables in schema inventario to authenticated;
grant all on all tables in schema inventario to service_role;
grant usage, select on all sequences in schema inventario to authenticated, service_role;
alter default privileges in schema inventario grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema inventario grant all on tables to service_role;
alter default privileges in schema inventario grant usage, select on sequences to authenticated, service_role;

-- ---------------------------------------------------------------------
-- RLS (igual que §5)
-- ---------------------------------------------------------------------
do $$
declare t record;
begin
  for t in
    select table_schema, table_name from information_schema.tables
    where table_type = 'BASE TABLE' and table_schema = 'inventario'
  loop
    execute format('alter table %I.%I enable row level security', t.table_schema, t.table_name);
  end loop;
end $$;

-- Catálogos y datos compartidos: cualquier usuario activo y vigente puede todo.
do $$
declare t text;
begin
  foreach t in array array[
    'inventario.bodega','inventario.categoria_producto','inventario.unidad_medida',
    'inventario.proveedor','inventario.tipo_lista_precio','inventario.producto',
    'inventario.existencia_bodega','inventario.movimiento_inventario','inventario.precio_lista'
  ] loop
    execute format('create policy compartida_todo on %s for all to authenticated
                    using ((select privado.usuario_actual_id()) is not null)
                    with check ((select privado.usuario_actual_id()) is not null)', t);
  end loop;
end $$;

-- Aviso de stock bajo: propio del usuario que lo recibe (igual que presupuesto.aviso_tarjeta_ciclo).
create policy propio_todo on inventario.aviso_stock_bajo for all to authenticated
  using (usuario_id = (select privado.usuario_actual_id()))
  with check (usuario_id = (select privado.usuario_actual_id()));

-- ---------------------------------------------------------------------
-- Multiempresa (igual que 09_empresas.sql): empresa_id + política restrictiva.
-- Tablas nuevas y vacías: el default puede apuntar directo a la empresa de
-- quien inserta, sin el paso intermedio "default 1" que usó 09 (ahí ya
-- había datos existentes que debían quedar en la empresa Principal).
-- ---------------------------------------------------------------------
do $$
declare t record;
begin
  for t in
    select table_schema, table_name from information_schema.tables
    where table_type = 'BASE TABLE' and table_schema = 'inventario'
  loop
    execute format('alter table %I.%I add column empresa_id bigint not null default privado.empresa_actual_id() references seguridad.empresa(id)',
                   t.table_schema, t.table_name);
    execute format('create index %I on %I.%I (empresa_id)',
                   left(t.table_name || '_empresa_id_ix', 63), t.table_schema, t.table_name);
    execute format(
      'create policy solo_mi_empresa on %I.%I as restrictive for all to authenticated
         using (empresa_id = (select privado.empresa_actual_id()))
         with check (empresa_id = (select privado.empresa_actual_id()))',
      t.table_schema, t.table_name);
  end loop;
end $$;

-- Claves únicas por empresa (igual que proyecto/rol/permiso en 09_empresas.sql).
create unique index bodega_empresa_clave_uk            on inventario.bodega (empresa_id, clave);
create unique index categoria_producto_empresa_clave_uk on inventario.categoria_producto (empresa_id, clave);
create unique index unidad_medida_empresa_clave_uk      on inventario.unidad_medida (empresa_id, clave);
create unique index tipo_lista_precio_empresa_clave_uk  on inventario.tipo_lista_precio (empresa_id, clave);

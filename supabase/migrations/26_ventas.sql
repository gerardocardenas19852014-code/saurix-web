-- =====================================================================
-- Saurix · Supabase · 26 Ventas
--  - Esquema ventas: catálogo de régimen fiscal, clientes (con puntos de
--    lealtad acumulados), turnos de caja (+ conteo por denominación),
--    ventas (+ renglones y pagos), devoluciones (+ renglones),
--    cotizaciones (+ renglones), ventas a crédito (cuentas por cobrar +
--    abonos), comisiones de vendedores, configuración de ventas y
--    configuración/bitácora del programa de lealtad.
--  - Mismo patrón que los demás módulos (ver 01_esquema.sql / 02_seguridad_rls.sql /
--    09_empresas.sql / 14_inventario.sql): auditoría automática, índices en
--    FK, permisos de rol, RLS y multiempresa (empresa_id + política
--    restrictiva solo_mi_empresa).
--  - Todas las tablas son "compartidas" dentro de la empresa (como
--    inventario/proyectos: cualquier usuario activo y vigente puede todo) —
--    Ventas, igual que Comercio/Proyectos, es un módulo de equipo, no
--    personal por usuario.
--  - venta_item.producto_id y devolucion_item.producto_id son NULL-ables
--    ("venta simple" sin producto, ver esquema-tablas-saurix.md).
-- =====================================================================
set check_function_bodies = off;

create schema if not exists ventas;

-- ---------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------
create table ventas.regimen_fiscal (
  id     bigint generated always as identity primary key,
  clave  text not null,
  nombre text not null
);

create table ventas.cliente (
  id                            bigint generated always as identity primary key,
  nombre                        text not null,
  rfc                           text,
  es_extranjero                 boolean not null default false,
  regimen_fiscal_clave          text,
  pais                          text,
  codigo_postal                 text,
  colonia                       text,
  calle                         text,
  numero_exterior               text,
  numero_interior               text,
  estado                        text,
  municipio                     text,
  localidad                     text,
  correo                        text,
  telefono                      text,
  lista_precio_predeterminada_id bigint references inventario.tipo_lista_precio(id) on delete set null,
  es_generico                   boolean not null default false,
  puntos_acumulados             integer not null default 0
);

create table ventas.turno_caja (
  id                     bigint generated always as identity primary key,
  usuario_id             bigint not null references seguridad.usuario(id),
  fecha_apertura         timestamptz not null default now(),
  monto_apertura         numeric(14,2) not null default 0,
  notas_apertura         text,
  fecha_cierre           timestamptz,
  monto_cierre_contado   numeric(14,2),
  monto_cierre_esperado  numeric(14,2),
  diferencia_cierre      numeric(14,2),
  notas_cierre           text,
  estado                 text not null default 'Abierto' check (estado in ('Abierto','Cerrado'))
);

create table ventas.venta (
  id                   bigint generated always as identity primary key,
  folio                text not null,
  fecha                timestamptz not null default now(),
  turno_caja_id        bigint not null references ventas.turno_caja(id),
  cliente_id           bigint not null references ventas.cliente(id),
  vendedor_usuario_id  bigint references seguridad.usuario(id),
  subtotal             numeric(14,2) not null default 0,
  descuento            numeric(14,2) not null default 0,
  total                numeric(14,2) not null default 0,
  estado               text not null default 'Completada' check (estado in ('Completada','Cancelada')),
  notas                text
);

create table ventas.venta_item (
  id               bigint generated always as identity primary key,
  venta_id         bigint not null references ventas.venta(id) on delete cascade,
  producto_id      bigint references inventario.producto(id) on delete set null,
  descripcion      text not null,
  cantidad         numeric(14,2) not null default 1,
  precio_unitario  numeric(14,2) not null default 0,
  descuento_pct    numeric(5,2) not null default 0,
  subtotal         numeric(14,2) not null default 0,
  bodega_id        bigint references inventario.bodega(id) on delete set null
);

create table ventas.venta_pago (
  id              bigint generated always as identity primary key,
  venta_id        bigint not null references ventas.venta(id) on delete cascade,
  metodo_pago     text not null,
  monto           numeric(14,2) not null default 0,
  monto_recibido  numeric(14,2),
  cambio          numeric(14,2)
);

create table ventas.devolucion (
  id                 bigint generated always as identity primary key,
  folio              text not null,
  venta_id           bigint not null references ventas.venta(id),
  fecha              timestamptz not null default now(),
  usuario_id         bigint references seguridad.usuario(id),
  motivo             text,
  total_reembolsado  numeric(14,2) not null default 0
);

create table ventas.devolucion_item (
  id              bigint generated always as identity primary key,
  devolucion_id   bigint not null references ventas.devolucion(id) on delete cascade,
  venta_item_id   bigint not null references ventas.venta_item(id),
  producto_id     bigint references inventario.producto(id) on delete set null,
  descripcion     text not null,
  cantidad        numeric(14,2) not null default 1,
  precio_unitario numeric(14,2) not null default 0,
  subtotal        numeric(14,2) not null default 0,
  bodega_id       bigint references inventario.bodega(id) on delete set null
);

create table ventas.cotizacion (
  id                   bigint generated always as identity primary key,
  folio                text not null,
  fecha                timestamptz not null default now(),
  fecha_vigencia       date,
  cliente_id           bigint not null references ventas.cliente(id),
  vendedor_usuario_id  bigint references seguridad.usuario(id),
  subtotal             numeric(14,2) not null default 0,
  descuento            numeric(14,2) not null default 0,
  total                numeric(14,2) not null default 0,
  estado               text not null default 'Pendiente' check (estado in ('Pendiente','Convertida','Vencida','Cancelada')),
  notas                text,
  venta_convertida_id  bigint references ventas.venta(id) on delete set null
);

create table ventas.cotizacion_item (
  id              bigint generated always as identity primary key,
  cotizacion_id   bigint not null references ventas.cotizacion(id) on delete cascade,
  producto_id     bigint references inventario.producto(id) on delete set null,
  descripcion     text not null,
  cantidad        numeric(14,2) not null default 1,
  precio_unitario numeric(14,2) not null default 0,
  descuento_pct   numeric(5,2) not null default 0,
  subtotal        numeric(14,2) not null default 0
);

create table ventas.configuracion_ventas (
  id                            bigint generated always as identity primary key,
  conteo_caja_por_denominacion  boolean not null default false
);

create table ventas.turno_caja_denominacion (
  id             bigint generated always as identity primary key,
  turno_caja_id  bigint not null references ventas.turno_caja(id) on delete cascade,
  momento        text not null check (momento in ('Apertura','Cierre')),
  valor          numeric(10,2) not null,
  cantidad       integer not null default 0
);

create table ventas.cuenta_por_cobrar (
  id               bigint generated always as identity primary key,
  venta_id         bigint not null references ventas.venta(id),
  cliente_id       bigint not null references ventas.cliente(id),
  fecha            timestamptz not null default now(),
  monto_original   numeric(14,2) not null default 0,
  saldo_pendiente  numeric(14,2) not null default 0,
  estado           text not null default 'Pendiente' check (estado in ('Pendiente','Pagada'))
);

create table ventas.abono_cuenta_por_cobrar (
  id                    bigint generated always as identity primary key,
  cuenta_por_cobrar_id  bigint not null references ventas.cuenta_por_cobrar(id) on delete cascade,
  fecha                 timestamptz not null default now(),
  monto                 numeric(14,2) not null default 0,
  metodo_pago           text not null,
  turno_caja_id         bigint references ventas.turno_caja(id),
  usuario_id            bigint references seguridad.usuario(id),
  notas                 text
);

create table ventas.comision_vendedor (
  id          bigint generated always as identity primary key,
  usuario_id  bigint not null references seguridad.usuario(id),
  tipo        text not null check (tipo in ('Porcentaje','MontoFijo')),
  valor       numeric(14,2) not null default 0
);

create table ventas.configuracion_lealtad (
  id                          bigint generated always as identity primary key,
  programa_activo             boolean not null default false,
  pesos_por_punto             numeric(10,2) not null default 0,
  pesos_descuento_por_punto   numeric(10,2) not null default 0
);

create table ventas.movimiento_puntos_cliente (
  id          bigint generated always as identity primary key,
  cliente_id  bigint not null references ventas.cliente(id) on delete cascade,
  fecha       timestamptz not null default now(),
  puntos      integer not null default 0,
  tipo        text not null check (tipo in ('Ganado','Canjeado','Reversado')),
  venta_id    bigint references ventas.venta(id) on delete set null
);

-- ---------------------------------------------------------------------
-- Columnas de auditoría + trigger (igual que 02_seguridad_rls.sql §2)
-- ---------------------------------------------------------------------
do $$
declare t record;
begin
  for t in
    select table_schema, table_name from information_schema.tables
    where table_type = 'BASE TABLE' and table_schema = 'ventas'
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
      and n.nspname = 'ventas'
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
revoke all on all tables in schema ventas from anon;
grant usage on schema ventas to authenticated, service_role;
grant select, insert, update, delete on all tables in schema ventas to authenticated;
grant all on all tables in schema ventas to service_role;
grant usage, select on all sequences in schema ventas to authenticated, service_role;
alter default privileges in schema ventas grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema ventas grant all on tables to service_role;
alter default privileges in schema ventas grant usage, select on sequences to authenticated, service_role;

-- ---------------------------------------------------------------------
-- RLS (igual que §5)
-- ---------------------------------------------------------------------
do $$
declare t record;
begin
  for t in
    select table_schema, table_name from information_schema.tables
    where table_type = 'BASE TABLE' and table_schema = 'ventas'
  loop
    execute format('alter table %I.%I enable row level security', t.table_schema, t.table_name);
  end loop;
end $$;

-- Ventas es un módulo de equipo (como inventario/proyectos): cualquier
-- usuario activo y vigente puede todo en las 17 tablas.
do $$
declare t text;
begin
  foreach t in array array[
    'ventas.regimen_fiscal','ventas.cliente','ventas.turno_caja','ventas.venta',
    'ventas.venta_item','ventas.venta_pago','ventas.devolucion','ventas.devolucion_item',
    'ventas.cotizacion','ventas.cotizacion_item','ventas.configuracion_ventas',
    'ventas.turno_caja_denominacion','ventas.cuenta_por_cobrar','ventas.abono_cuenta_por_cobrar',
    'ventas.comision_vendedor','ventas.configuracion_lealtad','ventas.movimiento_puntos_cliente'
  ] loop
    execute format('create policy compartida_todo on %s for all to authenticated
                    using ((select privado.usuario_actual_id()) is not null)
                    with check ((select privado.usuario_actual_id()) is not null)', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Multiempresa (igual que 09_empresas.sql / 14_inventario.sql): empresa_id
-- + política restrictiva. Tablas nuevas y vacías: el default puede apuntar
-- directo a la empresa de quien inserta.
-- ---------------------------------------------------------------------
do $$
declare t record;
begin
  for t in
    select table_schema, table_name from information_schema.tables
    where table_type = 'BASE TABLE' and table_schema = 'ventas'
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

-- Claves únicas por empresa (igual que bodega/categoria_producto en 14_inventario.sql).
create unique index regimen_fiscal_empresa_clave_uk on ventas.regimen_fiscal (empresa_id, clave);

-- Configuración singleton por empresa (igual que configuracion_apariencia 1-1,
-- aquí 1-1 con la empresa en vez de con el usuario).
create unique index configuracion_ventas_empresa_uk   on ventas.configuracion_ventas (empresa_id);
create unique index configuracion_lealtad_empresa_uk  on ventas.configuracion_lealtad (empresa_id);

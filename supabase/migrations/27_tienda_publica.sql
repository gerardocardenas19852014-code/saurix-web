-- =====================================================================
-- Saurix · Supabase · 27 Tienda pública
--  - Catálogo público por empresa (clave) para que un cliente SIN cuenta
--    arme su pedido y lo envíe por WhatsApp/correo — la empresa lo
--    valida y lo captura manualmente en Ventas (Cobro) después, fuera
--    de este flujo. No hay persistencia de pedido, pago ni reserva de
--    stock: solo lectura pública de catálogo.
--  - seguridad.empresa: nuevos campos para activar/describir su tienda.
--  - inventario.producto_opcion_grupo / producto_opcion_valor: variantes
--    con costo adicional (p.ej. sabor), al estilo combo de cine.
--  - ventas.venta.canal: texto libre (no catálogo cerrado) para marcar de
--    dónde vino la venta cuando la empresa la captura manualmente.
--  - Acceso anónimo: SOLO dos funciones RPC security definer en
--    seguridad (ya expuesto vía API — mismo esquema que email_para_login,
--    así no se necesita tocar "Exposed schemas" en el dashboard). anon
--    sigue sin ningún privilegio sobre tablas, ni de inventario ni de
--    seguridad.
-- =====================================================================
set check_function_bodies = off;

-- ---------------------------------------------------------------------
-- 1) seguridad.empresa: datos de la tienda pública
-- ---------------------------------------------------------------------
alter table seguridad.empresa
  add column descripcion_publica     text,
  add column telefono_pedidos        text,
  add column correo_pedidos          text,
  add column logo_publico            text,
  add column catalogo_publico_activo boolean not null default false;

-- ---------------------------------------------------------------------
-- 2) ventas.venta.canal: abierto a propósito (ver discusión con el
--    usuario: "sería dejarlo abierto") — no es un catálogo cerrado
--    porque a futuro puede haber más canales que no queremos migrar.
-- ---------------------------------------------------------------------
alter table ventas.venta add column canal text;

-- ---------------------------------------------------------------------
-- 3) inventario.producto_opcion_grupo / producto_opcion_valor
-- ---------------------------------------------------------------------
create table inventario.producto_opcion_grupo (
  id             bigint generated always as identity primary key,
  producto_id    bigint not null references inventario.producto(id) on delete cascade,
  nombre         text not null,
  tipo_seleccion text not null default 'unica' check (tipo_seleccion in ('unica','multiple')),
  requerido      boolean not null default true,
  minimo         integer not null default 1,
  maximo         integer not null default 1,
  orden          integer not null default 0
);

create table inventario.producto_opcion_valor (
  id               bigint generated always as identity primary key,
  grupo_id         bigint not null references inventario.producto_opcion_grupo(id) on delete cascade,
  nombre           text not null,
  precio_adicional numeric(14,2) not null default 0,
  orden            integer not null default 0
);

-- Auditoría (igual que 02_seguridad_rls.sql §2 — aquí explícito, solo
-- estas 2 tablas nuevas, para no re-ejecutar el loop sobre todo el
-- esquema inventario y chocar con triggers/policies que ya existen).
alter table inventario.producto_opcion_grupo
  add column fecha_creacion     timestamptz not null default now(),
  add column fecha_modificacion timestamptz,
  add column creado_por         bigint,
  add column modificado_por     bigint,
  add column activo             boolean not null default true;
create trigger trg_auditoria before insert or update on inventario.producto_opcion_grupo
  for each row execute function privado.auditoria();

alter table inventario.producto_opcion_valor
  add column fecha_creacion     timestamptz not null default now(),
  add column fecha_modificacion timestamptz,
  add column creado_por         bigint,
  add column modificado_por     bigint,
  add column activo             boolean not null default true;
create trigger trg_auditoria before insert or update on inventario.producto_opcion_valor
  for each row execute function privado.auditoria();

-- Índices en FK.
create index producto_opcion_grupo_producto_id_ix on inventario.producto_opcion_grupo (producto_id);
create index producto_opcion_valor_grupo_id_ix     on inventario.producto_opcion_valor (grupo_id);

-- Permisos de rol (igual que §4 — anon sigue sin nada aquí).
grant select, insert, update, delete on inventario.producto_opcion_grupo, inventario.producto_opcion_valor to authenticated;
grant all on inventario.producto_opcion_grupo, inventario.producto_opcion_valor to service_role;
grant usage, select on all sequences in schema inventario to authenticated, service_role;

-- RLS (igual que §5).
alter table inventario.producto_opcion_grupo enable row level security;
alter table inventario.producto_opcion_valor enable row level security;

create policy compartida_todo on inventario.producto_opcion_grupo for all to authenticated
  using ((select privado.usuario_actual_id()) is not null)
  with check ((select privado.usuario_actual_id()) is not null);
create policy compartida_todo on inventario.producto_opcion_valor for all to authenticated
  using ((select privado.usuario_actual_id()) is not null)
  with check ((select privado.usuario_actual_id()) is not null);

-- Multiempresa (igual que 09_empresas.sql).
alter table inventario.producto_opcion_grupo
  add column empresa_id bigint not null default privado.empresa_actual_id() references seguridad.empresa(id);
create index producto_opcion_grupo_empresa_id_ix on inventario.producto_opcion_grupo (empresa_id);
create policy solo_mi_empresa on inventario.producto_opcion_grupo as restrictive for all to authenticated
  using (empresa_id = (select privado.empresa_actual_id()))
  with check (empresa_id = (select privado.empresa_actual_id()));

alter table inventario.producto_opcion_valor
  add column empresa_id bigint not null default privado.empresa_actual_id() references seguridad.empresa(id);
create index producto_opcion_valor_empresa_id_ix on inventario.producto_opcion_valor (empresa_id);
create policy solo_mi_empresa on inventario.producto_opcion_valor as restrictive for all to authenticated
  using (empresa_id = (select privado.empresa_actual_id()))
  with check (empresa_id = (select privado.empresa_actual_id()));

-- ---------------------------------------------------------------------
-- 4) RPC públicas (anon) — las ÚNICAS dos funciones que anon puede
--    ejecutar en todo el sistema además de email_para_login. Ambas son
--    security definer + search_path vacío (mismo patrón que
--    05_login_semillas.sql) y filtran explícitamente por empresa_id, sin
--    exponer ninguna tabla directamente. seguridad ya está en "Exposed
--    schemas" (ahí vive email_para_login), así que no se necesita tocar
--    nada en el dashboard de Supabase para esto.
-- ---------------------------------------------------------------------

-- 4a) Lista de tiendas activas, para el portal /tienda.
create or replace function seguridad.tiendas_activas()
returns table (clave text, nombre text, descripcion text, logo text)
language sql
stable
security definer
set search_path = ''
as $$
  select e.clave, e.nombre, e.descripcion_publica, e.logo_publico
  from seguridad.empresa e
  where e.activo and e.catalogo_publico_activo
  order by e.nombre
$$;

revoke all on function seguridad.tiendas_activas() from public;
grant execute on function seguridad.tiendas_activas() to anon;

-- 4b) Catálogo completo de una tienda (datos de la empresa + productos +
--     sus grupos/valores de opciones), para /tienda/:clave. Devuelve
--     null si la clave no existe, está inactiva o no tiene catálogo
--     público activado.
create or replace function seguridad.tienda_detalle(p_clave text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_empresa record;
  v_resultado jsonb;
begin
  select e.id, e.clave, e.nombre, e.descripcion_publica, e.telefono_pedidos, e.correo_pedidos, e.logo_publico
    into v_empresa
    from seguridad.empresa e
    where e.clave = lower(trim(p_clave)) and e.activo and e.catalogo_publico_activo
    limit 1;

  if v_empresa.id is null then
    return null;
  end if;

  select jsonb_build_object(
    'empresa', jsonb_build_object(
      'clave', v_empresa.clave,
      'nombre', v_empresa.nombre,
      'descripcion', v_empresa.descripcion_publica,
      'telefono', v_empresa.telefono_pedidos,
      'correo', v_empresa.correo_pedidos,
      'logo', v_empresa.logo_publico
    ),
    'productos', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', pr.id,
          'nombre', pr.nombre,
          'descripcion', pr.descripcion,
          'precio', pr.precio_unitario,
          'foto', pr.foto,
          'disponible', (pr.existencia is null or pr.existencia > 0),
          'opciones', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', g.id,
                'nombre', g.nombre,
                'tipoSeleccion', g.tipo_seleccion,
                'requerido', g.requerido,
                'minimo', g.minimo,
                'maximo', g.maximo,
                'valores', coalesce((
                  select jsonb_agg(
                    jsonb_build_object('id', v.id, 'nombre', v.nombre, 'precioAdicional', v.precio_adicional)
                    order by v.orden, v.id
                  )
                  from inventario.producto_opcion_valor v
                  where v.grupo_id = g.id and v.activo
                ), '[]'::jsonb)
              )
              order by g.orden, g.id
            )
            from inventario.producto_opcion_grupo g
            where g.producto_id = pr.id and g.activo
          ), '[]'::jsonb)
        )
        order by pr.nombre
      ),
      '[]'::jsonb
    )
  )
  into v_resultado
  from inventario.producto pr
  where pr.empresa_id = v_empresa.id and pr.activo;

  return v_resultado;
end;
$$;

revoke all on function seguridad.tienda_detalle(text) from public;
grant execute on function seguridad.tienda_detalle(text) to anon;

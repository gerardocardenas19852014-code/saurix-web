-- =====================================================================
-- Saurix · Supabase · 30 Pedidos web (tienda pública → Ventas)
--  - La tienda pública (27_tienda_publica.sql) NO guarda el pedido: solo
--    arma el mensaje de WhatsApp. El cliente (Juan Gerardo) pidió poder
--    verlo también dentro de Ventas en vez de tener que volver a
--    teclearlo a mano cada vez.
--  - ventas.pedido_tienda: registro LIGERO de cada pedido enviado desde
--    /tienda — NO afecta inventario ni caja todavía (igual que
--    ventas.cotizacion). El staff lo revisa en una pantalla nueva
--    ("Pedidos web") y, si procede, lo "Confirma" — eso sí registra una
--    Venta real con VentaService.registrar() (mismo patrón que
--    CotizacionService.convertirAVenta()), o lo "Descarta" si no aplica.
--  - Insertado por una RPC anon nueva (seguridad.crear_pedido_tienda),
--    MISMO criterio que tiendas_activas()/tienda_detalle(): anon sigue
--    sin ningún privilegio directo sobre tablas, todo pasa por una
--    función security definer que filtra por empresa_id adentro.
-- =====================================================================
set check_function_bodies = off;

-- ---------------------------------------------------------------------
-- 1) ventas.pedido_tienda
-- ---------------------------------------------------------------------
create table ventas.pedido_tienda (
  id               bigint generated always as identity primary key,
  empresa_id       bigint not null references seguridad.empresa(id),
  nombre_cliente   text not null,
  telefono_cliente text not null,
  notas_cliente    text,
  ubicacion_lat    numeric,
  ubicacion_lng    numeric,
  -- Snapshot de las líneas del carrito al momento del pedido (misma forma
  -- que LineaCarritoTienda en tienda.model.ts): [{productoId, nombreProducto,
  -- precioBase, opcionesElegidas:[{grupoNombre,valorNombre,precioAdicional}], cantidad}].
  -- No hay tabla de renglones aparte (como cotizacion_item) porque esto es
  -- de solo lectura hasta que se confirma — ahí sí se arman VentaItem reales.
  items            jsonb not null,
  total            numeric(14,2) not null default 0,
  estado           text not null default 'Pendiente' check (estado in ('Pendiente','Confirmado','Descartado')),
  -- La Venta que resultó al confirmar — null mientras sigue Pendiente/Descartado.
  venta_id         bigint references ventas.venta(id) on delete set null
);

-- Auditoría (igual que producto_opcion_grupo en 27_tienda_publica.sql) —
-- creado_por queda NULL en el insert porque lo hace la RPC anon (sin
-- auth.uid()), y eso está bien: no hay usuario del sistema que lo creó.
alter table ventas.pedido_tienda
  add column fecha_creacion     timestamptz not null default now(),
  add column fecha_modificacion timestamptz,
  add column creado_por         bigint,
  add column modificado_por     bigint,
  add column activo             boolean not null default true;
create trigger trg_auditoria before insert or update on ventas.pedido_tienda
  for each row execute function privado.auditoria();

create index pedido_tienda_empresa_id_ix on ventas.pedido_tienda (empresa_id);
create index pedido_tienda_venta_id_ix on ventas.pedido_tienda (venta_id);

grant select, insert, update, delete on ventas.pedido_tienda to authenticated;
grant all on ventas.pedido_tienda to service_role;
grant usage, select on all sequences in schema ventas to authenticated, service_role;

alter table ventas.pedido_tienda enable row level security;

create policy compartida_todo on ventas.pedido_tienda for all to authenticated
  using ((select privado.usuario_actual_id()) is not null)
  with check ((select privado.usuario_actual_id()) is not null);

-- Multiempresa (igual que 09_empresas.sql) — SIN default
-- privado.empresa_actual_id(), a propósito: el insert real lo hace la RPC
-- de abajo, que ya resuelve y manda el empresa_id correcto de la tienda
-- (no de "quien está logueado", porque quien inserta es anon).
create policy solo_mi_empresa on ventas.pedido_tienda as restrictive for all to authenticated
  using (empresa_id = (select privado.empresa_actual_id()))
  with check (empresa_id = (select privado.empresa_actual_id()));

-- ---------------------------------------------------------------------
-- 2) RPC pública (anon) — tercera y última función que anon puede
--    ejecutar en todo el sistema (junto con tiendas_activas/tienda_detalle).
-- ---------------------------------------------------------------------
create or replace function seguridad.crear_pedido_tienda(
  p_clave    text,
  p_nombre   text,
  p_telefono text,
  p_notas    text,
  p_lat      numeric,
  p_lng      numeric,
  p_items    jsonb,
  p_total    numeric
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa_id bigint;
  v_id bigint;
begin
  select e.id into v_empresa_id
    from seguridad.empresa e
    where e.clave = lower(trim(p_clave)) and e.activo and e.catalogo_publico_activo
    limit 1;

  if v_empresa_id is null then
    raise exception 'Tienda no encontrada o inactiva.';
  end if;

  if coalesce(trim(p_nombre), '') = '' or coalesce(trim(p_telefono), '') = '' then
    raise exception 'Nombre y teléfono son obligatorios.';
  end if;

  insert into ventas.pedido_tienda
    (empresa_id, nombre_cliente, telefono_cliente, notas_cliente, ubicacion_lat, ubicacion_lng, items, total)
  values
    (v_empresa_id, trim(p_nombre), trim(p_telefono), nullif(trim(coalesce(p_notas, '')), ''), p_lat, p_lng, coalesce(p_items, '[]'::jsonb), coalesce(p_total, 0))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function seguridad.crear_pedido_tienda(text, text, text, text, numeric, numeric, jsonb, numeric) from public;
grant execute on function seguridad.crear_pedido_tienda(text, text, text, text, numeric, numeric, jsonb, numeric) to anon, authenticated;


-- Bloque A — Modo de funcionamiento de la tienda pública (sustituye
-- conceptualmente a catalogo_publico_acepta_pedidos por un selector de 3
-- estados). La columna booleana anterior se deja en la tabla (sin tocar,
-- sin seguir escribiéndose) para no requerir un DROP manual — ver nota en
-- el reporte final.
alter table seguridad.empresa
  add column if not exists modo_tienda text not null default 'pedidos_online';

alter table seguridad.empresa
  add constraint empresa_modo_tienda_check
  check (modo_tienda in ('menu_visual', 'menu_orden', 'pedidos_online'));

-- Migración compatible: ninguna empresa existente debe terminar en
-- 'menu_orden' automáticamente (ese modo solo se activa explícitamente).
update seguridad.empresa
set modo_tienda = case
  when catalogo_publico_acepta_pedidos then 'pedidos_online'
  else 'menu_visual'
end;

comment on column seguridad.empresa.catalogo_publico_acepta_pedidos is
  'Deprecada desde el modo de funcionamiento de 3 estados (ver modo_tienda). Ya no se lee ni se escribe desde la aplicación; se conserva solo por no requerir un DROP manual.';

comment on column seguridad.empresa.modo_tienda is
  'Modo de funcionamiento de la tienda pública: menu_visual (solo consulta), menu_orden (Menú + Mi orden, folio/QR en caja, no es venta), pedidos_online (flujo completo actual de carrito/entrega).';

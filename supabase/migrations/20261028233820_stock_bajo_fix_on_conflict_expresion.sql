
-- Corrección: aviso_stock_bajo_producto_bodega_usuario_dia_uk es un ÍNDICE
-- único con expresión (CREATE UNIQUE INDEX ... (producto_id, usuario_id,
-- dia, COALESCE(bodega_id,0::bigint))), NO un CONSTRAINT con nombre — por
-- eso "ON CONFLICT ON CONSTRAINT" fallaba. ON CONFLICT debe repetir la
-- misma expresión del índice, no el nombre de un constraint inexistente.
create or replace function inventario.fn_generar_avisos_stock_bajo(
  p_producto_id bigint,
  p_bodega_id bigint,
  p_existencia numeric,
  p_nivel_minimo numeric
)
returns table (usuario_id bigint)
language sql
security definer
set search_path = ''
as $$
  with destino as (
    select pr.id as producto_id, pr.nombre as producto_nombre, pr.empresa_id
    from inventario.producto pr
    where pr.id = p_producto_id
  ),
  insertados as (
    insert into inventario.aviso_stock_bajo (producto_id, bodega_id, usuario_id, dia, empresa_id)
    select d.producto_id, p_bodega_id, ad.usuario_id, current_date, d.empresa_id
    from destino d
    join inventario.alerta_stock_destinatario ad
      on ad.empresa_id = d.empresa_id and ad.activo
    on conflict (producto_id, usuario_id, dia, (coalesce(bodega_id, 0::bigint))) do nothing
    returning usuario_id, empresa_id
  )
  insert into seguridad.notificacion (usuario_id, titulo, link, leida, empresa_id, creado_por)
  select
    i.usuario_id,
    '📉 "' || d.producto_nombre || '" tiene ' || p_existencia || ' de existencia, por debajo de su mínimo (' || p_nivel_minimo || ').',
    '/inventario/valor-stock',
    false,
    i.empresa_id,
    i.usuario_id
  from insertados i
  join destino d on true
  returning usuario_id;
$$;

revoke all on function inventario.fn_generar_avisos_stock_bajo(bigint, bigint, numeric, numeric) from public, anon, authenticated;

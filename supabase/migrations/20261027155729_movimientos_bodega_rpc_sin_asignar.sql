
-- Pestaña "Existencia por bodega": bloque informativo de productos con
-- existencia heredada (de antes de este módulo) que todavía no se asignó a
-- ninguna bodega — antes se calculaba en Angular comparando el catálogo
-- completo de productos contra existencia_bodega en memoria; ahora es
-- server-side (NOT EXISTS usa el índice existencia_bodega_empresa_producto_ix).
create or replace function inventario.fn_movimientos_productos_sin_asignar(
  p_desde int default 0,
  p_cantidad int default 100
)
returns table (
  id bigint,
  codigo text,
  nombre text,
  existencia numeric,
  total bigint
)
language sql
stable
set search_path = ''
as $$
  select
    p.id,
    p.codigo,
    p.nombre,
    p.existencia,
    count(*) over() as total
  from inventario.producto p
  where p.activo = true
    and p.existencia is not null
    and p.existencia > 0
    and not exists (
      select 1 from inventario.existencia_bodega e where e.producto_id = p.id
    )
  order by p.nombre asc
  offset greatest(0, p_desde)
  limit greatest(1, p_cantidad);
$$;

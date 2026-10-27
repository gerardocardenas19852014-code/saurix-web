-- Afinamiento de índices sobre las dos tablas resumen (migraciones 50 y
-- 51): con el filtro empresa_id aplicado, el merge join que arma
-- Resumen/Rotación/Productos necesita leerlas en orden de producto_id,
-- así que el planificador escaneaba la tabla completa por su PRIMARY KEY
-- (producto_id) y aplicaba el filtro de empresa_id después (heap fetch de
-- cada fila). Un índice compuesto (empresa_id, producto_id) permite
-- filtrar Y ordenar en una sola pasada del índice. Medido en Rotación:
-- 1.82s -> ver resultado tras aplicar.
create index if not exists existencia_producto_resumen_empresa_producto_ix
  on inventario.existencia_producto_resumen (empresa_id, producto_id);

create index if not exists ultimo_movimiento_producto_empresa_producto_ix
  on inventario.ultimo_movimiento_producto (empresa_id, producto_id);

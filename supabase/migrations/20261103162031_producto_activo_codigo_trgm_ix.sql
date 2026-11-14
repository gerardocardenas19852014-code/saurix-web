-- Bloque "eliminar 8 cargas" de Cobro (2026-11): la búsqueda nueva de
-- Cobro (listarPagina + FILTRO_BUSQUEDA) hace UN solo OR sobre nombre Y
-- código, para productos Y servicios (activo = true, sin filtrar por
-- existencia). Ya existe producto_activo_nombre_trgm_ix (gin trgm sobre
-- nombre WHERE activo) pero el único índice trigram de código que había
-- es producto_valor_stock_codigo_trgm_ix, con WHERE existencia IS NOT
-- NULL — a propósito, porque esa es para Valor de stock (solo productos
-- físicos). Para Cobro, un servicio con código también debe poder
-- encontrarse por código sin recurrir a un seq scan. Mismo patrón exacto
-- que el índice de nombre, nunca duplicado (condición distinta:
-- "activo" en vez de "existencia IS NOT NULL").
create index if not exists producto_activo_codigo_trgm_ix
  on inventario.producto using gin (codigo gin_trgm_ops)
  where (activo = true);
-- Antes de este índice, cualquier consulta paginada contra Producto
-- filtrada por empresa + activo (el caso normal de "Productos y
-- servicios", ver productos.component.ts) hacía un Seq Scan completo de
-- la tabla para el count(*) exacto que pide listarPagina() — confirmado
-- con EXPLAIN ANALYZE: ~260-330ms de Seq Scan sobre 200,013 filas, en
-- cada carga de página, aunque solo se pidieran 10 renglones. Con el
-- catálogo creciendo a cientos de miles de productos (prueba de
-- rendimiento), eso era el principal responsable del LCP "needs
-- improvement" (2.6-3.1s, elemento LCP: una celda <td> de la tabla,
-- esperando esta misma consulta).
--
-- Índice compuesto (empresa_id, activo, id): cubre exactamente el filtro
-- {empresa_id, activo} de la política RLS "solo_mi_empresa" + el filtro
-- de pantalla {activo} + el ORDER BY id de listarPagina(), permitiendo un
-- Index Scan (o Index Only Scan) en vez de recorrer la tabla completa —
-- tanto para el count(*) exacto como para traer la página pedida.
create index producto_empresa_activo_id_ix
  on inventario.producto (empresa_id, activo, id);

comment on index inventario.producto_empresa_activo_id_ix is
  'Cubre el filtro {empresa_id, activo} (RLS solo_mi_empresa + pantalla Productos) + ORDER BY id de listarPagina() — evita Seq Scan en el count(*) exacto y en la página pedida contra un catálogo grande.';

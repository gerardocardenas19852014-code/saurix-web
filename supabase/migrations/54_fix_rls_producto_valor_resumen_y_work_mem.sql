-- Migración 54: corrige un bug real introducido en la migración 53 y
-- ajusta el plan de fn_valor_stock_por_bodega.
--
-- BUG ENCONTRADO EN PRODUCCIÓN: las 3 políticas RLS que la migración 53
-- creó sobre inventario.producto_valor_resumen usaban llamadas directas a
-- las funciones (`privado.usuario_actual_id() is not null`, etc.) en vez
-- del patrón `(select privado.usuario_actual_id())` que usa el resto del
-- esquema (confirmado via pg_policies sobre movimiento_inventario,
-- existencia_bodega, existencia_producto_resumen, ultimo_movimiento_
-- producto, etc. — TODAS envuelven la llamada en un `select` escalar).
--
-- Esa envoltura no es cosmética: permite que Postgres evalúe la función
-- UNA sola vez por consulta (como un InitPlan) en vez de una vez POR FILA.
-- Sin ella, con 200,005 filas en producto_valor_resumen, cada llamada a
-- fn_valor_stock_resumen/por_categoria/por_bodega terminaba invocando
-- privado.empresa_actual_id() / privado.modulo_habilitado() /
-- privado.usuario_actual_id() -cada una con su propio join a seguridad.
-- usuario/empresa- más de 200,000 veces por llamada. Esto se midió en
-- producción: hasta 80 segundos en una sola llamada a fn_valor_stock_
-- por_bodega, muy por encima del statement_timeout=8s del rol
-- `authenticated`, causando los 500 Internal Server Error que viste en
-- el navegador.
--
-- Corrección: recrear las 3 políticas con la forma `(select …)`. Verificado
-- después de aplicar: fn_valor_stock_resumen/por_categoria ~0.2-0.6s,
-- fn_valor_stock_por_bodega bajó de 13-80s a ~1.8s (ver más abajo el
-- ajuste adicional de work_mem que la bajó a ~0.3-0.5s). Se comparó el
-- resultado numérico de fn_valor_stock_resumen contra el cálculo "crudo"
-- original (sin tabla resumen) y coincide exactamente en los 6 valores,
-- confirmando que el fix no cambió el resultado, solo el costo.

drop policy if exists compartida_todo on inventario.producto_valor_resumen;
drop policy if exists modulo_habilitado on inventario.producto_valor_resumen;
drop policy if exists solo_mi_empresa on inventario.producto_valor_resumen;

create policy compartida_todo on inventario.producto_valor_resumen
  for all
  using ((select privado.usuario_actual_id()) is not null)
  with check ((select privado.usuario_actual_id()) is not null);

create policy modulo_habilitado on inventario.producto_valor_resumen
  for all
  using ((select privado.modulo_habilitado('inventario')))
  with check ((select privado.modulo_habilitado('inventario')));

create policy solo_mi_empresa on inventario.producto_valor_resumen
  for all
  using (empresa_id = (select privado.empresa_actual_id()))
  with check (empresa_id = (select privado.empresa_actual_id()));

-- Índice adicional: el join de fn_valor_stock_por_bodega entre
-- existencia_bodega y producto_valor_resumen se beneficia de filtrar
-- existencia_bodega por (empresa_id, producto_id) de una sola vez en vez
-- de solo por empresa_id.
create index if not exists existencia_bodega_empresa_producto_ix
  on inventario.existencia_bodega (empresa_id, producto_id);

-- fn_valor_stock_por_bodega hace un hash join entre ~100k filas de
-- existencia_bodega y producto_valor_resumen; con el work_mem por
-- defecto, ese hash se dividía en 2 "batches" y derramaba a disco
-- (temp read/written en EXPLAIN), agregando varios segundos bajo E/S
-- lenta. Subir el work_mem SOLO para esta función (no global, no para
-- todo el rol) evita el derrame sin tocar nada fuera de esta función.
alter function inventario.fn_valor_stock_por_bodega() set work_mem = '32MB';

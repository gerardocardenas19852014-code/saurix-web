-- Corrección de aislamiento multiempresa (hallazgo CRÍTICO #1 de la auditoría
-- general prelanzamiento, claude/saurix-auditoria-general-prelanzamiento-2026-11.md).
--
-- BUG: inventario.existencia_producto_resumen, inventario.producto_valor_resumen
-- e inventario.ultimo_movimiento_producto tienen 3 políticas cada una
-- (compartida_todo, modulo_habilitado, solo_mi_empresa), pero las tres quedaron
-- creadas como PERMISSIVE (confirmado: la migración 54_fix_rls_producto_valor_
-- resumen_y_work_mem.sql recreó las 3 políticas de producto_valor_resumen sin
-- la palabra clave "as restrictive" al corregir el rendimiento del InitPlan;
-- existencia_producto_resumen y ultimo_movimiento_producto perdieron la misma
-- palabra clave en una migración equivalente de esa misma serie de finales de
-- octubre). Como las políticas PERMISSIVE se combinan con OR, "compartida_todo"
-- (verdadera para cualquier usuario autenticado activo, sin filtrar por
-- empresa) basta por sí sola para dar acceso de lectura y escritura a
-- CUALQUIER empresa sobre estas 3 tablas — confirmado explotable directamente
-- vía la API REST, sin pasar por ninguna función.
--
-- CORRECCIÓN: recrear "modulo_habilitado" y "solo_mi_empresa" como RESTRICTIVE
-- en las 3 tablas — exactamente el mismo patrón que ya usa correctamente
-- inventario.producto (compartida_todo PERMISSIVE + modulo_habilitado y
-- solo_mi_empresa RESTRICTIVE, combinadas con AND). No se toca la política
-- "compartida_todo" de ninguna tabla, ni ninguna otra tabla, columna, función
-- o trigger. Se preserva exactamente la misma expresión USING/WITH CHECK que
-- ya tenían (confirmado por lectura previa de pg_policies), solo se agrega la
-- palabra clave que faltaba.
--
-- Verificado antes de escribir esta migración que esto no rompe las escrituras
-- legítimas: las únicas funciones que escriben en estas 3 tablas
-- (fn_actualizar_existencia_producto_resumen, fn_actualizar_ultimo_movimiento_
-- producto, fn_recalcular_producto_valor_resumen vía sus triggers) son
-- SECURITY INVOKER y siempre usan el empresa_id de la fila origen (producto/
-- existencia_bodega/movimiento_inventario), que ya está protegida por su
-- propia política RESTRICTIVE solo_mi_empresa — por lo tanto ese empresa_id
-- siempre coincide con la empresa del usuario que disparó la operación.

-- inventario.existencia_producto_resumen
drop policy if exists modulo_habilitado on inventario.existencia_producto_resumen;
create policy modulo_habilitado on inventario.existencia_producto_resumen
  as restrictive
  for all
  using ((select privado.modulo_habilitado('inventario')))
  with check ((select privado.modulo_habilitado('inventario')));

drop policy if exists solo_mi_empresa on inventario.existencia_producto_resumen;
create policy solo_mi_empresa on inventario.existencia_producto_resumen
  as restrictive
  for all
  using (empresa_id = (select privado.empresa_actual_id()))
  with check (empresa_id = (select privado.empresa_actual_id()));

-- inventario.producto_valor_resumen
drop policy if exists modulo_habilitado on inventario.producto_valor_resumen;
create policy modulo_habilitado on inventario.producto_valor_resumen
  as restrictive
  for all
  using ((select privado.modulo_habilitado('inventario')))
  with check ((select privado.modulo_habilitado('inventario')));

drop policy if exists solo_mi_empresa on inventario.producto_valor_resumen;
create policy solo_mi_empresa on inventario.producto_valor_resumen
  as restrictive
  for all
  using (empresa_id = (select privado.empresa_actual_id()))
  with check (empresa_id = (select privado.empresa_actual_id()));

-- inventario.ultimo_movimiento_producto
drop policy if exists modulo_habilitado on inventario.ultimo_movimiento_producto;
create policy modulo_habilitado on inventario.ultimo_movimiento_producto
  as restrictive
  for all
  using ((select privado.modulo_habilitado('inventario')))
  with check ((select privado.modulo_habilitado('inventario')));

drop policy if exists solo_mi_empresa on inventario.ultimo_movimiento_producto;
create policy solo_mi_empresa on inventario.ultimo_movimiento_producto
  as restrictive
  for all
  using (empresa_id = (select privado.empresa_actual_id()))
  with check (empresa_id = (select privado.empresa_actual_id()));

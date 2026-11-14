-- Lookup EXACTO por código para el escáner de Cobro (Bloque "eliminar 8
-- cargas", 2026-11). Mismo patrón exacto que ya existe en
-- inventario.fn_ordenes_compra_producto_por_codigo (Órdenes de compra): el
-- filtro genérico de DataClientService (ilike '%texto%' sobre columnas de
-- texto) nunca puede garantizar una coincidencia EXACTA, que es justo lo que
-- un código de barras escaneado necesita — por eso esta función puntual, no
-- una excepción al criterio de "reutilizar listarPagina" para búsqueda/
-- paginación normal del catálogo.
-- STABLE, SECURITY INVOKER (sin SECURITY DEFINER): la RLS de
-- inventario.producto (empresa_id) sigue aplicando normalmente; devuelve
-- producto.* completo porque Cobro necesita el objeto Producto completo
-- (precioUnitario, existencia, etc.), no solo unos cuantos campos.
create or replace function inventario.fn_cobro_producto_por_codigo(p_codigo text)
returns setof inventario.producto
language sql
stable
set search_path to ''
as $$
  select *
  from inventario.producto
  where lower(codigo) = lower(p_codigo)
    and activo = true
  limit 1;
$$;

grant execute on function inventario.fn_cobro_producto_por_codigo(text) to authenticated;
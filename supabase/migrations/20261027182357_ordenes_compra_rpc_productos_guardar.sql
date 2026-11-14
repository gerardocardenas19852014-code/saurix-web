
-- Homologación "Órdenes de compra > Nueva orden de compra" (27-oct-2026).
--
-- Problema a resolver: la pantalla cargaba TODO inventario.producto al
-- abrir (igual que hacían Productos/Conteo físico/Movimientos antes de
-- homologarse) para armar un <select> en memoria — inviable con 200,000+
-- productos. Además las líneas requerían una fila vacía "Buscar
-- producto..." antes de poder elegir algo (agregarLinea()), y guardar()
-- hacía baja/alta secuenciales sin transacción (riesgo de dejar una orden
-- a medias si algo fallaba a mitad de las líneas).
--
-- Los índices actuales de búsqueda en producto (producto_valor_stock_*)
-- están todos acotados con "WHERE existencia IS NOT NULL" — pensados para
-- Ventas/Movimientos/Conteo físico, donde solo importan productos con
-- control de existencia. Compras SÍ debe poder comprar servicios
-- (existencia IS NULL) sin que deje de usarse un índice, así que no se
-- puede reutilizar esa familia: se agregan dos índices nuevos, acotados
-- solo por lo que Compras de verdad necesita (activo, nunca existencia).

-- 1) Código exacto: debe encontrar también productos INACTIVOS (para dar
--    el mensaje específico de "producto inactivo" en vez de "no
--    encontrado" — ver fn_ordenes_compra_producto_por_codigo), así que no
--    se puede acotar por activo. Case-insensitive porque el código puede
--    llegar en mayúsculas/minúsculas distintas desde el lector.
create index if not exists producto_codigo_lower_ix
  on inventario.producto (empresa_id, lower(codigo));

-- 2) Autocomplete por nombre: solo productos activos (igual que
--    fn_productos_autocomplete), pero SIN excluir servicios — por eso no
--    puede ser producto_valor_stock_nombre_trgm_ix (acotado a existencia
--    IS NOT NULL).
create index if not exists producto_activo_nombre_trgm_ix
  on inventario.producto using gin (nombre gin_trgm_ops)
  where activo = true;

comment on index inventario.producto_codigo_lower_ix is
  'Búsqueda de código EXACTO para Órdenes de compra (fn_ordenes_compra_producto_por_codigo) — a diferencia de producto_valor_stock_codigo_ix, incluye inactivos y servicios (existencia IS NULL), que sí se pueden comprar.';
comment on index inventario.producto_activo_nombre_trgm_ix is
  'Autocomplete por nombre para Órdenes de compra (fn_ordenes_compra_autocomplete_producto) — a diferencia de producto_valor_stock_nombre_trgm_ix, incluye servicios (existencia IS NULL); sigue excluyendo inactivos.';

-- ─────────────────────────────────────────────────────────────────────────
-- fn_ordenes_compra_producto_por_codigo: código EXACTO (case-insensitive).
-- Devuelve el producto exista o no esté activo — el componente decide el
-- mensaje ("no encontrado" vs "inactivo, no se puede agregar") según
-- "activo". No filtra por empresa_id de forma explícita: igual que
-- fn_productos_autocomplete, RLS (solo_mi_empresa) ya lo garantiza al ser
-- SECURITY INVOKER.
create or replace function inventario.fn_ordenes_compra_producto_por_codigo(p_codigo text)
returns table(
  id bigint, codigo text, nombre text, costo numeric, activo boolean,
  unidad_medida_id bigint, unidad_medida_nombre text,
  unidad_compra_id bigint, unidad_compra_nombre text, factor_conversion_compra numeric
)
language sql
stable
set search_path = ''
as $$
  select p.id, p.codigo, p.nombre, p.costo, p.activo,
         p.unidad_medida_id, um.nombre,
         p.unidad_compra_id, uc.nombre, p.factor_conversion_compra
  from inventario.producto p
  left join inventario.unidad_medida um on um.id = p.unidad_medida_id
  left join inventario.unidad_medida uc on uc.id = p.unidad_compra_id
  where lower(p.codigo) = lower(p_codigo)
  limit 1;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- fn_ordenes_compra_autocomplete_producto: "Buscar producto por nombre…".
-- Solo activos (igual que fn_productos_autocomplete) pero SIN excluir
-- servicios, a diferencia de ese — Compras sí puede comprar servicios.
create or replace function inventario.fn_ordenes_compra_autocomplete_producto(p_busqueda text, p_limite integer default 15)
returns table(
  id bigint, codigo text, nombre text, costo numeric,
  unidad_medida_id bigint, unidad_medida_nombre text,
  unidad_compra_id bigint, unidad_compra_nombre text, factor_conversion_compra numeric
)
language sql
stable
set search_path = ''
as $$
  select p.id, p.codigo, p.nombre, p.costo,
         p.unidad_medida_id, um.nombre,
         p.unidad_compra_id, uc.nombre, p.factor_conversion_compra
  from inventario.producto p
  left join inventario.unidad_medida um on um.id = p.unidad_medida_id
  left join inventario.unidad_medida uc on uc.id = p.unidad_compra_id
  where p.activo = true
    and (
      p_busqueda is null or p_busqueda = '' or
      p.nombre ilike '%' || p_busqueda || '%' or
      p.codigo ilike '%' || p_busqueda || '%'
    )
  order by p.nombre asc
  limit greatest(1, coalesce(p_limite, 15));
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- fn_ordenes_compra_productos_por_ids: hidrata SOLO los productos que ya
-- están en las líneas de una orden ya guardada (al abrirla) o en su
-- historial de recepciones — nunca el catálogo completo. El conjunto de
-- ids siempre está acotado por cuántas líneas tiene esa orden (decenas,
-- no 200,000). Incluye inactivos (una orden vieja puede referenciar un
-- producto que ya se desactivó) y servicios.
create or replace function inventario.fn_ordenes_compra_productos_por_ids(p_ids bigint[])
returns table(
  id bigint, codigo text, nombre text, costo numeric, activo boolean,
  unidad_medida_id bigint, unidad_medida_nombre text,
  unidad_compra_id bigint, unidad_compra_nombre text, factor_conversion_compra numeric
)
language sql
stable
set search_path = ''
as $$
  select p.id, p.codigo, p.nombre, p.costo, p.activo,
         p.unidad_medida_id, um.nombre,
         p.unidad_compra_id, uc.nombre, p.factor_conversion_compra
  from inventario.producto p
  left join inventario.unidad_medida um on um.id = p.unidad_medida_id
  left join inventario.unidad_medida uc on uc.id = p.unidad_compra_id
  where p.id = any(p_ids);
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- fn_orden_compra_guardar: crea o actualiza el encabezado + reemplaza por
-- completo sus líneas, todo en UNA transacción (una función PL/pgSQL ya
-- es atómica: si algo falla a mitad, Postgres revierte todo — ya no puede
-- quedar "encabezado creado, líneas a medias"). SECURITY INVOKER (no
-- DEFINER): corre como el usuario autenticado, así que las políticas RLS
-- de siempre (solo_mi_empresa/modulo_habilitado/compartida_todo) se
-- siguen aplicando tal cual a cada insert/update/delete de aquí adentro —
-- esto NO es una puerta trasera que salte RLS, solo junta en un solo
-- viaje al servidor lo que antes eran N llamadas REST sueltas.
--
-- p_lineas: jsonb [{producto_id, cantidad, costo_unitario, unidad_id,
-- factor_conversion}, …]. NULL = no tocar las líneas (no se usa desde la
-- UI actual, que siempre guarda con líneas, pero deja la función servible
-- para un futuro "solo actualizar encabezado" sin otra migración).
--
-- El folio se calcula AQUÍ (no en el cliente con el folioSugeridoOrdenCompra()
-- de siempre, que lee el arreglo ya cargado en memoria) para que dos
-- personas creando una orden al mismo tiempo nunca puedan terminar con el
-- mismo folio — la función sigue exportándose para la lista/filtros, que
-- es donde realmente se sigue usando.
create or replace function inventario.fn_orden_compra_guardar(
  p_orden_id bigint,
  p_proveedor_id bigint,
  p_bodega_destino_id bigint,
  p_fecha date,
  p_fecha_entrega_estimada date,
  p_notas text,
  p_lineas jsonb
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_folio text;
  v_orden_id bigint;
  v_linea jsonb;
begin
  if p_orden_id is null then
    select 'OC-' || lpad((coalesce(max(nullif(regexp_replace(o.folio, '[^0-9]', '', 'g'), '')::int), 0) + 1)::text, 4, '0')
      into v_folio
      from inventario.orden_compra o;

    insert into inventario.orden_compra
      (folio, proveedor_id, bodega_destino_id, estado, fecha, fecha_entrega_estimada, notas)
    values
      (v_folio, p_proveedor_id, p_bodega_destino_id, 'pendiente', p_fecha, p_fecha_entrega_estimada, p_notas)
    returning id into v_orden_id;
  else
    update inventario.orden_compra set
      proveedor_id = p_proveedor_id,
      bodega_destino_id = p_bodega_destino_id,
      fecha = p_fecha,
      fecha_entrega_estimada = p_fecha_entrega_estimada,
      notas = p_notas
    where id = p_orden_id
    returning id into v_orden_id;

    if v_orden_id is null then
      raise exception 'Orden de compra % no encontrada o sin permiso.', p_orden_id;
    end if;
  end if;

  if p_lineas is not null then
    delete from inventario.orden_compra_item where orden_compra_id = v_orden_id;

    for v_linea in select * from jsonb_array_elements(p_lineas)
    loop
      insert into inventario.orden_compra_item
        (orden_compra_id, producto_id, cantidad, costo_unitario, cantidad_recibida, unidad_id, factor_conversion)
      values (
        v_orden_id,
        (v_linea->>'producto_id')::bigint,
        (v_linea->>'cantidad')::numeric,
        (v_linea->>'costo_unitario')::numeric,
        0,
        case when v_linea->>'unidad_id' is null then null else (v_linea->>'unidad_id')::bigint end,
        coalesce((v_linea->>'factor_conversion')::numeric, 1)
      );
    end loop;
  end if;

  return v_orden_id;
end;
$$;

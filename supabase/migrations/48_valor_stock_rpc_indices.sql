-- Valor de stock: optimización para 200,000+ productos y potencialmente
-- millones de movimientos de inventario (pedido explícito del usuario).
--
-- Antes: ValorStockComponent.cargar() traía Producto/CategoriaProducto/
-- Bodega/ExistenciaBodega/NivelMinimoBodega/MovimientoInventario COMPLETOS
-- (sin filtro ni límite) y calculaba todo en Angular con .filter/.map/
-- .reduce/.sort — ver supabase-data-client.service.ts listar(), ya
-- corregido para traer páginas en PARALELO (sección 9.6 del reporte de
-- auditoría), pero seguía siendo "bajar 200,000 filas al navegador para
-- sumarlas ahí", lo opuesto a lo que pide este cambio.
--
-- Ahora: 5 funciones RPC (inventario.fn_valor_stock_*) hacen todo el
-- filtrado/agregación/orden/paginación en Postgres; Angular solo recibe
-- resultados ya resumidos o una página a la vez. Todas son SECURITY
-- INVOKER (el default de Postgres al omitir "security definer") — nunca
-- se usa SECURITY DEFINER aquí, así que las políticas RLS de cada tabla
-- (solo_mi_empresa, modulo_habilitado, compartida_todo) se siguen
-- aplicando exactamente igual que si el usuario hiciera un SELECT directo
-- contra esas tablas. Cada función además filtra explícitamente por
-- `empresa_id = privado.empresa_actual_id()` (mismo criterio que las
-- políticas RLS existentes) como refuerzo explícito y para que el
-- planificador pueda usar los índices por empresa_id de una vez, no solo
-- por la evaluación de la política.
--
-- search_path fijo a vacío en cada función: toda referencia a una tabla o
-- función va completamente calificada con su esquema (inventario.*,
-- privado.*), así que no hay forma de que una función con el mismo nombre
-- en otro esquema del search_path del llamante se cuele en su lugar.

-- ───────────────────────── pg_trgm (búsqueda por texto) ─────────────────

create extension if not exists pg_trgm with schema extensions;

-- ───────────────────────── Índices nuevos ────────────────────────────────

-- Último movimiento por producto (pestaña Rotación, ver
-- fn_valor_stock_rotacion más abajo): permite el truco de "loose index
-- scan" (saltar de un producto_id al siguiente tomando su fecha más
-- reciente) en vez de escanear TODOS los movimientos y agrupar — con
-- millones de filas en movimiento_inventario, la diferencia es escanear
-- ~cuántos productos distintos tienen movimientos, no cuántos movimientos
-- hay en total.
create index if not exists movimiento_inventario_empresa_producto_fecha_ix
  on inventario.movimiento_inventario (empresa_id, producto_id, fecha desc);

-- Orden server-side por nombre/código/costo en la pestaña Productos sin
-- tener que traer el catálogo completo para ordenarlo. Parciales
-- (`where existencia is not null`) porque Valor de stock SOLO considera
-- productos físicos — un índice más chico y más preciso que uno sobre la
-- tabla completa (que también incluye servicios, fuera de alcance aquí).
create index if not exists producto_valor_stock_nombre_ix
  on inventario.producto (empresa_id, activo, nombre)
  where existencia is not null;

create index if not exists producto_valor_stock_codigo_ix
  on inventario.producto (empresa_id, activo, codigo)
  where existencia is not null;

create index if not exists producto_valor_stock_costo_ix
  on inventario.producto (empresa_id, activo, costo)
  where existencia is not null;

-- Búsqueda "contiene" (ILIKE '%texto%') por nombre/código: un B-tree normal
-- no sirve para un patrón con comodín al inicio (no puede usar el índice
-- para "empieza por cualquier cosa, contiene X en medio") — GIN + trigram
-- sí, y es la razón de instalar pg_trgm arriba.
create index if not exists producto_valor_stock_nombre_trgm_ix
  on inventario.producto using gin (nombre gin_trgm_ops)
  where existencia is not null;

create index if not exists producto_valor_stock_codigo_trgm_ix
  on inventario.producto using gin (codigo gin_trgm_ops)
  where existencia is not null;

-- ───────────────────────── 1) Tarjetas superiores ────────────────────────
-- Valor de inventario a costo / a precio de venta / margen potencial, más
-- los conteos de "sin existencia" / "stock bajo" / "sobre-stock" que antes
-- mostraban las tarjetas de alerta. Reemplaza productos.reduce(...) en
-- Angular — aquí solo se regresa UN renglón con los totales ya calculados.
--
-- Reglas replicadas EXACTAMENTE de producto.util.ts (alertasStockBajo /
-- haySobreStock / existenciaTotal), para que el resultado coincida con lo
-- que ya mostraba la pantalla:
--   - Solo productos físicos (existencia IS NOT NULL) y activos.
--   - existencia "real" = suma de ExistenciaBodega si ya tiene alguna
--     asignada, si no el Producto.existencia heredado.
--   - stock bajo: si el producto ya tiene NivelMinimoBodega propios, se
--     evalúa bodega por bodega (alerta si CUALQUIERA está por debajo); si
--     no tiene ninguno, se cae al criterio global Producto.nivelMinimo
--     contra la existencia total.
--   - sobre-stock: existencia total > Producto.nivelMaximo (si está
--     definido).
create or replace function inventario.fn_valor_stock_resumen()
returns table (
  valor_costo numeric,
  valor_venta numeric,
  margen numeric,
  total_productos bigint,
  sin_existencia bigint,
  stock_bajo bigint,
  sobre_stock bigint
)
language sql
stable
set search_path = ''
as $$
  with existencia_agg as (
    select producto_id, sum(existencia) as existencia_total
    from inventario.existencia_bodega
    where empresa_id = privado.empresa_actual_id()
    group by producto_id
  ),
  nmb_bajo_agg as (
    select n.producto_id, bool_or(coalesce(e.existencia, 0) < n.nivel_minimo) as bajo
    from inventario.nivel_minimo_bodega n
    left join inventario.existencia_bodega e
      on e.producto_id = n.producto_id and e.bodega_id = n.bodega_id
    where n.empresa_id = privado.empresa_actual_id()
    group by n.producto_id
  ),
  base as (
    select
      p.id,
      p.costo,
      p.precio_unitario,
      p.nivel_minimo,
      p.nivel_maximo,
      coalesce(ea.existencia_total, p.existencia, 0) as existencia,
      (nb.producto_id is not null) as tiene_nmb,
      coalesce(nb.bajo, false) as nmb_bajo
    from inventario.producto p
    left join existencia_agg ea on ea.producto_id = p.id
    left join nmb_bajo_agg nb on nb.producto_id = p.id
    where p.empresa_id = privado.empresa_actual_id()
      and p.activo
      and p.existencia is not null
  )
  select
    coalesce(sum(existencia * costo), 0)::numeric as valor_costo,
    coalesce(sum(existencia * precio_unitario), 0)::numeric as valor_venta,
    (coalesce(sum(existencia * precio_unitario), 0) - coalesce(sum(existencia * costo), 0))::numeric as margen,
    count(*) as total_productos,
    count(*) filter (where existencia = 0) as sin_existencia,
    count(*) filter (
      where case
        when tiene_nmb then nmb_bajo
        when nivel_minimo is not null then existencia < nivel_minimo
        else false
      end
    ) as stock_bajo,
    count(*) filter (where nivel_maximo is not null and existencia > nivel_maximo) as sobre_stock
  from base;
$$;

-- ───────────────────────── 2) Resumen: valor por categoría ──────────────
create or replace function inventario.fn_valor_stock_por_categoria()
returns table (
  categoria_id bigint,
  categoria_nombre text,
  valor numeric,
  pct numeric
)
language sql
stable
set search_path = ''
as $$
  with existencia_agg as (
    select producto_id, sum(existencia) as existencia_total
    from inventario.existencia_bodega
    where empresa_id = privado.empresa_actual_id()
    group by producto_id
  ),
  base as (
    select
      p.categoria_producto_id as categoria_id,
      coalesce(ea.existencia_total, p.existencia, 0) * p.costo as valor
    from inventario.producto p
    left join existencia_agg ea on ea.producto_id = p.id
    where p.empresa_id = privado.empresa_actual_id()
      and p.activo
      and p.existencia is not null
  ),
  por_cat as (
    select categoria_id, sum(valor) as valor
    from base
    group by categoria_id
  ),
  total as (
    select coalesce(sum(valor), 0) as total from por_cat
  )
  select
    c.id as categoria_id,
    c.nombre as categoria_nombre,
    pc.valor,
    case when t.total > 0 then (pc.valor / t.total) * 100 else 0 end as pct
  from por_cat pc
  join inventario.categoria_producto c on c.id = pc.categoria_id
  cross join total t
  order by pc.valor desc;
$$;

-- ───────────────────────── 3) Resumen: valor por bodega ──────────────────
-- Mismo criterio que porBodega() en el componente anterior: se calcula
-- directo de ExistenciaBodega (NO de existenciaTotal con su "heredado"),
-- así que el remanente de productos sin ninguna bodega asignada cae en su
-- propio bucket "Sin bodega asignada" — la suma de todo sigue cuadrando
-- con fn_valor_stock_resumen().valor_costo.
create or replace function inventario.fn_valor_stock_por_bodega()
returns table (
  bodega_id bigint,
  bodega_nombre text,
  valor numeric,
  pct numeric
)
language sql
stable
set search_path = ''
as $$
  with existencia_agg as (
    select producto_id, sum(existencia) as existencia_total
    from inventario.existencia_bodega
    where empresa_id = privado.empresa_actual_id()
    group by producto_id
  ),
  total as (
    select coalesce(sum(coalesce(ea.existencia_total, p.existencia, 0) * p.costo), 0) as total
    from inventario.producto p
    left join existencia_agg ea on ea.producto_id = p.id
    where p.empresa_id = privado.empresa_actual_id()
      and p.activo
      and p.existencia is not null
  ),
  por_bodega as (
    select e.bodega_id, sum(e.existencia * p.costo) as valor
    from inventario.existencia_bodega e
    join inventario.producto p
      on p.id = e.producto_id
      and p.empresa_id = privado.empresa_actual_id()
      and p.activo
      and p.existencia is not null
    where e.empresa_id = privado.empresa_actual_id()
    group by e.bodega_id
  ),
  asignado as (
    select coalesce(sum(valor), 0) as valor from por_bodega
  )
  select bo.id as bodega_id, bo.nombre as bodega_nombre, pb.valor,
    case when t.total > 0 then (pb.valor / t.total) * 100 else 0 end as pct
  from por_bodega pb
  join inventario.bodega bo on bo.id = pb.bodega_id
  cross join total t
  union all
  select null::bigint, 'Sin bodega asignada', greatest(t.total - a.valor, 0),
    case when t.total > 0 then (greatest(t.total - a.valor, 0) / t.total) * 100 else 0 end
  from total t cross join asignado a
  where greatest(t.total - a.valor, 0) > 0
  order by valor desc;
$$;

-- ───────────────────────── 4) Productos: listado paginado ────────────────
-- WHERE + ORDER BY + LIMIT/OFFSET en Postgres — Angular solo recibe la
-- página pedida (ver ResultadoPagina / listarPagina ya usado en
-- productos.component.ts, mismo espíritu: `total` viene como columna en
-- cada fila vía count(*) over(), así Angular arma {filas, total} igual que
-- siempre). PL/pgSQL (no SQL plano) porque el ORDER BY es dinámico; nunca
-- se concatena el parámetro del usuario directo al SQL — p_orden/p_direccion
-- se validan primero contra una lista fija (v_orden/v_direccion) y format()
-- con %I/%s solo recibe esos valores ya validados, nunca el parámetro crudo.
create or replace function inventario.fn_valor_stock_productos(
  p_busqueda text default null,
  p_categoria_id bigint default null,
  p_bodega_id bigint default null,
  p_estado text default null,
  p_orden text default 'nombre',
  p_direccion text default 'asc',
  p_desde integer default 0,
  p_cantidad integer default 50
)
returns table (
  producto_id bigint,
  codigo text,
  nombre text,
  categoria_id bigint,
  categoria_nombre text,
  existencia numeric,
  costo numeric,
  valor numeric,
  stock_bajo boolean,
  sobre_stock boolean,
  total bigint
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_orden text;
  v_direccion text;
begin
  v_orden := case p_orden
    when 'codigo' then 'codigo'
    when 'existencia' then 'existencia'
    when 'costo' then 'costo'
    when 'valor' then 'valor'
    else 'nombre'
  end;
  v_direccion := case when lower(coalesce(p_direccion, 'asc')) = 'desc' then 'desc' else 'asc' end;

  return query execute format(
    $q$
    with existencia_agg as (
      select producto_id, sum(existencia) as existencia_total
      from inventario.existencia_bodega
      where empresa_id = privado.empresa_actual_id()
      group by producto_id
    ),
    nmb_bajo_agg as (
      select n.producto_id, bool_or(coalesce(e.existencia, 0) < n.nivel_minimo) as bajo
      from inventario.nivel_minimo_bodega n
      left join inventario.existencia_bodega e
        on e.producto_id = n.producto_id and e.bodega_id = n.bodega_id
      where n.empresa_id = privado.empresa_actual_id()
      group by n.producto_id
    ),
    base as (
      select
        p.id as producto_id,
        p.codigo,
        p.nombre,
        p.categoria_producto_id as categoria_id,
        c.nombre as categoria_nombre,
        coalesce(ea.existencia_total, p.existencia, 0) as existencia,
        p.costo,
        coalesce(ea.existencia_total, p.existencia, 0) * p.costo as valor,
        case
          when nb.producto_id is not null then coalesce(nb.bajo, false)
          when p.nivel_minimo is not null then coalesce(ea.existencia_total, p.existencia, 0) < p.nivel_minimo
          else false
        end as stock_bajo,
        (p.nivel_maximo is not null and coalesce(ea.existencia_total, p.existencia, 0) > p.nivel_maximo) as sobre_stock
      from inventario.producto p
      join inventario.categoria_producto c on c.id = p.categoria_producto_id
      left join existencia_agg ea on ea.producto_id = p.id
      left join nmb_bajo_agg nb on nb.producto_id = p.id
      where p.empresa_id = privado.empresa_actual_id()
        and p.activo
        and p.existencia is not null
        and ($1 is null or p.nombre ilike ''%%'' || $1 || ''%%'' or p.codigo ilike ''%%'' || $1 || ''%%'')
        and ($2 is null or p.categoria_producto_id = $2)
        and ($3 is null or exists (
          select 1 from inventario.existencia_bodega eb
          where eb.producto_id = p.id and eb.bodega_id = $3
        ))
    )
    select *, count(*) over() as total
    from base
    where
      case $4
        when ''sin_existencia'' then existencia = 0
        when ''stock_bajo'' then stock_bajo
        when ''sobre_stock'' then sobre_stock
        else true
      end
    order by %I %s, producto_id asc
    limit $5 offset $6
    $q$,
    v_orden, v_direccion
  )
  using nullif(trim(p_busqueda), ''), p_categoria_id, p_bodega_id, nullif(p_estado, ''), p_cantidad, p_desde;
end;
$$;

-- ───────────────────────── 5) Rotación: último movimiento, paginada ──────
-- "Loose index scan" (ver movimiento_inventario_empresa_producto_fecha_ix
-- arriba): la CTE recursiva salta de un producto_id al siguiente tomando
-- su fecha más reciente, en vez de agregar MAX(fecha) sobre TODOS los
-- movimientos — con un catálogo de 200,000 productos y millones de
-- movimientos, el costo queda ligado a cuántos productos DISTINTOS tienen
-- movimientos, no a cuántos movimientos hay en total.
create or replace function inventario.fn_valor_stock_rotacion(
  p_umbral_dias integer default 60,
  p_desde integer default 0,
  p_cantidad integer default 50
)
returns table (
  producto_id bigint,
  codigo text,
  nombre text,
  existencia numeric,
  ultimo_movimiento date,
  dias_sin_movimiento integer,
  total bigint
)
language sql
stable
set search_path = ''
as $$
  with recursive existencia_agg as (
    select producto_id, sum(existencia) as existencia_total
    from inventario.existencia_bodega
    where empresa_id = privado.empresa_actual_id()
    group by producto_id
  ),
  ultimos as (
    (
      select producto_id, fecha
      from inventario.movimiento_inventario
      where empresa_id = privado.empresa_actual_id()
      order by producto_id, fecha desc
      limit 1
    )
    union all
    select m.producto_id, m.fecha
    from ultimos u
    cross join lateral (
      select producto_id, fecha
      from inventario.movimiento_inventario
      where empresa_id = privado.empresa_actual_id()
        and producto_id > u.producto_id
      order by producto_id, fecha desc
      limit 1
    ) m
  ),
  base as (
    select
      p.id as producto_id,
      p.codigo,
      p.nombre,
      coalesce(ea.existencia_total, p.existencia, 0) as existencia,
      u.fecha as ultimo_movimiento,
      case when u.fecha is null then null else (current_date - u.fecha) end as dias_sin_movimiento
    from inventario.producto p
    left join existencia_agg ea on ea.producto_id = p.id
    left join ultimos u on u.producto_id = p.id
    where p.empresa_id = privado.empresa_actual_id()
      and p.activo
      and p.existencia is not null
  )
  select producto_id, codigo, nombre, existencia, ultimo_movimiento, dias_sin_movimiento,
    count(*) over() as total
  from base
  where ultimo_movimiento is null or dias_sin_movimiento >= p_umbral_dias
  order by ultimo_movimiento asc nulls first, producto_id asc
  limit p_cantidad offset p_desde;
$$;

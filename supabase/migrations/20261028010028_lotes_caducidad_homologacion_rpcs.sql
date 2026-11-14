-- Homologación de Inventario > Lotes y caducidad (2026-10): autocomplete
-- remoto de producto (solo productos con manejaLotes=true, distinto filtro
-- al de fn_kardex_productos_autocomplete/fn_productos_autocomplete — por
-- eso una función nueva, sin tocar esas) + resumen de Próximos a
-- vencer/Vencidos vía count(*) (nunca descargando lotes a Angular) +
-- listado paginado/filtrado/ordenado server-side con la MISMA regla de
-- "próximo a vencer ≤30 días" que ya tenía lotes-caducidad.component.ts
-- (UMBRAL_PROXIMOS_DIAS), sin inventar una regla distinta entre frontend y
-- backend. No se modifica ninguna regla de existencias/inventario: estas
-- funciones son de solo lectura sobre lote_producto (registro informativo,
-- no toca existencia_bodega/movimiento_inventario).

create or replace function inventario.fn_lotes_productos_autocomplete(
  p_busqueda text default null,
  p_limite integer default 15
)
returns table (
  id bigint,
  codigo text,
  nombre text,
  unidad_nombre text
)
language sql
stable
set search_path to ''
as $function$
  select p.id, p.codigo, p.nombre, um.nombre
  from inventario.producto p
  left join inventario.unidad_medida um on um.id = p.unidad_medida_id
  where p.activo = true
    and p.maneja_lotes = true
    and (
      p_busqueda is null or p_busqueda = '' or
      p.nombre ilike '%' || p_busqueda || '%' or
      p.codigo ilike '%' || p_busqueda || '%'
    )
  order by p.nombre asc
  limit greatest(1, coalesce(p_limite, 15));
$function$;

create or replace function inventario.fn_lotes_resumen()
returns table (
  total_proximos bigint,
  total_vencidos bigint
)
language sql
stable
set search_path to ''
as $function$
  select
    count(*) filter (
      where activo and fecha_caducidad is not null
        and fecha_caducidad >= current_date and fecha_caducidad <= current_date + 30
    ),
    count(*) filter (
      where activo and fecha_caducidad is not null and fecha_caducidad < current_date
    )
  from inventario.lote_producto;
$function$;

create or replace function inventario.fn_lotes_listar(
  p_producto_id bigint default null,
  p_bodega_id bigint default null,
  p_busqueda_lote text default null,
  p_estado text default null,
  p_incluir_inactivos boolean default false,
  p_orden text default 'fecha_caducidad',
  p_direccion text default 'asc',
  p_desde integer default 0,
  p_cantidad integer default 50
)
returns table (
  id bigint,
  producto_id bigint,
  producto_codigo text,
  producto_nombre text,
  bodega_id bigint,
  bodega_nombre text,
  lote text,
  fecha_caducidad date,
  dias integer,
  cantidad numeric,
  notas text,
  activo boolean,
  total bigint
)
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_orden text;
  v_direccion text;
begin
  v_orden := case p_orden
    when 'producto' then 'producto_nombre'
    when 'lote' then 'lote'
    when 'bodega' then 'bodega_nombre'
    when 'cantidad' then 'cantidad'
    when 'dias' then 'dias'
    when 'activo' then 'activo'
    else 'fecha_caducidad'
  end;
  v_direccion := case when lower(coalesce(p_direccion, 'asc')) = 'desc' then 'desc' else 'asc' end;

  return query execute format(
    $q$
    with base as (
      select
        l.id,
        l.producto_id,
        p.codigo as producto_codigo,
        p.nombre as producto_nombre,
        l.bodega_id,
        b.nombre as bodega_nombre,
        l.lote,
        l.fecha_caducidad,
        (l.fecha_caducidad - current_date) as dias,
        l.cantidad,
        l.notas,
        l.activo
      from inventario.lote_producto l
      join inventario.producto p on p.id = l.producto_id
      left join inventario.bodega b on b.id = l.bodega_id
      where ($1 or l.activo)
        and ($2 is null or l.producto_id = $2)
        and ($3 is null or l.bodega_id = $3)
        and ($4 is null or l.lote ilike '%%' || $4 || '%%')
    )
    select *, count(*) over() as total
    from base
    where
      case $5
        when 'vigente' then fecha_caducidad is not null and fecha_caducidad > current_date + 30
        when 'proximo' then fecha_caducidad is not null and fecha_caducidad >= current_date and fecha_caducidad <= current_date + 30
        when 'vencido' then fecha_caducidad is not null and fecha_caducidad < current_date
        else true
      end
    order by %I %s nulls last, id asc
    limit $6 offset $7
    $q$,
    v_orden, v_direccion
  )
  using p_incluir_inactivos, p_producto_id, p_bodega_id, nullif(trim(p_busqueda_lote), ''), nullif(p_estado, ''), p_cantidad, p_desde;
end;
$function$;
-- Corrige el diseño de Rotación de la migración 48.
--
-- Problema encontrado en la validación a escala (200,005 productos de
-- prueba + 1,500,007 movimientos sintéticos, ver auditoría): la CTE
-- recursiva ("loose index scan") de fn_valor_stock_rotacion tardó
-- ~15.6s (EXPLAIN ANALYZE) porque hace una llamada de índice POR cada uno
-- de los 150,005 productos con movimientos — el overhead por-llamada en
-- Postgres no escala bien a cientos de miles de grupos distintos, aunque
-- cada llamada individual sea barata. Un GROUP BY + MAX(fecha) directo
-- sobre el índice (empresa_id, producto_id, fecha desc) es más rápido
-- (~2.9s) pero sigue siendo O(total de movimientos): con "millones" de
-- movimientos seguiría creciendo sin límite, que es justo lo que el
-- requerimiento 7 pide evitar.
--
-- Solución: una tabla resumen mantenida por trigger,
-- inventario.ultimo_movimiento_producto (1 fila por producto, NUNCA por
-- movimiento), así que su tamaño está acotado por el catálogo de
-- productos (cientos de miles), no por el historial de movimientos
-- (potencialmente millones). El trigger recalcula, en cada INSERT/UPDATE/
-- DELETE sobre movimiento_inventario, el MAX(fecha) de ESE producto
-- usando el índice ya existente movimiento_inventario_producto_id_ix
-- (barato: solo los movimientos de un producto, no la tabla completa) —
-- nunca SECURITY DEFINER: corre con los mismos privilegios de quien hizo
-- el INSERT/UPDATE/DELETE original (que ya pasó el RLS de
-- movimiento_inventario), y sus propias escrituras a la tabla resumen
-- quedan sujetas al RLS de esa tabla (mismas 3 políticas que
-- movimiento_inventario, mismo empresa_id).
--
-- Con esto, fn_valor_stock_rotacion ya NO toca movimiento_inventario en
-- absoluto: solo hace un LEFT JOIN de producto (acotado por catálogo)
-- contra esta tabla resumen (también acotada por catálogo). Su costo deja
-- de depender del total de movimientos.

create table if not exists inventario.ultimo_movimiento_producto (
  producto_id bigint primary key references inventario.producto (id) on delete cascade,
  empresa_id bigint not null,
  ultima_fecha date not null
);

alter table inventario.ultimo_movimiento_producto enable row level security;

create policy compartida_todo on inventario.ultimo_movimiento_producto
  for all
  using ((select privado.usuario_actual_id()) is not null)
  with check ((select privado.usuario_actual_id()) is not null);

create policy modulo_habilitado on inventario.ultimo_movimiento_producto
  for all
  using ((select privado.modulo_habilitado('inventario')))
  with check ((select privado.modulo_habilitado('inventario')));

create policy solo_mi_empresa on inventario.ultimo_movimiento_producto
  for all
  using (empresa_id = (select privado.empresa_actual_id()))
  with check (empresa_id = (select privado.empresa_actual_id()));

create index if not exists ultimo_movimiento_producto_empresa_fecha_ix
  on inventario.ultimo_movimiento_producto (empresa_id, ultima_fecha);

-- Backfill único (corre como el rol de la migración, sin RLS — es un
-- cálculo administrativo de una sola vez sobre datos ya existentes de
-- TODAS las empresas, cada fila conserva su propio empresa_id real).
insert into inventario.ultimo_movimiento_producto (producto_id, empresa_id, ultima_fecha)
select producto_id, empresa_id, max(fecha)
from inventario.movimiento_inventario
group by producto_id, empresa_id
on conflict (producto_id) do update
  set ultima_fecha = excluded.ultima_fecha, empresa_id = excluded.empresa_id;

-- Trigger de mantenimiento: recalcula desde cero el producto afectado
-- (y, en el caso raro de un UPDATE que reasigna producto_id, también el
-- producto anterior) — siempre correcto ante inserciones, ediciones de
-- fecha/cantidad y borrados, sin lógica incremental propensa a errores.
create or replace function inventario.fn_actualizar_ultimo_movimiento_producto()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_producto_id bigint;
  v_empresa_id bigint;
  v_max_fecha date;
begin
  if tg_op = 'DELETE' then
    v_producto_id := old.producto_id;
    v_empresa_id := old.empresa_id;
  else
    v_producto_id := new.producto_id;
    v_empresa_id := new.empresa_id;
  end if;

  select max(fecha) into v_max_fecha
  from inventario.movimiento_inventario
  where producto_id = v_producto_id;

  if v_max_fecha is null then
    delete from inventario.ultimo_movimiento_producto where producto_id = v_producto_id;
  else
    insert into inventario.ultimo_movimiento_producto (producto_id, empresa_id, ultima_fecha)
    values (v_producto_id, v_empresa_id, v_max_fecha)
    on conflict (producto_id) do update
      set ultima_fecha = excluded.ultima_fecha, empresa_id = excluded.empresa_id;
  end if;

  if tg_op = 'UPDATE' and old.producto_id is distinct from new.producto_id then
    select max(fecha) into v_max_fecha
    from inventario.movimiento_inventario
    where producto_id = old.producto_id;

    if v_max_fecha is null then
      delete from inventario.ultimo_movimiento_producto where producto_id = old.producto_id;
    else
      insert into inventario.ultimo_movimiento_producto (producto_id, empresa_id, ultima_fecha)
      values (old.producto_id, old.empresa_id, v_max_fecha)
      on conflict (producto_id) do update
        set ultima_fecha = excluded.ultima_fecha, empresa_id = excluded.empresa_id;
    end if;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_actualizar_ultimo_movimiento_producto on inventario.movimiento_inventario;
create trigger trg_actualizar_ultimo_movimiento_producto
  after insert or update or delete on inventario.movimiento_inventario
  for each row execute function inventario.fn_actualizar_ultimo_movimiento_producto();

-- Rotación: ahora un simple LEFT JOIN producto -> tabla resumen, sin
-- tocar movimiento_inventario.
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
  with existencia_agg as (
    select producto_id, sum(existencia) as existencia_total
    from inventario.existencia_bodega
    where empresa_id = privado.empresa_actual_id()
    group by producto_id
  ),
  base as (
    select
      p.id as producto_id,
      p.codigo,
      p.nombre,
      coalesce(ea.existencia_total, p.existencia, 0) as existencia,
      u.ultima_fecha as ultimo_movimiento,
      case when u.ultima_fecha is null then null else (current_date - u.ultima_fecha) end as dias_sin_movimiento
    from inventario.producto p
    left join existencia_agg ea on ea.producto_id = p.id
    left join inventario.ultimo_movimiento_producto u
      on u.producto_id = p.id and u.empresa_id = privado.empresa_actual_id()
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

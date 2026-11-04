-- SAURIX — Importación masiva de productos: homologación (nov-2026).
--
-- Reemplaza el ciclo de N inserciones HTTP individuales (una por producto,
-- sin validar nada en el servidor, sin ninguna atomicidad real — ver
-- auditoría en claude/productos-importacion-masiva-auditoria-2026-11.md)
-- por UNA sola llamada a esta función: valida TODO el archivo en el
-- servidor (nunca confiando en lo que ya validó el navegador) y, si no
-- hay ningún error, inserta todos los productos dentro de la MISMA
-- transacción implícita de la función — si algo falla a medio camino,
-- Postgres revierte la función completa solo, nunca queda un estado a
-- medias (decisión del usuario: "todo o nada SIEMPRE, sin importar el
-- tamaño").
--
-- Política de código duplicado (decisión del usuario, 4-nov-2026):
-- "detener toda la importación si hay algún duplicado" -- tanto si el
-- código se repite DENTRO del mismo archivo como si ya existe en el
-- catálogo. No se crea nada hasta que el archivo quede limpio.

-- ── 1) Tabla de la operación ("referencia de operación", sección I) ───────
-- Un renglón por cada importación que de verdad se ejecutó (nunca una
-- importación que falló por validación -- esas no llegan a crear nada,
-- así que tampoco dejan rastro aquí). Sirve también para la idempotencia
-- (mismo patrón ya usado en inventario.movimiento_inventario.operacion_masiva_id
-- / fn_movimiento_masivo_registrar): el id lo genera el navegador
-- (crypto.randomUUID()) ANTES de llamar a la función, así que un
-- reintento de red o un doble clic que repita la misma llamada con el
-- mismo id nunca vuelve a importar nada.
create table inventario.importacion_producto (
  id uuid primary key,
  empresa_id bigint not null default privado.empresa_actual_id() references seguridad.empresa(id),
  creado_por bigint references seguridad.usuario(id) default privado.usuario_actual_id(),
  fecha_creacion timestamptz not null default now(),
  total_filas int not null,
  productos_creados int not null
);

comment on table inventario.importacion_producto is
  'Encabezado de cada importación masiva de productos que SÍ se ejecutó (ver fn_importar_productos_masivo). Sirve como "referencia de operación" y como llave de idempotencia.';

alter table inventario.importacion_producto enable row level security;

-- Mismo patrón de 3 políticas que ya tiene inventario.producto.
create policy compartida_todo on inventario.importacion_producto
  as permissive for all
  using ((select privado.usuario_actual_id()) is not null)
  with check ((select privado.usuario_actual_id()) is not null);

create policy modulo_habilitado on inventario.importacion_producto
  as restrictive for all
  using ((select privado.modulo_habilitado('inventario')))
  with check ((select privado.modulo_habilitado('inventario')));

create policy solo_mi_empresa on inventario.importacion_producto
  as restrictive for all
  using (empresa_id = (select privado.empresa_actual_id()))
  with check (empresa_id = (select privado.empresa_actual_id()));

-- ── 2) De qué importación vino cada producto (opcional, nullable) ─────────
-- No cambia nada del alta manual (ahí siempre queda NULL) -- solo permite,
-- hacia adelante, saber "qué trajo esta importación" a partir de su id.
alter table inventario.producto
  add column importacion_id uuid references inventario.importacion_producto(id);

create index producto_importacion_id_ix on inventario.producto (importacion_id) where importacion_id is not null;

-- ── 3) La función ───────────────────────────────────────────────────────
-- p_solo_validar = true: valida todo (incluye duplicados dentro del
-- archivo y contra el catálogo) y responde SIN crear nada -- esto es lo
-- que llama Angular justo después de leer el archivo, para la vista
-- previa. Es la ÚNICA implementación de las reglas de validación: Angular
-- ya NO vuelve a reimplementarlas en TypeScript (antes sí lo hacía, 100%
-- en el navegador -- ver la auditoría), evitando el riesgo de que las dos
-- copias se desincronicen.
-- p_solo_validar = false: si la validación sale limpia, además inserta.
-- Si sale con algún error, de todas formas no inserta nada (nunca hace
-- falta "revertir": como la validación completa ocurre ANTES de cualquier
-- insert, un archivo con errores simplemente nunca llega a tocar la tabla).
create or replace function inventario.fn_importar_productos_masivo(
  p_filas jsonb,
  p_operacion_id uuid,
  p_solo_validar boolean default false
)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_existente inventario.importacion_producto;
  v_total int;
  v_numero_regla text := '^\d+(\.\d+)?$'; -- entero o decimal no negativo.
  v_errores jsonb;
  v_advertencias jsonb;
  v_creados int := 0;
begin
  if p_operacion_id is null then
    raise exception 'Falta el identificador de operación (idempotencia).';
  end if;

  -- Idempotencia -- igual que fn_movimiento_masivo_registrar: un reintento
  -- con el mismo id nunca vuelve a crear nada, ni en modo validación.
  select * into v_existente from inventario.importacion_producto where id = p_operacion_id;
  if v_existente.id is not null then
    return jsonb_build_object(
      'operacionId', p_operacion_id, 'duplicada', true, 'ok', true,
      'totalFilas', v_existente.total_filas, 'productosCreados', v_existente.productos_creados,
      'errores', '[]'::jsonb, 'advertencias', '[]'::jsonb
    );
  end if;

  if p_filas is null or jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then
    raise exception 'El archivo no trae renglones para importar.';
  end if;

  v_total := jsonb_array_length(p_filas);
  if v_total > 5000 then
    raise exception 'El archivo trae % renglones -- el máximo por importación es 5,000. Divídelo en partes.', v_total;
  end if;

  -- Validación 100% en SQL de conjuntos (sección F del mandato: nunca un
  -- ciclo con una consulta/operación por renglón). La primera versión de
  -- esta función (misma migración, versión inicial) validaba renglón por
  -- renglón en un ciclo plpgsql acumulando resultados con
  -- `jsonb || jsonb_build_object(...)` -- esa concatenación NO es O(1),
  -- cada `||` copia el valor acumulado completo, así que un archivo de N
  -- renglones costaba O(N²). Medido en pruebas reales (transacción de
  -- prueba con ROLLBACK, nunca contra datos reales): 27 filas ~149 ms,
  -- 100 filas ~219 ms, 500 filas ~1,350 ms, 5,000 filas ~49,879 ms
  -- (≈50 s -- inaceptable). Esta versión usa una sola tabla temporal con
  -- todos los renglones ya resueltos (categoría/unidad/proveedor por
  -- JOIN, formatos numéricos por regex, duplicados dentro del archivo por
  -- una función de ventana) y un solo INSERT ... SELECT masivo al final
  -- -- mismas reglas de negocio, mismos mensajes, mismo contrato jsonb de
  -- entrada/salida, mismo todo-o-nada e idempotencia -- solo cambia CÓMO
  -- se calculan.
  drop table if exists pg_temp.tmp_importar_filas;
  create temp table pg_temp.tmp_importar_filas as
  with base as (
    select
      coalesce((f->>'numero')::int, idx::int) as numero,
      trim(coalesce(f->>'nombre', '')) as nombre,
      trim(coalesce(f->>'codigo', '')) as codigo,
      lower(trim(coalesce(f->>'codigo', ''))) as codigo_lower,
      trim(coalesce(f->>'categoria', '')) as categoria_texto,
      trim(coalesce(f->>'unidad', '')) as unidad_texto,
      trim(coalesce(f->>'costo', '')) as costo_texto,
      trim(coalesce(f->>'precio', '')) as precio_texto,
      trim(coalesce(f->>'existencia', '')) as existencia_texto,
      lower(trim(coalesce(f->>'activo', ''))) as activo_texto,
      trim(coalesce(f->>'descripcion', '')) as descripcion_texto,
      trim(coalesce(f->>'nivel_minimo', '')) as nivel_minimo_texto,
      trim(coalesce(f->>'nivel_maximo', '')) as nivel_maximo_texto,
      trim(coalesce(f->>'proveedor', '')) as proveedor_texto,
      trim(coalesce(f->>'unidad_compra', '')) as unidad_compra_texto,
      trim(coalesce(f->>'factor_conversion_compra', '')) as factor_texto,
      lower(trim(coalesce(f->>'maneja_lotes', ''))) as maneja_lotes_texto,
      lower(trim(coalesce(f->>'destacado', ''))) as destacado_texto
    from jsonb_array_elements(p_filas) with ordinality as t(f, idx)
  ),
  resuelto as (
    select
      b.*,
      cat.id as categoria_id,
      uni.id as unidad_id,
      prov.id as proveedor_id,
      unic.id as unidad_compra_id,
      (b.costo_texto = '' or b.costo_texto ~ v_numero_regla) as costo_valido,
      (b.precio_texto ~ v_numero_regla) as precio_valido,
      (b.existencia_texto = '' or b.existencia_texto ~ v_numero_regla) as existencia_valido,
      (b.nivel_minimo_texto = '' or b.nivel_minimo_texto ~ v_numero_regla) as nivel_minimo_valido,
      (b.nivel_maximo_texto = '' or b.nivel_maximo_texto ~ v_numero_regla) as nivel_maximo_valido,
      (b.factor_texto ~ v_numero_regla and b.factor_texto::numeric > 0) as factor_valido,
      case when b.codigo_lower <> '' then count(*) over (partition by b.codigo_lower) else 1 end as veces_codigo_archivo,
      case when b.codigo_lower <> '' then min(b.numero) over (partition by b.codigo_lower) end as primer_numero_codigo
    from base b
    left join inventario.categoria_producto cat on b.categoria_texto <> '' and lower(cat.clave) = lower(b.categoria_texto)
    left join inventario.unidad_medida uni on b.unidad_texto <> '' and lower(uni.clave) = lower(b.unidad_texto)
    left join inventario.proveedor prov on b.proveedor_texto <> '' and lower(prov.nombre) = lower(b.proveedor_texto)
    left join inventario.unidad_medida unic on b.unidad_compra_texto <> '' and lower(unic.clave) = lower(b.unidad_compra_texto)
  )
  select
    r.*,
    case
      when r.nombre = '' then 'Falta el nombre.'
      when r.codigo_lower <> '' and r.veces_codigo_archivo > 1 and r.numero <> r.primer_numero_codigo
        then format('El código "%s" se repite dentro del mismo archivo (también en el renglón %s).', r.codigo, r.primer_numero_codigo)
      when r.categoria_id is null then format('La categoría "%s" no existe (revisa la Clave).', r.categoria_texto)
      when r.unidad_id is null then format('La unidad "%s" no existe (revisa la Clave).', r.unidad_texto)
      when not r.costo_valido then format('Costo inválido: "%s".', r.costo_texto)
      when r.precio_texto = '' then 'Falta el precio.'
      when not r.precio_valido then format('Precio inválido: "%s".', r.precio_texto)
      when not r.existencia_valido then format('Existencia inválida: "%s".', r.existencia_texto)
      when r.existencia_texto <> '' and r.nivel_minimo_texto <> '' and not r.nivel_minimo_valido
        then format('Nivel mínimo inválido: "%s".', r.nivel_minimo_texto)
      when r.existencia_texto <> '' and r.nivel_maximo_texto <> '' and not r.nivel_maximo_valido
        then format('Nivel máximo inválido: "%s".', r.nivel_maximo_texto)
      when r.proveedor_texto <> '' and r.proveedor_id is null
        then format('El proveedor "%s" no existe (coincide por Nombre, el proveedor no tiene Clave).', r.proveedor_texto)
      when r.unidad_compra_texto <> '' and r.unidad_compra_id is null
        then format('La unidad de compra "%s" no existe (revisa la Clave).', r.unidad_compra_texto)
      when r.unidad_compra_texto <> '' and r.factor_texto = ''
        then 'Falta "factor_conversion_compra" (a cuántas unidades base equivale la unidad de compra).'
      when r.unidad_compra_texto <> '' and not r.factor_valido
        then format('Factor de conversión inválido: "%s".', r.factor_texto)
      else null
    end as error_mensaje
  from resuelto r;

  select coalesce(jsonb_agg(jsonb_build_object('numero', numero, 'mensaje', error_mensaje) order by numero), '[]'::jsonb)
  into v_errores
  from pg_temp.tmp_importar_filas
  where error_mensaje is not null;

  -- Duplicado CONTRA el catálogo ya guardado (política: detener todo) --
  -- una sola consulta (usa producto_codigo_lower_ix), nunca el catálogo
  -- completo -- solo cuando el archivo ya quedó limpio arriba, igual que
  -- en la versión anterior.
  if v_errores = '[]'::jsonb then
    select coalesce(jsonb_agg(jsonb_build_object(
      'numero', f.numero,
      'mensaje', format('El código "%s" ya existe en el catálogo (producto #%s: %s).', f.codigo, p.id, p.nombre)
    ) order by f.numero), '[]'::jsonb)
    into v_errores
    from pg_temp.tmp_importar_filas f
    join inventario.producto p on lower(p.codigo) = f.codigo_lower
    where f.codigo_lower <> '';
  end if;

  if v_errores <> '[]'::jsonb then
    drop table if exists pg_temp.tmp_importar_filas;
    return jsonb_build_object(
      'operacionId', p_operacion_id, 'duplicada', false, 'ok', false,
      'totalFilas', v_total, 'productosCreados', 0, 'errores', v_errores, 'advertencias', '[]'::jsonb
    );
  end if;

  -- Advertencias (sección B): NO bloquean. En este punto TODOS los
  -- renglones son válidos (si alguno no lo fuera, ya habríamos regresado
  -- arriba), así que los casteos numéricos aquí son seguros.
  select coalesce(jsonb_agg(m order by numero), '[]'::jsonb) into v_advertencias
  from (
    select numero, 'Sin código -- no podrá buscarse por código de barras/QR en Cobro ni en Movimientos entre bodegas.' as m
    from pg_temp.tmp_importar_filas where codigo = ''
    union all
    select numero, format('El precio (%s) es menor que el costo (%s).',
      precio_texto::numeric,
      case when costo_texto = '' then 0 else costo_texto::numeric end
    ) as m
    from pg_temp.tmp_importar_filas
    where precio_texto::numeric < (case when costo_texto = '' then 0 else costo_texto::numeric end)
  ) a;

  if p_solo_validar then
    drop table if exists pg_temp.tmp_importar_filas;
    return jsonb_build_object(
      'operacionId', p_operacion_id, 'duplicada', false, 'ok', true,
      'totalFilas', v_total, 'productosCreados', 0, 'errores', '[]'::jsonb, 'advertencias', v_advertencias
    );
  end if;

  -- Validación 100% limpia -- un solo INSERT masivo (nunca uno por
  -- renglón), dentro de la misma transacción implícita de esta función
  -- (sección G: todo o nada). Nunca se modifica ni se borra ningún
  -- producto existente -- esta función SOLO inserta.
  insert into inventario.importacion_producto (id, total_filas, productos_creados)
  values (p_operacion_id, v_total, 0);

  insert into inventario.producto (
    nombre, codigo, categoria_producto_id, unidad_medida_id, descripcion, costo, precio_unitario,
    existencia, nivel_minimo, nivel_maximo, proveedor_id, unidad_compra_id, factor_conversion_compra,
    maneja_lotes, destacado, activo, importacion_id
  )
  select
    nombre,
    case when codigo = '' then null else codigo end,
    categoria_id,
    unidad_id,
    case when descripcion_texto = '' then null else descripcion_texto end,
    case when costo_texto = '' then 0 else costo_texto::numeric end,
    precio_texto::numeric,
    case when existencia_texto = '' then null else existencia_texto::numeric end,
    case when existencia_texto <> '' and nivel_minimo_texto <> '' then nivel_minimo_texto::numeric end,
    case when existencia_texto <> '' and nivel_maximo_texto <> '' then nivel_maximo_texto::numeric end,
    proveedor_id,
    unidad_compra_id,
    case when unidad_compra_texto <> '' then factor_texto::numeric end,
    (existencia_texto <> '') and not (maneja_lotes_texto = any (array['', 'no', 'false', '0'])),
    not (destacado_texto = any (array['', 'no', 'false', '0'])),
    not (activo_texto = any (array['no', 'false', '0'])),
    p_operacion_id
  from pg_temp.tmp_importar_filas;

  get diagnostics v_creados = row_count;
  update inventario.importacion_producto set productos_creados = v_creados where id = p_operacion_id;

  drop table if exists pg_temp.tmp_importar_filas;

  return jsonb_build_object(
    'operacionId', p_operacion_id, 'duplicada', false, 'ok', true,
    'totalFilas', v_total, 'productosCreados', v_creados, 'errores', '[]'::jsonb, 'advertencias', v_advertencias
  );
end;
$function$;

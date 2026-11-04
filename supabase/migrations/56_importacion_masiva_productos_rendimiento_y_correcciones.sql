-- supabase/migrations/56_importacion_masiva_productos_rendimiento_y_correcciones.sql
--
-- Migración incremental. NO recrea la tabla inventario.importacion_producto,
-- sus políticas RLS ni la columna/índice ya existentes de la migración 55
-- (esos ya están aplicados en producción). Esta migración:
--   1) agrega UN índice único nuevo sobre inventario.producto, y
--   2) reemplaza (CREATE OR REPLACE) la función
--      inventario.fn_importar_productos_masivo con la versión V3.
--
-- No borra ni modifica ningún producto existente. No cambia ninguna regla
-- de negocio ya decidida (todo o nada sin importar el tamaño; un solo
-- duplicado detiene TODA la importación; el SKU/código es único DENTRO de
-- cada empresa y puede repetirse entre empresas distintas).
--
-- ═══════════════════════════════════════════════════════════════════════
-- HISTORIAL DE ESTA FUNCIÓN EN ESTA SESIÓN DE AUDITORÍA (2026-11)
-- ═══════════════════════════════════════════════════════════════════════
--
-- V1 (ya vivía en producción antes de esta auditoría, sin archivo propio
--     en el repo -- esta migración 56 es la primera vez que queda
--     versionada): correcta en reglas de negocio, pero con una trampa de
--     rendimiento: acumulaba los JSON de errores/advertencias renglón por
--     renglón con `jsonb_valor || jsonb_build_object(...)` dentro de un
--     ciclo. Esa concatenación es O(N) POR LLAMADA (copia todo el jsonb
--     acumulado cada vez), así que acumular N renglones sale O(N²) en
--     total. Medido: ~50 segundos con 5,000 renglones.
--
-- V2 (primera corrección -- reescritura completa a O(N)):
--   - Toda la resolución de categoría/unidad/proveedor/unidad de compra y
--     toda la validación se calculan de una sola vez con una tabla
--     temporal + CTEs + funciones de ventana (count(*) OVER, min() OVER
--     para detectar códigos repetidos DENTRO del mismo archivo), en vez de
--     un ciclo por renglón.
--   - Los errores/advertencias se juntan con jsonb_agg(...), que es una
--     agregación en streaming O(N), no una concatenación O(N²).
--   - El INSERT final es UN solo "INSERT ... SELECT" masivo, no un ciclo
--     con un INSERT por renglón.
--   - Correcciones adicionales encontradas en la revisión de V2, antes de
--     que V2 llegara a producción (ninguna llegó a estar vivía con el
--     bug):
--       · Forma del JSON de advertencias: agregaba el mensaje suelto
--         (perdiendo el número de renglón) en vez de
--         {numero, mensaje} -- corregido.
--       · Blindaje de "factor_conversion_compra": cambiado de
--         `factor_texto ~ regla AND factor_texto::numeric > 0` (que ya
--         era seguro en la práctica por el corto-circuito de AND en
--         Postgres, pero no es una garantía tan explícita como un CASE) a
--         `CASE WHEN factor_texto ~ regla THEN factor_texto::numeric > 0
--         ELSE false END`, que nunca evalúa el cast si la condición no se
--         cumplió primero.
--   - V2 NUNCA llegó a desplegarse: los tres intentos de aplicar la
--     migración (una vez como apply_migration, dos veces como execute_sql
--     con DDL) se quedaron esperando una confirmación que nunca llegó y
--     expiraron a los 180 segundos. No se hizo ningún cambio en la base
--     de datos en ninguno de esos tres intentos (verificado leyendo
--     pg_get_functiondef y list_migrations después de cada uno).
--
-- V3 (esta versión -- segunda ronda de revisión, 7 puntos pedidos por el
--     usuario el 2026-11-04, ninguno de estos bugs había llegado nunca a
--     producción):
--   1. "numero" ya no se castea directo a entero -- antes
--      `(f->>'numero')::int` podía lanzar una excepción no controlada si
--      ese campo traía un valor no numérico. "numero" es una columna de
--      control que arma Angular (número de renglón, nunca la captura el
--      usuario), pero se blinda igual por defensa en profundidad, con el
--      mismo patrón de "regex antes del cast" que ya usaban costo, precio,
--      existencia, niveles y factor de conversión: si no cumple
--      `^\d{1,9}$` (entero no negativo, hasta 9 cifras -- cualquier
--      cantidad de renglones real cabe ahí sin riesgo de overflow en el
--      cast a int), se usa el número de posición dentro del archivo
--      (idx) en su lugar, igual que hacía el "coalesce" original cuando
--      "numero" venía ausente.
--   2. La tabla temporal gana "ON COMMIT DROP", además de los
--      "DROP TABLE IF EXISTS" / "DROP TABLE" que ya tenía antes de
--      crearla y antes de cada "return". Esto es refuerzo, no una
--      corrección de un bug real: el patrón anterior ya era seguro ante
--      conexiones reutilizadas por el pooler, porque el DDL en Postgres
--      es transaccional (un ROLLBACK de la llamada deshace también el
--      CREATE TEMP TABLE) y porque cada "return" ya limpiaba la tabla
--      antes de salir. "ON COMMIT DROP" es una tercera capa de seguridad
--      por si en el futuro se agrega algún otro punto de salida.
--   3. Confirmado por el usuario: el código (SKU) debe ser único DENTRO
--      de cada empresa, pudiendo repetirse entre empresas distintas. Se
--      verificó que la función es SECURITY INVOKER (no tiene
--      "security definer" en su definición), así que la política RLS
--      "solo_mi_empresa" de inventario.producto
--      (empresa_id = privado.empresa_actual_id()) ya filtra
--      automáticamente, con los privilegios del usuario que llama, tanto
--      la comparación contra productos existentes como el INSERT final.
--      No hizo falta ningún cambio de código para este punto -- solo se
--      deja constancia de la verificación.
--   4. Antes de crear el índice único se verificó en vivo, contra los
--      datos reales (2026-11-04):
--        · Cero duplicados de (empresa_id, lower(codigo)) entre los 27
--          productos que existen hoy.
--        · Cero productos con codigo NULL o cadena vacía entre esos 27
--          (los 27 tienen código real).
--      Con esos datos, el índice nuevo se puede crear hoy sin ninguna
--      limpieza previa. El índice es PARCIAL (excluye NULL y '') y usa
--      lower(codigo) -- mismo criterio de insensibilidad a mayúsculas que
--      ya usa el índice NO único "producto_codigo_lower_ix" (que ya
--      existe desde antes y esta migración NO toca ni elimina: queda
--      como índice de respaldo para búsquedas que no filtran por un
--      código real; se puede evaluar si es redundante en una migración
--      futura, por separado).
--   5. Se revisó productos.component.ts (guardar() -> alta/edición manual
--      vía DataClientService) y supabase-data-client.service.ts
--      (mensajeError(), case '23505'): el camino manual YA traduce
--      cualquier violación de índice único de Postgres al toast
--      "Ya existe un registro con esos datos." -- no se necesitó ningún
--      cambio en Angular. Con el índice nuevo de este archivo, los TRES
--      caminos (alta manual, edición manual e importación masiva) quedan
--      protegidos por la MISMA regla, a nivel de base de datos.
--   6. Se agrega manejo explícito de "unique_violation" (23505) en dos
--      puntos de la función, usando GET STACKED DIAGNOSTICS para
--      distinguir cuál restricción fue la que chocó:
--        a) Al reclamar p_operacion_id (choque contra
--           importacion_producto_pkey): dos solicitudes concurrentes con
--           el MISMO operacion_id (doble clic, reintento de red) que
--           ambas pasan la verificación inicial antes de que cualquiera
--           confirme. Antes de este cambio, la segunda recibía un error
--           crudo de Postgres; ahora se resuelve igual que el camino
--           feliz de idempotencia (duplicada: true), leyendo la fila que
--           la primera sí logró insertar.
--        b) Al insertar los productos (choque contra el índice nuevo
--           "producto_empresa_codigo_uniq"): dos importaciones con
--           operacion_id DISTINTOS que compiten por el mismo código
--           dentro de la misma empresa. La que pierde la carrera recibe
--           un mensaje claro en español y NO se crea ningún producto.
--           La transacción completa de esa llamada (incluyendo el
--           renglón de importacion_producto insertado en el punto "a" de
--           esa misma llamada) se revierte sola, porque la excepción se
--           vuelve a lanzar sin capturar y Postgres revierte TODA la
--           transacción de una llamada RPC cuando una excepción se
--           propaga sin capturar -- no hace falta ningún DELETE manual.
--           Esto preserva "todo o nada" también bajo esta carrera.
--   7. Este archivo completo no borra ni modifica ningún producto
--      existente, no cambia ninguna regla de negocio y NO se ejecuta
--      automáticamente -- queda pendiente de que el usuario lo pegue
--      manualmente en el SQL Editor de Supabase.

-- ───────────────────────────────────────────────────────────────────────
-- 1) Índice único nuevo: SKU único por empresa (no global), excluyendo
--    NULL y cadena vacía, insensible a mayúsculas/minúsculas.
-- ───────────────────────────────────────────────────────────────────────
create unique index if not exists producto_empresa_codigo_uniq
  on inventario.producto (empresa_id, lower(codigo))
  where codigo is not null and codigo <> '';

-- ───────────────────────────────────────────────────────────────────────
-- 2) Función V3 (reemplaza la versión V2 -- la que nunca llegó a
--    desplegarse -- de la migración 56 original).
-- ───────────────────────────────────────────────────────────────────────
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
  v_numero_regla text := '^\d+(\.\d+)?$';
  v_errores jsonb;
  v_advertencias jsonb;
  v_creados int := 0;
  v_restriccion text;
begin
  if p_operacion_id is null then
    raise exception 'Falta el identificador de operación (idempotencia).';
  end if;

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

  drop table if exists pg_temp.tmp_importar_filas;
  create temp table pg_temp.tmp_importar_filas on commit drop as
  with base as (
    select
      -- Punto 1: "numero" es una columna de control (número de renglón,
      -- 1 = encabezado) que arma Angular, no un dato que captura el
      -- usuario -- pero se blinda igual, con el mismo patrón de
      -- regex-antes-del-cast que ya usa el resto de las columnas
      -- numéricas de este archivo, para que un valor inesperado nunca
      -- lance una excepción no controlada aquí.
      coalesce(
        case when (f->>'numero') ~ '^\d{1,9}$' then (f->>'numero')::int else null end,
        idx::int
      ) as numero,
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
      (case when b.factor_texto ~ v_numero_regla then b.factor_texto::numeric > 0 else false end) as factor_valido,
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

  if v_errores = '[]'::jsonb then
    -- Punto 3/4: esta comparación no filtra empresa_id explícitamente --
    -- lo hace el RLS (policy "solo_mi_empresa"), porque la función es
    -- SECURITY INVOKER. Es el mismo criterio que ya usaba el resto de la
    -- función (ningún otro JOIN filtra empresa_id explícitamente
    -- tampoco).
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

  select coalesce(jsonb_agg(jsonb_build_object('numero', numero, 'mensaje', m) order by numero), '[]'::jsonb)
  into v_advertencias
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

  -- Punto 6a: reclama p_operacion_id. Si otra llamada concurrente con el
  -- MISMO operacion_id ya lo reclamó entre la verificación de arriba y
  -- este INSERT, choca contra importacion_producto_pkey -- se resuelve
  -- igual que el camino feliz de idempotencia (duplicada: true) en vez de
  -- propagar un error crudo de Postgres.
  begin
    insert into inventario.importacion_producto (id, total_filas, productos_creados)
    values (p_operacion_id, v_total, 0);
  exception
    when unique_violation then
      get stacked diagnostics v_restriccion = constraint_name;
      if v_restriccion = 'importacion_producto_pkey' then
        drop table if exists pg_temp.tmp_importar_filas;
        select * into v_existente from inventario.importacion_producto where id = p_operacion_id;
        return jsonb_build_object(
          'operacionId', p_operacion_id, 'duplicada', true, 'ok', true,
          'totalFilas', v_existente.total_filas, 'productosCreados', v_existente.productos_creados,
          'errores', '[]'::jsonb, 'advertencias', '[]'::jsonb
        );
      end if;
      raise;
  end;

  -- Punto 6b: dos importaciones con operacion_id DISTINTOS que compiten
  -- por el mismo código dentro de la misma empresa. La que pierde la
  -- carrera recibe un mensaje claro; la transacción completa de ESTA
  -- llamada (incluyendo el INSERT del punto 6a) se revierte sola al
  -- propagarse la excepción sin capturar -- no hace falta ningún DELETE
  -- manual, Postgres revierte toda la transacción de la llamada RPC.
  begin
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
  exception
    when unique_violation then
      get stacked diagnostics v_restriccion = constraint_name;
      if v_restriccion = 'producto_empresa_codigo_uniq' then
        raise exception 'Uno o más códigos de este archivo ya fueron registrados por otra importación o alta simultánea. No se creó ningún producto -- vuelve a intentar la importación.';
      end if;
      raise;
  end;

  get diagnostics v_creados = row_count;
  update inventario.importacion_producto set productos_creados = v_creados where id = p_operacion_id;

  drop table if exists pg_temp.tmp_importar_filas;

  return jsonb_build_object(
    'operacionId', p_operacion_id, 'duplicada', false, 'ok', true,
    'totalFilas', v_total, 'productosCreados', v_creados, 'errores', '[]'::jsonb, 'advertencias', v_advertencias
  );
end;
$function$;

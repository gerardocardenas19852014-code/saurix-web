-- ============================================================================
-- 57_importacion_masiva_existencia_siempre_cero.sql
--
-- PENDIENTE 2 ("Correcciones y mejoras pendientes", 2026-11) ampliado por el
-- propio usuario para incluir el importador masivo de Productos: un producto
-- nuevo debe iniciar SIEMPRE con existencia cero, sin excepción -- la única
-- forma de registrar existencia real pasa por Inventario → Movimientos entre
-- bodegas → Movimiento masivo (que escribe inventario.existencia_bodega,
-- nunca producto.existencia directo -- ver fn_registrar_movimiento_inventario
-- / fn_movimiento_masivo_registrar, confirmado leyendo su código: ninguna de
-- las dos toca producto.existencia).
--
-- Hasta esta migración, inventario.fn_importar_productos_masivo (ver
-- 56_importacion_masiva_productos_rendimiento_y_correcciones.sql) SÍ tomaba
-- el número de la columna "existencia" del CSV y lo escribía tal cual en
-- producto.existencia -- exactamente el mismo hueco que tenía el modal de
-- alta/edición de Productos (ya cerrado en Angular, sin migración: ver
-- productos.component.ts → guardar()). Eso podía volver a crear productos
-- "sin asignar" (existencia > 0 sin ninguna fila en existencia_bodega --
-- ver fn_movimientos_productos_sin_asignar) por esta vía, aunque el modal ya
-- no lo permitiera.
--
-- Qué cambia (y qué NO cambia) en fn_importar_productos_masivo:
--   - La columna "existencia" del CSV sigue siendo la única señal de si el
--     renglón es un producto físico (columna con número, aunque sea '0') o
--     un servicio (columna vacía) -- ESO no cambia, es la convención ya
--     documentada en descargarPlantilla() y en el comentario de
--     FilaImportacion. Lo que cambia es que, para un producto físico, el
--     número que de verdad se inserta en producto.existencia ya nunca es el
--     del archivo: siempre es 0, igual que ahora hace el alta manual.
--   - Si el archivo trae una existencia > 0 para un renglón, esa cantidad ya
--     NO se aplica -- la fila se sigue importando (nunca se bloquea por
--     esto, no es un "error"), pero se agrega una ADVERTENCIA visible en la
--     vista previa de Angular explicando que esa cantidad no se aplicó y
--     cómo registrarla después.
--   - nivel_minimo/nivel_maximo/maneja_lotes siguen exactamente igual
--     (dependen de si la columna existencia viene vacía o no, nunca del
--     número en sí -- eso no se tocó).
--   - Nada de la idempotencia (importacion_producto/p_operacion_id), el
--     procesamiento por lotes, ni la validación server-side existente se
--     modificó -- es el mismo cuerpo de función con dos cambios quirúrgicos
--     (uno en el bloque de advertencias, otro en el INSERT final).
--
-- No es una migración destructiva: no se borra ni se altera ningún dato ya
-- existente, solo CREATE OR REPLACE de la función. Auditado antes de
-- escribir esto: las 27 filas reales en producción vinieron TODAS de este
-- importador y las 27 ya están en existencia = 0 -- no hay ningún registro
-- heredado que regularizar.
-- ============================================================================

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

  -- PENDIENTE 2 (2026-11): tercera rama de advertencia -- avisa, sin
  -- bloquear, cuando el archivo trae una existencia > 0 que YA NO se va a
  -- aplicar (ver el INSERT final, más abajo). Solo corre sobre filas sin
  -- error, así que existencia_texto aquí ya es '' o un número válido --
  -- el cast a numeric es seguro.
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
    union all
    select numero, format(
      'La existencia (%s) de este renglón no se aplicó -- los productos nuevos siempre inician en 0. Regístrala después desde Inventario → Movimientos entre bodegas → Movimiento masivo.',
      existencia_texto
    ) as m
    from pg_temp.tmp_importar_filas
    where existencia_texto <> '' and existencia_texto::numeric > 0
  ) a;

  if p_solo_validar then
    drop table if exists pg_temp.tmp_importar_filas;
    return jsonb_build_object(
      'operacionId', p_operacion_id, 'duplicada', false, 'ok', true,
      'totalFilas', v_total, 'productosCreados', 0, 'errores', '[]'::jsonb, 'advertencias', v_advertencias
    );
  end if;

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
      -- PENDIENTE 2 (2026-11): la existencia del CSV ya NUNCA se aplica --
      -- un producto físico nuevo siempre entra en 0 (igual que el alta
      -- manual en productos.component.ts → guardar()); la columna solo
      -- sigue decidiendo si el renglón es "producto" (número, aunque sea
      -- '0') o "servicio" (vacío -- null). Ver la advertencia de arriba,
      -- que avisa cuando el archivo pedía algo distinto de 0.
      case when existencia_texto = '' then null else 0 end,
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

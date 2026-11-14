do $$
declare
  v_categoria_id bigint;
begin
  insert into inventario.categoria_producto (nombre, clave, empresa_id, activo)
  values ('[PRUEBA RENDIMIENTO] Categoría de prueba de carga (200,000 productos)', 'PRUEBA-RENDIMIENTO', 9, true)
  returning id into v_categoria_id;

  insert into inventario.producto (
    nombre, codigo, categoria_producto_id, unidad_medida_id,
    descripcion, costo, precio_unitario, existencia, nivel_minimo,
    empresa_id, activo
  )
  select
    '[PRUEBA RENDIMIENTO] Producto #' || n,
    'PRUEBA-' || lpad(n::text, 6, '0'),
    v_categoria_id,
    5, -- unidad_medida 'Pieza' (empresa 9)
    'Producto sintético de prueba de rendimiento — carga masiva para pruebas de estrés, no es inventario real.',
    round((random() * 90 + 10)::numeric, 2),  -- costo entre 10 y 100
    round((random() * 180 + 20)::numeric, 2), -- precio entre 20 y 200
    round((random() * 500)::numeric, 0),      -- existencia entre 0 y 500
    10,
    9,
    true
  from generate_series(1, 200000) as n;
end $$;
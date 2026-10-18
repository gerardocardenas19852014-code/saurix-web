-- =====================================================================
-- Saurix · Supabase · 37 Tienda pública: color de letra del banner
--  - El banner (ver 36_tienda_color_marca_y_destacados, colorAcento) pinta
--    el fondo con el color de marca, pero el texto (título/descripción)
--    queda fijo en blanco — con colores de marca claros (pastel) el texto
--    casi no se ve (reportado por el usuario). Se agrega un color de letra
--    opcional, independiente del color de fondo, con el mismo patrón
--    nullable = "usa el valor por defecto" que ya tiene color_acento.
-- =====================================================================
set check_function_bodies = off;

alter table seguridad.empresa
  add column color_texto_banner text;

-- Se reemplaza seguridad.tienda_detalle() para incluir colorTextoBanner —
-- mismo contrato anon/authenticated que ya tenía, no hace falta volver a
-- otorgar EXECUTE.
create or replace function seguridad.tienda_detalle(p_clave text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_empresa record;
  v_resultado jsonb;
begin
  select e.id, e.clave, e.nombre, e.descripcion_publica, e.telefono_pedidos, e.correo_pedidos, e.logo_publico,
         e.horario_atencion, e.metodos_pago, e.pedido_minimo, e.volver_pedir_activo, e.color_acento, e.color_texto_banner,
         e.envio_origen_lat, e.envio_origen_lng, e.envio_precio_km, e.envio_minimo, e.envio_distancia_maxima_km
    into v_empresa
    from seguridad.empresa e
    where e.clave = lower(trim(p_clave)) and e.activo and e.catalogo_publico_activo
    limit 1;

  if v_empresa.id is null then
    return null;
  end if;

  select jsonb_build_object(
    'empresa', jsonb_build_object(
      'clave', v_empresa.clave,
      'nombre', v_empresa.nombre,
      'descripcion', v_empresa.descripcion_publica,
      'telefono', v_empresa.telefono_pedidos,
      'correo', v_empresa.correo_pedidos,
      'logo', v_empresa.logo_publico,
      'horario', coalesce(v_empresa.horario_atencion, '[]'::jsonb),
      'metodosPago', coalesce(v_empresa.metodos_pago, '[]'::jsonb),
      'pedidoMinimo', v_empresa.pedido_minimo,
      'volverPedirActivo', v_empresa.volver_pedir_activo,
      'colorAcento', v_empresa.color_acento,
      'colorTextoBanner', v_empresa.color_texto_banner,
      'envioOrigenLat', v_empresa.envio_origen_lat,
      'envioOrigenLng', v_empresa.envio_origen_lng,
      'envioPrecioKm', v_empresa.envio_precio_km,
      'envioMinimo', v_empresa.envio_minimo,
      'envioDistanciaMaximaKm', v_empresa.envio_distancia_maxima_km
    ),
    'productos', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', pr.id,
          'nombre', pr.nombre,
          'descripcion', pr.descripcion,
          'precio', pr.precio_unitario,
          'foto', pr.foto,
          'disponible', (pr.existencia is null or pr.existencia > 0),
          'destacado', pr.destacado,
          'fechaCreacion', pr.fecha_creacion,
          'pocasExistencias', (
            pr.existencia is not null and pr.nivel_minimo is not null
            and pr.existencia > 0 and pr.existencia <= pr.nivel_minimo
          ),
          'categoriaId', cp.id,
          'categoriaNombre', cp.nombre,
          'opciones', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', g.id,
                'nombre', g.nombre,
                'tipoSeleccion', g.tipo_seleccion,
                'requerido', g.requerido,
                'minimo', g.minimo,
                'maximo', g.maximo,
                'valores', coalesce((
                  select jsonb_agg(
                    jsonb_build_object('id', v.id, 'nombre', v.nombre, 'precioAdicional', v.precio_adicional)
                    order by v.orden, v.id
                  )
                  from inventario.producto_opcion_valor v
                  where v.grupo_id = g.id and v.activo
                ), '[]'::jsonb)
              )
              order by g.orden, g.id
            )
            from inventario.producto_opcion_grupo g
            where g.producto_id = pr.id and g.activo
          ), '[]'::jsonb)
        )
        order by cp.nombre, pr.nombre
      ),
      '[]'::jsonb
    )
  )
  into v_resultado
  from inventario.producto pr
  join inventario.categoria_producto cp on cp.id = pr.categoria_producto_id
  where pr.empresa_id = v_empresa.id and pr.activo;

  return v_resultado;
end;
$$;

revoke all on function seguridad.tienda_detalle(text) from public;
grant execute on function seguridad.tienda_detalle(text) to anon, authenticated;

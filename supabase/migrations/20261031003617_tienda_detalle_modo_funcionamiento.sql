
create or replace function seguridad.tienda_detalle(p_clave text)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  v_empresa record;
begin
  select e.id, e.clave, e.nombre, e.descripcion_publica, e.telefono_pedidos, e.correo_pedidos, e.logo_url,
         e.horario_atencion, e.metodos_pago, e.pedido_minimo, e.volver_pedir_activo, e.color_acento, e.color_texto_banner,
         e.envio_origen_lat, e.envio_origen_lng, e.envio_precio_km, e.envio_minimo, e.envio_distancia_maxima_km,
         e.modo_tienda,
         e.envio_propio_activo, e.envio_propio_pedido_minimo, e.recoleccion_activa, e.direccion_publica,
         e.envio_plataforma_activo, e.envio_plataforma_negocio_solicita, e.envio_plataforma_cliente_solicita
    into v_empresa
    from seguridad.empresa e
    where e.clave = lower(trim(p_clave)) and e.activo and e.catalogo_publico_activo
    limit 1;

  if v_empresa.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'empresa', jsonb_build_object(
      'clave', v_empresa.clave,
      'nombre', v_empresa.nombre,
      'descripcion', v_empresa.descripcion_publica,
      'telefono', v_empresa.telefono_pedidos,
      'correo', v_empresa.correo_pedidos,
      'logo', v_empresa.logo_url,
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
      'envioDistanciaMaximaKm', v_empresa.envio_distancia_maxima_km,
      'modo', v_empresa.modo_tienda,
      'envioPropioActivo', v_empresa.envio_propio_activo,
      'envioPropioPedidoMinimo', v_empresa.envio_propio_pedido_minimo,
      'recoleccionActiva', v_empresa.recoleccion_activa,
      'direccionPublica', v_empresa.direccion_publica,
      'envioPlataformaActivo', v_empresa.envio_plataforma_activo,
      'envioPlataformaNegocioSolicita', v_empresa.envio_plataforma_negocio_solicita,
      'envioPlataformaClienteSolicita', v_empresa.envio_plataforma_cliente_solicita
    )
  );
end;
$function$;

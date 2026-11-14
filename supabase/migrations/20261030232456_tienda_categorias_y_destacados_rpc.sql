
create or replace function seguridad.fn_tienda_categorias(p_clave text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre) order by c.nombre), '[]'::jsonb)
  from (
    select distinct cp.id, cp.nombre
    from inventario.producto pr
    join inventario.categoria_producto cp on cp.id = pr.categoria_producto_id
    join seguridad.empresa e on e.id = pr.empresa_id
    where e.clave = lower(trim(p_clave)) and e.activo and e.catalogo_publico_activo
      and pr.activo
  ) c;
$function$;

create or replace function seguridad.fn_tienda_destacados(p_clave text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with base as (
    select
      pr.id, pr.nombre, pr.descripcion, pr.precio_unitario as precio, pr.destacado, pr.fecha_creacion,
      cp.id as categoria_id, cp.nombre as categoria_nombre,
      pr.foto_thumb_url, pr.foto_detalle_url,
      coalesce(per.existencia_total, pr.existencia) as existencia_resuelta,
      pr.nivel_minimo
    from inventario.producto pr
    join inventario.categoria_producto cp on cp.id = pr.categoria_producto_id
    join seguridad.empresa e on e.id = pr.empresa_id
    left join inventario.existencia_producto_resumen per on per.producto_id = pr.id
    where e.clave = lower(trim(p_clave)) and e.activo and e.catalogo_publico_activo
      and pr.activo and pr.destacado
    order by cp.nombre, pr.nombre
    limit 20
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'nombre', b.nombre, 'descripcion', b.descripcion, 'precio', b.precio,
    'fotoThumbUrl', b.foto_thumb_url, 'fotoDetalleUrl', b.foto_detalle_url,
    'disponible', (b.existencia_resuelta is null or b.existencia_resuelta > 0),
    'destacado', b.destacado, 'fechaCreacion', b.fecha_creacion,
    'pocasExistencias', (b.existencia_resuelta is not null and b.nivel_minimo is not null
      and b.existencia_resuelta > 0 and b.existencia_resuelta <= b.nivel_minimo),
    'categoriaId', b.categoria_id, 'categoriaNombre', b.categoria_nombre,
    'opciones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id, 'nombre', g.nombre, 'tipoSeleccion', g.tipo_seleccion, 'requerido', g.requerido,
        'minimo', g.minimo, 'maximo', g.maximo,
        'valores', coalesce((
          select jsonb_agg(jsonb_build_object('id', v.id, 'nombre', v.nombre, 'precioAdicional', v.precio_adicional) order by v.orden, v.id)
          from inventario.producto_opcion_valor v where v.grupo_id = g.id and v.activo
        ), '[]'::jsonb)
      ) order by g.orden, g.id)
      from inventario.producto_opcion_grupo g where g.producto_id = b.id and g.activo
    ), '[]'::jsonb)
  )), '[]'::jsonb)
  from base b;
$function$;

-- tienda_detalle() deja de traer el catálogo completo (eso ahora lo cubren
-- fn_catalogo_tienda_pagina/fn_tienda_categorias/fn_tienda_destacados) —
-- conserva exactamente la misma config de empresa que ya tenía, solo
-- cambia logo_publico (base64) por logo_url (Storage).
create or replace function seguridad.tienda_detalle(p_clave text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_empresa record;
begin
  select e.id, e.clave, e.nombre, e.descripcion_publica, e.telefono_pedidos, e.correo_pedidos, e.logo_url,
         e.horario_atencion, e.metodos_pago, e.pedido_minimo, e.volver_pedir_activo, e.color_acento, e.color_texto_banner,
         e.envio_origen_lat, e.envio_origen_lng, e.envio_precio_km, e.envio_minimo, e.envio_distancia_maxima_km,
         e.catalogo_publico_acepta_pedidos,
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
      'aceptaPedidos', v_empresa.catalogo_publico_acepta_pedidos,
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

-- =====================================================================
-- Saurix · Supabase · 43 Tienda pública: modalidades de entrega
--  - Hasta ahora la tienda solo sabía hacer "envío por distancia" (ver
--    migración 33). El usuario pidió poder ofrecer, por negocio, hasta
--    3 modalidades configurables en el paso "Entrega":
--      1. Envío del negocio   — la lógica de GPS/distancia/tarifa de la
--         migración 33, SIN TOCAR (se reutiliza tal cual), ahora detrás
--         de un interruptor para poder apagarla temporalmente sin borrar
--         la configuración de precio/origen.
--      2. Pasar a recoger     — sin GPS, sin costo, se muestra la
--         dirección/horario del negocio.
--      3. Envío por plataforma — NO se integra ninguna API externa (Uber/
--         inDrive/etc.) ni se inventa tarifa; la tienda solo prepara la
--         información (ubicación/referencias) para que el negocio cotice
--         el repartidor aparte. Tiene 2 variantes independientes
--         (pueden activarse una, otra o las dos): el negocio lo solicita,
--         o el cliente solicita el suyo.
--  - envio_propio_activo: apaga/prende TEMPORALMENTE el envío ya
--    configurado en la migración 33 (esa configuración de precio/origen
--    NO se borra, solo se deja de ofrecer). Default true para que
--    ninguna tienda que YA usa envío por distancia (p.ej. La Reyna de
--    los Bolis) cambie de comportamiento con esta migración.
--  - envio_propio_pedido_minimo: mínimo de SUBTOTAL de productos (antes
--    del costo de envío) para poder elegir "Envío del negocio" — distinto
--    del "pedido_minimo" general (migración 27, que bloquea CUALQUIER
--    modalidad). Null = sin mínimo específico de envío propio (default:
--    no cambia tiendas existentes).
--  - envio_distancia_maxima_km (migración 33) se REUTILIZA tal cual para
--    la regla nueva de "fuera de zona" — no se duplica ni se toca su
--    columna, solo cambia cómo la interpreta el frontend.
--  - recoleccion_activa + direccion_publica: "Pasar a recoger" se apoya
--    en el nombre/horario que la tienda ya expone; direccion_publica es
--    el único campo nuevo de texto (no existía ninguna dirección legible
--    para humanos, solo lat/lng de envío). Default false: ninguna tienda
--    existente empieza a ofrecer recolección sin que el dueño lo prenda.
--  - envio_plataforma_*: activo + las 2 variantes (negocio solicita /
--    cliente solicita). Default false/false (plataforma apagada) y, si
--    se prende, negocio_solicita arranca en true (la variante más común)
--    para que no quede sin ninguna variante seleccionada por accidente.
-- =====================================================================
set check_function_bodies = off;

alter table seguridad.empresa
  add column envio_propio_activo                 boolean not null default true,
  add column envio_propio_pedido_minimo           numeric(14,2),
  add column recoleccion_activa                   boolean not null default false,
  add column direccion_publica                    text,
  add column envio_plataforma_activo              boolean not null default false,
  add column envio_plataforma_negocio_solicita    boolean not null default true,
  add column envio_plataforma_cliente_solicita    boolean not null default false;

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
      'envioDistanciaMaximaKm', v_empresa.envio_distancia_maxima_km,
      'aceptaPedidos', v_empresa.catalogo_publico_acepta_pedidos,
      'envioPropioActivo', v_empresa.envio_propio_activo,
      'envioPropioPedidoMinimo', v_empresa.envio_propio_pedido_minimo,
      'recoleccionActiva', v_empresa.recoleccion_activa,
      'direccionPublica', v_empresa.direccion_publica,
      'envioPlataformaActivo', v_empresa.envio_plataforma_activo,
      'envioPlataformaNegocioSolicita', v_empresa.envio_plataforma_negocio_solicita,
      'envioPlataformaClienteSolicita', v_empresa.envio_plataforma_cliente_solicita
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

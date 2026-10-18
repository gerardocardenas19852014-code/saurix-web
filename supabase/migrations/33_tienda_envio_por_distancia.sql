-- =====================================================================
-- Saurix · Supabase · 33 Tienda pública: envío calculado por distancia
--  - El usuario pidió poder cobrar el envío según los kilómetros entre el
--    negocio y el cliente. Se eligió el modelo más simple: precio por km
--    en línea recta (sin contratar ningún servicio externo de mapas),
--    con un cargo mínimo opcional y un radio máximo de entrega opcional.
--    El cálculo de distancia (fórmula de Haversine) se hace en el
--    navegador del cliente, usando la ubicación GPS que YA comparte en
--    el modal de envío (ver ubicacion() en catalogo-tienda.component.ts)
--    contra el punto de origen del negocio guardado aquí.
--  - envio_origen_lat/lng: dónde está el negocio (null = envío por
--    distancia desactivado — ni se muestra en la tienda).
--  - envio_precio_km: costo por cada km de distancia; null/0 junto con
--    lo anterior = desactivado.
--  - envio_minimo: cargo mínimo de envío aunque la distancia sea corta;
--    null = sin mínimo (se cobra el cálculo exacto, por chico que sea).
--  - envio_distancia_maxima_km: radio de entrega; null = sin límite. Si
--    el cliente está más lejos, la tienda se lo advierte (no lo bloquea:
--    la empresa de todas formas valida el pedido a mano).
-- =====================================================================
set check_function_bodies = off;

alter table seguridad.empresa
  add column envio_origen_lat         numeric(10,6),
  add column envio_origen_lng         numeric(10,6),
  add column envio_precio_km          numeric(14,2),
  add column envio_minimo             numeric(14,2),
  add column envio_distancia_maxima_km numeric(10,2);

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
         e.horario_atencion, e.metodos_pago, e.pedido_minimo,
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

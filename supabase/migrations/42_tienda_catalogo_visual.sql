-- =====================================================================
-- Saurix · Supabase · 42 Tienda pública: "menú visual" (solo informativo)
--  - Idea del usuario: un menú digital con acceso por QR, reutilizando la
--    tienda pública ya existente (27_tienda_publica.sql en adelante), pero
--    para negocios que NO toman pedidos en línea — solo quieren mostrar su
--    catálogo/menú de forma atractiva. El QR ya existe (ver
--    "compartir tienda" en catalogo-tienda.component.ts), así que basta con
--    un interruptor por empresa que apague el carrito/envío de pedido.
--  - Default true: las empresas que YA tienen su tienda activa (catálogo
--    con pedidos) siguen exactamente igual, sin tener que tocar nada.
-- =====================================================================
set check_function_bodies = off;

alter table seguridad.empresa
  add column catalogo_publico_acepta_pedidos boolean not null default true;

-- Se reemplaza seguridad.tienda_detalle() para incluir aceptaPedidos — mismo
-- contrato anon/authenticated que ya tenía, no hace falta volver a otorgar
-- EXECUTE.
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
         e.catalogo_publico_acepta_pedidos
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
      'aceptaPedidos', v_empresa.catalogo_publico_acepta_pedidos
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

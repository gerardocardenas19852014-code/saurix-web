-- =====================================================================
-- Saurix · Supabase · 32 Tienda pública: horario de atención, métodos de
-- pago y pedido mínimo
--  - El usuario pidió 3 mejoras a /tienda: mostrar si el negocio está
--    "abierto ahora" según un horario que configure, mostrar qué métodos
--    de pago acepta, y poder exigir un pedido mínimo. Las 3 son texto
--    opcional/estructurado que vive en seguridad.empresa (igual patrón
--    que descripcion_publica/telefono_pedidos de la migración 27) y se
--    agregan al jsonb que ya arma seguridad.tienda_detalle().
--  - horario_atencion: jsonb con un arreglo de hasta 7 días
--    ({dia: 0-6 (0=domingo, igual que Date.getDay() en JS), abre: "HH:MM",
--    cierra: "HH:MM", cerrado: boolean}) — null/'[]' = sin horario
--    configurado, el frontend simplemente no muestra el badge de
--    abierto/cerrado en ese caso. El cálculo de "abierto ahora" se hace
--    en el navegador (con la hora local del cliente), no aquí.
--  - metodos_pago: jsonb con un arreglo de texto libre (p.ej.
--    ["Efectivo","Transferencia"]) — sin catálogo cerrado, mismo criterio
--    que ventas.venta.canal.
--  - pedido_minimo: numeric; null o 0 = sin mínimo.
-- =====================================================================
set check_function_bodies = off;

alter table seguridad.empresa
  add column horario_atencion jsonb,
  add column metodos_pago    jsonb,
  add column pedido_minimo   numeric(14,2);

-- Se reemplaza seguridad.tienda_detalle() para incluir los 3 campos
-- nuevos en el objeto "empresa" del jsonb — mismo contrato anon/
-- authenticated que ya tenía (ver 28_tienda_publica_fix_grants.sql y
-- 29_tienda_publica_categoria.sql), no hace falta volver a otorgar
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
         e.horario_atencion, e.metodos_pago, e.pedido_minimo
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
      'pedidoMinimo', v_empresa.pedido_minimo
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

-- Bloque F — Homologación Ventas/Cobro: atomicidad del registro de venta.
--
-- Reemplaza la secuencia actual de ~15 llamadas sueltas de
-- VentaService.registrar()/cancelar() (Venta + N VentaItem + N movimientos
-- de inventario + N VentaPago + CuentaPorCobrar + puntos de lealtad, cada
-- una un round-trip HTTP independiente) por dos funciones transaccionales,
-- mismo patrón ya usado en inventario.fn_orden_compra_guardar: todo o nada,
-- Postgres revierte TODO si cualquier paso falla a mitad.
--
-- SECURITY INVOKER (default, igual que fn_orden_compra_guardar): se apoya
-- en las políticas RLS ya existentes de cada tabla — no se usa SECURITY
-- DEFINER en ningún momento.

create or replace function ventas.fn_venta_registrar(
  p_turno_caja_id bigint,
  p_cliente_id bigint,
  p_vendedor_usuario_id bigint,
  p_notas text,
  p_canal text,
  p_lineas jsonb,
  p_pagos jsonb,
  p_puntos_a_canjear integer
)
returns bigint
language plpgsql
set search_path to ''
as $function$
declare
  v_empresa_id bigint := privado.empresa_actual_id();
  v_turno ventas.turno_caja;
  v_cliente ventas.cliente;
  v_config ventas.configuracion_lealtad;
  v_linea jsonb;
  v_pago jsonb;
  v_folio text;
  v_venta_id bigint;
  v_fecha timestamptz := now();
  v_subtotal numeric := 0;
  v_descuento_lineas numeric := 0;
  v_puntos_a_canjear integer := greatest(0, coalesce(p_puntos_a_canjear, 0));
  v_descuento_puntos numeric := 0;
  v_descuento numeric;
  v_total numeric;
  v_programa_activo boolean := false;
  v_pesos_por_punto numeric := 0;
  v_pesos_descuento_por_punto numeric := 0;
  v_puntos_ganados integer;
  v_cantidad numeric;
  v_producto_id bigint;
  v_bodega_id bigint;
  v_monto numeric;
  v_metodo_pago text;
begin
  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then
    raise exception 'La venta necesita al menos un renglón.';
  end if;
  if p_pagos is null or jsonb_array_length(p_pagos) = 0 then
    raise exception 'La venta necesita al menos un pago.';
  end if;

  select * into v_turno from ventas.turno_caja where id = p_turno_caja_id and empresa_id = v_empresa_id;
  if v_turno.id is null then
    raise exception 'Turno de caja % no encontrado o no pertenece a esta empresa.', p_turno_caja_id;
  end if;
  if v_turno.estado <> 'Abierto' then
    raise exception 'El turno de caja % ya está cerrado.', p_turno_caja_id;
  end if;

  select * into v_cliente from ventas.cliente where id = p_cliente_id and empresa_id = v_empresa_id;
  if v_cliente.id is null then
    raise exception 'Cliente % no encontrado o no pertenece a esta empresa.', p_cliente_id;
  end if;

  select
    coalesce(sum((l->>'cantidad')::numeric * (l->>'precio_unitario')::numeric), 0),
    coalesce(sum((l->>'cantidad')::numeric * (l->>'precio_unitario')::numeric * (l->>'descuento_pct')::numeric / 100), 0)
  into v_subtotal, v_descuento_lineas
  from jsonb_array_elements(p_lineas) l;

  select * into v_config from ventas.configuracion_lealtad where empresa_id = v_empresa_id limit 1;
  if v_config.id is not null then
    v_programa_activo := v_config.programa_activo;
    v_pesos_por_punto := v_config.pesos_por_punto;
    v_pesos_descuento_por_punto := v_config.pesos_descuento_por_punto;
  end if;

  if not v_programa_activo or v_cliente.es_generico then
    v_puntos_a_canjear := 0;
  end if;
  if v_puntos_a_canjear > 0 then
    v_descuento_puntos := least(round(v_puntos_a_canjear * v_pesos_descuento_por_punto, 2), v_subtotal - v_descuento_lineas);
  end if;

  v_descuento := v_descuento_lineas + v_descuento_puntos;
  v_total := v_subtotal - v_descuento;

  perform pg_advisory_xact_lock(hashtext('ventas.venta.folio:' || v_empresa_id::text));
  select 'VTA-' || lpad((coalesce(max(nullif(regexp_replace(folio, '[^0-9]', '', 'g'), ''))::int, 0) + 1)::text, 4, '0')
    into v_folio
    from ventas.venta
    where empresa_id = v_empresa_id;

  insert into ventas.venta
    (folio, fecha, turno_caja_id, cliente_id, vendedor_usuario_id, subtotal, descuento, total, estado, notas, canal, activo)
  values
    (v_folio, v_fecha, p_turno_caja_id, p_cliente_id, p_vendedor_usuario_id, v_subtotal, v_descuento, v_total, 'Completada', p_notas, nullif(trim(p_canal), ''), true)
  returning id into v_venta_id;

  for v_linea in select * from jsonb_array_elements(p_lineas)
  loop
    v_producto_id := case when v_linea->>'producto_id' is null then null else (v_linea->>'producto_id')::bigint end;
    v_bodega_id := case when v_linea->>'bodega_id' is null then null else (v_linea->>'bodega_id')::bigint end;
    v_cantidad := (v_linea->>'cantidad')::numeric;

    insert into ventas.venta_item
      (venta_id, producto_id, descripcion, cantidad, precio_unitario, descuento_pct, subtotal, bodega_id, activo)
    values (
      v_venta_id,
      v_producto_id,
      v_linea->>'descripcion',
      v_cantidad,
      (v_linea->>'precio_unitario')::numeric,
      (v_linea->>'descuento_pct')::numeric,
      v_cantidad * (v_linea->>'precio_unitario')::numeric * (1 - (v_linea->>'descuento_pct')::numeric / 100),
      v_bodega_id,
      true
    );

    if v_producto_id is not null and v_bodega_id is not null then
      perform inventario.fn_registrar_movimiento_inventario(
        v_producto_id, v_bodega_id, null, v_cantidad, 'Venta ' || v_folio, null, null
      );
    end if;
  end loop;

  for v_pago in select * from jsonb_array_elements(p_pagos)
  loop
    v_metodo_pago := v_pago->>'metodo_pago';
    v_monto := (v_pago->>'monto')::numeric;

    insert into ventas.venta_pago
      (venta_id, metodo_pago, monto, monto_recibido, cambio, activo)
    values (
      v_venta_id,
      v_metodo_pago,
      v_monto,
      case when v_pago->>'monto_recibido' is null then null else (v_pago->>'monto_recibido')::numeric end,
      case when v_pago->>'cambio' is null then null else (v_pago->>'cambio')::numeric end,
      true
    );

    if v_metodo_pago = 'Crédito' then
      insert into ventas.cuenta_por_cobrar
        (venta_id, cliente_id, fecha, monto_original, saldo_pendiente, estado, activo)
      values (v_venta_id, p_cliente_id, v_fecha, v_monto, v_monto, 'Pendiente', true);
    end if;
  end loop;

  if v_puntos_a_canjear > 0 then
    insert into ventas.movimiento_puntos_cliente (cliente_id, fecha, puntos, tipo, venta_id, activo)
    values (p_cliente_id, v_fecha, -v_puntos_a_canjear, 'Canjeado', v_venta_id, true);

    update ventas.cliente set puntos_acumulados = greatest(0, puntos_acumulados - v_puntos_a_canjear)
      where id = p_cliente_id;
  end if;

  if not v_cliente.es_generico then
    v_puntos_ganados := case when v_programa_activo and v_pesos_por_punto > 0 then floor(v_total / v_pesos_por_punto)::int else 0 end;
    if v_puntos_ganados > 0 then
      insert into ventas.movimiento_puntos_cliente (cliente_id, fecha, puntos, tipo, venta_id, activo)
      values (p_cliente_id, v_fecha, v_puntos_ganados, 'Ganado', v_venta_id, true);

      update ventas.cliente set puntos_acumulados = puntos_acumulados + v_puntos_ganados
        where id = p_cliente_id;
    end if;
  end if;

  return v_venta_id;
end;
$function$;

grant execute on function ventas.fn_venta_registrar(bigint, bigint, bigint, text, text, jsonb, jsonb, integer) to authenticated;


create or replace function ventas.fn_venta_cancelar(p_venta_id bigint)
returns bigint
language plpgsql
set search_path to ''
as $function$
declare
  v_empresa_id bigint := privado.empresa_actual_id();
  v_venta ventas.venta;
  v_item ventas.venta_item;
  v_mov ventas.movimiento_puntos_cliente;
  v_con_abono boolean;
begin
  select * into v_venta from ventas.venta where id = p_venta_id and empresa_id = v_empresa_id;
  if v_venta.id is null then
    raise exception 'Venta % no encontrada o no pertenece a esta empresa.', p_venta_id;
  end if;
  if v_venta.estado = 'Cancelada' then
    return v_venta.id;
  end if;

  select exists (
    select 1 from ventas.cuenta_por_cobrar
    where venta_id = p_venta_id
      and (estado <> 'Pendiente' or saldo_pendiente < monto_original - 0.01)
  ) into v_con_abono;
  if v_con_abono then
    raise exception 'Esta venta ya tiene abonos registrados a su cuenta por cobrar — no se puede cancelar.';
  end if;

  for v_item in select * from ventas.venta_item where venta_id = p_venta_id
  loop
    if v_item.producto_id is not null and v_item.bodega_id is not null then
      perform inventario.fn_registrar_movimiento_inventario(
        v_item.producto_id, null, v_item.bodega_id, v_item.cantidad, 'Cancelación de venta ' || v_venta.folio, null, null
      );
    end if;
  end loop;

  update ventas.cuenta_por_cobrar set saldo_pendiente = 0, estado = 'Cancelada'
    where venta_id = p_venta_id and estado = 'Pendiente';

  for v_mov in select * from ventas.movimiento_puntos_cliente where venta_id = p_venta_id and activo
  loop
    insert into ventas.movimiento_puntos_cliente (cliente_id, fecha, puntos, tipo, venta_id, activo)
    values (v_mov.cliente_id, now(), -v_mov.puntos, 'Reversado', p_venta_id, true);

    update ventas.cliente set puntos_acumulados = greatest(0, puntos_acumulados - v_mov.puntos)
      where id = v_mov.cliente_id;
  end loop;

  update ventas.venta set estado = 'Cancelada' where id = p_venta_id;

  return v_venta.id;
end;
$function$;

grant execute on function ventas.fn_venta_cancelar(bigint) to authenticated;

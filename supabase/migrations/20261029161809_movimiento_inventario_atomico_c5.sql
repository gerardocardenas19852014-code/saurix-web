
-- BLOQUE C.5: actualizacion atomica de inventario.
-- Reemplaza, solo para el modo Supabase, el read-modify-write no atomico de
-- MovimientoInventarioService (list() + calculo en JS + modificacion()) por
-- una sola llamada RPC que hace todo en una transaccion de Postgres.
-- SECURITY INVOKER (no DEFINER): el que escribe es el usuario real sobre su
-- propia empresa, exactamente como ya ocurre hoy con cada PATCH/POST directo
-- via PostgREST. privado.empresa_actual_id() (el DEFAULT de empresa_id) y las
-- politicas RLS de solo_mi_empresa dependen de la sesion de quien llama, que
-- con SECURITY DEFINER se perderia (pasaria a evaluarse con la sesion del
-- dueño de la funcion, no la del usuario real) -- INVOKER es obligatorio aqui,
-- no una preferencia de estilo. Mismo patron ya usado por el resto de
-- funciones RPC de inventario (fn_valor_stock_resumen, fn_kardex_*, etc.):
-- sin REVOKE explicito, protegidas por RLS, no por privilegios de EXECUTE.

create or replace function inventario.fn_registrar_movimiento_inventario(
  p_producto_id bigint,
  p_bodega_origen_id bigint,
  p_bodega_destino_id bigint,
  p_cantidad numeric,
  p_nota text,
  p_orden_compra_id bigint,
  p_costo_unitario numeric
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  -- Origen: solo resta si YA existe una fila para ese producto+bodega --
  -- preserva exactamente el comportamiento actual (si no existe, no pasa
  -- nada; no se crea una fila con existencia negativa).
  if p_bodega_origen_id is not null then
    update inventario.existencia_bodega
    set existencia = existencia - p_cantidad
    where producto_id = p_producto_id and bodega_id = p_bodega_origen_id;
  end if;

  -- Destino: suma si existe, crea la fila si no -- atomico por el
  -- ON CONFLICT, sin necesidad de un SELECT previo.
  if p_bodega_destino_id is not null then
    insert into inventario.existencia_bodega (producto_id, bodega_id, existencia, ubicacion)
    values (p_producto_id, p_bodega_destino_id, p_cantidad, null)
    on conflict (producto_id, bodega_id)
    do update set existencia = inventario.existencia_bodega.existencia + excluded.existencia;
  end if;

  insert into inventario.movimiento_inventario (
    producto_id, bodega_origen_id, bodega_destino_id, cantidad, nota,
    orden_compra_id, costo_unitario, en_transito, fecha_recepcion
  ) values (
    p_producto_id, p_bodega_origen_id, p_bodega_destino_id, p_cantidad, p_nota,
    p_orden_compra_id, p_costo_unitario, false, null
  );
end;
$function$;

create or replace function inventario.fn_enviar_en_transito(
  p_producto_id bigint,
  p_bodega_origen_id bigint,
  p_bodega_destino_id bigint,
  p_cantidad numeric,
  p_nota text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if p_bodega_origen_id is not null then
    update inventario.existencia_bodega
    set existencia = existencia - p_cantidad
    where producto_id = p_producto_id and bodega_id = p_bodega_origen_id;
  end if;

  insert into inventario.movimiento_inventario (
    producto_id, bodega_origen_id, bodega_destino_id, cantidad, nota,
    orden_compra_id, costo_unitario, en_transito, fecha_recepcion
  ) values (
    p_producto_id, p_bodega_origen_id, p_bodega_destino_id, p_cantidad, p_nota,
    null, null, true, null
  );
end;
$function$;

create or replace function inventario.fn_confirmar_recepcion_transito(p_movimiento_id bigint)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_mov inventario.movimiento_inventario;
begin
  select * into v_mov
  from inventario.movimiento_inventario
  where id = p_movimiento_id
  for update;

  if v_mov.id is null or not v_mov.en_transito or v_mov.bodega_destino_id is null then
    return;
  end if;

  insert into inventario.existencia_bodega (producto_id, bodega_id, existencia, ubicacion)
  values (v_mov.producto_id, v_mov.bodega_destino_id, v_mov.cantidad, null)
  on conflict (producto_id, bodega_id)
  do update set existencia = inventario.existencia_bodega.existencia + excluded.existencia;

  update inventario.movimiento_inventario
  set en_transito = false, fecha_recepcion = now()
  where id = p_movimiento_id;
end;
$function$;


-- Bloque G del plan "Menú + Mi orden": estados, expiración, concurrencia.

-- 1) Nuevo estado 'Expirado' (exclusivo de origen='menu_qr', ver
--    fn_expirar_ordenes_menu_qr) — se reutilizan Pendiente/Confirmado/
--    Descartado tal cual ya existían, solo se agrega el que hacía falta.
do $$
begin
  alter table ventas.pedido_tienda drop constraint pedido_tienda_estado_check;
  alter table ventas.pedido_tienda add constraint pedido_tienda_estado_check
    check (estado = any (array['Pendiente','Confirmado','Descartado','Expirado']));
end
$$;

-- 2) Columnas de "reclamo" (adjudicación atómica) — ORTOGONALES a estado:
--    un pedido sigue 'Pendiente' mientras alguien lo tiene cargado en su
--    Cobro, hasta que de verdad se cobra (o se libera/expira el reclamo).
--    Así "cargar a venta" nunca cambia el estado visible en la bandeja,
--    solo bloquea que OTRA caja lo cargue al mismo tiempo.
alter table ventas.pedido_tienda
  add column if not exists reclamado_por bigint references seguridad.usuario(id),
  add column if not exists reclamado_en timestamptz;

-- 3) Reclamo atómico — UPDATE ... WHERE estado='Pendiente' AND (nadie más
--    lo tiene reclamado hace <5 min) ... RETURNING id: solo UNA transacción
--    concurrente puede ganar esta condición (MVCC/row lock de Postgres),
--    nunca se decide en Angular. Reclamar de nuevo el mismo pedido (p.ej.
--    recargar Cobro) es idempotente para el mismo usuario.
create or replace function ventas.fn_reclamar_pedido_tienda(p_pedido_id bigint)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_id bigint;
begin
  update ventas.pedido_tienda
  set reclamado_por = privado.usuario_actual_id(), reclamado_en = now()
  where id = p_pedido_id
    and estado = 'Pendiente'
    and (
      reclamado_en is null
      or reclamado_en < now() - interval '5 minutes'
      or reclamado_por = privado.usuario_actual_id()
    )
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object('ok', true);
end;
$function$;

-- 4) Liberar — solo quien tiene el reclamo puede soltarlo antes de los 5
--    minutos (si ya pasaron, fn_reclamar_pedido_tienda ya lo puede volver
--    a tomar sin necesitar esto: es una optimización de prontitud, no la
--    base de la seguridad).
create or replace function ventas.fn_liberar_pedido_tienda(p_pedido_id bigint)
returns void
language sql
set search_path to ''
as $function$
  update ventas.pedido_tienda
  set reclamado_por = null, reclamado_en = null
  where id = p_pedido_id and reclamado_por = privado.usuario_actual_id();
$function$;

-- 5) Expiración de órdenes Menú QR abandonadas — NUNCA toca 'pedido_web'
--    (sección 20 del plan: la política de expiración es exclusiva de
--    Menú QR). 2 horas desde su creación, y nunca mientras tenga un
--    reclamo activo (alguien la está procesando justo ahora).
create or replace function ventas.fn_expirar_ordenes_menu_qr()
returns void
language sql
security definer
set search_path to ''
as $function$
  update ventas.pedido_tienda
  set estado = 'Expirado'
  where estado = 'Pendiente'
    and origen = 'menu_qr'
    and fecha_creacion < now() - interval '2 hours'
    and (reclamado_en is null or reclamado_en < now() - interval '5 minutes');
$function$;

revoke all on function ventas.fn_expirar_ordenes_menu_qr() from public, anon, authenticated;

select cron.schedule('expirar_ordenes_menu_qr', '*/15 * * * *', 'select ventas.fn_expirar_ordenes_menu_qr();');

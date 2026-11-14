
-- BLOQUE D-A: funciones de evaluacion de alertas de tarjeta (uso >=90% del
-- limite, recordatorio de pago). Replican revisarAlertasTarjetas() de
-- notificaciones.service.ts, con una correccion aprobada explicitamente:
-- excluir movimientos proyectado=true (igual que Calendario/Dashboard;
-- el codigo actual de Angular NO los excluye, inconsistencia real detectada
-- y corregida aqui por decision del usuario). SECURITY DEFINER: el sistema
-- agrega movimientos de un usuario especifico (el que los creo, via RLS
-- personal_todo) sin que quien dispare el trigger/cron tenga esa sesion.
-- Destinatario = el mismo usuario cuyos movimientos se suman (creado_por_usuario_id)
-- -- no hace falta tabla de destinatarios configurables como en Stock, porque
-- aqui el dato mismo (RLS personal_todo + la llave de aviso_tarjeta_ciclo)
-- ya define un destinatario natural. Sin triggers ni cron todavia.

create or replace function presupuesto.fn_evaluar_uso_tarjeta(p_cuenta_id bigint, p_usuario_id bigint)
returns table(candidato boolean, pct_uso numeric, deuda numeric, empresa_id bigint)
language sql
security definer
set search_path = ''
as $function$
  with saldo as (
    select coalesce(sum(case when mp.tipo = 'Ingreso' then mp.monto else -mp.monto end), 0) as total
    from presupuesto.movimiento_presupuesto mp
    where mp.cuenta_presupuesto_id = p_cuenta_id
      and mp.creado_por_usuario_id = p_usuario_id
      and mp.proyectado = false
  )
  select
    (cp.limite_credito is not null and cp.limite_credito > 0
      and greatest(-s.total, 0) / cp.limite_credito * 100 >= 90) as candidato,
    least(
      case when cp.limite_credito is not null and cp.limite_credito > 0
        then greatest(-s.total, 0) / cp.limite_credito * 100 else 0 end,
      100
    ) as pct_uso,
    greatest(-s.total, 0) as deuda,
    cp.empresa_id
  from presupuesto.cuenta_presupuesto cp, saldo s
  where cp.id = p_cuenta_id and cp.tipo = 'Tarjeta';
$function$;

create or replace function presupuesto.fn_evaluar_pago_tarjeta(p_cuenta_id bigint, p_usuario_id bigint, p_hoy date default current_date)
returns table(candidato boolean, deuda numeric, proxima_fecha_pago date, dias_restantes integer, empresa_id bigint)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_cp presupuesto.cuenta_presupuesto;
  v_saldo numeric;
  v_deuda numeric;
  v_ultimo_dia_mes int;
  v_candidata date;
  v_dias int;
begin
  select * into v_cp from presupuesto.cuenta_presupuesto where id = p_cuenta_id and tipo = 'Tarjeta';
  if v_cp.id is null or v_cp.dia_pago is null then
    return;
  end if;

  select coalesce(sum(case when mp.tipo = 'Ingreso' then mp.monto else -mp.monto end), 0) into v_saldo
  from presupuesto.movimiento_presupuesto mp
  where mp.cuenta_presupuesto_id = p_cuenta_id
    and mp.creado_por_usuario_id = p_usuario_id
    and mp.proyectado = false;

  v_deuda := greatest(-v_saldo, 0);
  if v_deuda <= 0 then
    return;
  end if;

  v_ultimo_dia_mes := extract(day from (date_trunc('month', p_hoy) + interval '1 month - 1 day'))::int;
  v_candidata := make_date(extract(year from p_hoy)::int, extract(month from p_hoy)::int, least(v_cp.dia_pago, v_ultimo_dia_mes));
  if v_candidata < p_hoy then
    v_ultimo_dia_mes := extract(day from (date_trunc('month', p_hoy + interval '1 month') + interval '1 month - 1 day'))::int;
    v_candidata := make_date(
      extract(year from (p_hoy + interval '1 month'))::int,
      extract(month from (p_hoy + interval '1 month'))::int,
      least(v_cp.dia_pago, v_ultimo_dia_mes)
    );
  end if;

  v_dias := v_candidata - p_hoy;

  return query select (v_dias >= 0 and v_dias <= 3), v_deuda, v_candidata, v_dias, v_cp.empresa_id;
end;
$function$;

create or replace function presupuesto.fn_generar_aviso_uso_tarjeta(p_cuenta_id bigint, p_usuario_id bigint, p_pct_uso numeric)
returns table(usuario_id bigint)
language sql
security definer
set search_path = ''
as $function$
  with destino as (
    select cp.id as cuenta_id, cp.nombre as cuenta_nombre, cp.empresa_id
    from presupuesto.cuenta_presupuesto cp where cp.id = p_cuenta_id
  ),
  ciclo as (
    select extract(year from current_date)::text || '-' || extract(month from current_date)::int::text as valor
  ),
  insertado as (
    insert into presupuesto.aviso_tarjeta_ciclo (cuenta_presupuesto_id, usuario_id, tipo_aviso, ciclo, empresa_id)
    select d.cuenta_id, p_usuario_id, 'uso', c.valor, d.empresa_id from destino d, ciclo c
    on conflict (cuenta_presupuesto_id, usuario_id, tipo_aviso, ciclo) do nothing
    returning usuario_id, empresa_id
  )
  insert into seguridad.notificacion (usuario_id, titulo, link, leida, empresa_id, creado_por)
  select i.usuario_id,
    '💳 "' || d.cuenta_nombre || '" ya usó el ' || round(p_pct_uso) || '% de su límite de crédito.',
    '/presupuesto/movimientos', false, i.empresa_id, i.usuario_id
  from insertado i join destino d on true
  returning usuario_id;
$function$;

create or replace function presupuesto.fn_generar_aviso_pago_tarjeta(
  p_cuenta_id bigint, p_usuario_id bigint, p_deuda numeric, p_proxima_fecha_pago date, p_dias_restantes int
)
returns table(usuario_id bigint)
language sql
security definer
set search_path = ''
as $function$
  with destino as (
    select cp.id as cuenta_id, cp.nombre as cuenta_nombre, cp.empresa_id
    from presupuesto.cuenta_presupuesto cp where cp.id = p_cuenta_id
  ),
  ciclo as (
    select extract(year from p_proxima_fecha_pago)::text || '-' || extract(month from p_proxima_fecha_pago)::int::text as valor
  ),
  cuando as (
    select case p_dias_restantes when 0 then 'hoy' when 1 then 'mañana' else 'en ' || p_dias_restantes || ' días' end as texto
  ),
  insertado as (
    insert into presupuesto.aviso_tarjeta_ciclo (cuenta_presupuesto_id, usuario_id, tipo_aviso, ciclo, empresa_id)
    select d.cuenta_id, p_usuario_id, 'pago', c.valor, d.empresa_id from destino d, ciclo c
    on conflict (cuenta_presupuesto_id, usuario_id, tipo_aviso, ciclo) do nothing
    returning usuario_id, empresa_id
  )
  insert into seguridad.notificacion (usuario_id, titulo, link, leida, empresa_id, creado_por)
  select i.usuario_id,
    '📅 El pago de "' || d.cuenta_nombre || '" ($' || to_char(p_deuda, 'FM999,999,990.00') || ') vence ' || cu.texto || '.',
    '/presupuesto/movimientos', false, i.empresa_id, i.usuario_id
  from insertado i join destino d on true join cuando cu on true
  returning usuario_id;
$function$;

revoke all on function presupuesto.fn_evaluar_uso_tarjeta(bigint,bigint) from public, anon, authenticated;
revoke all on function presupuesto.fn_evaluar_pago_tarjeta(bigint,bigint,date) from public, anon, authenticated;
revoke all on function presupuesto.fn_generar_aviso_uso_tarjeta(bigint,bigint,numeric) from public, anon, authenticated;
revoke all on function presupuesto.fn_generar_aviso_pago_tarjeta(bigint,bigint,numeric,date,int) from public, anon, authenticated;

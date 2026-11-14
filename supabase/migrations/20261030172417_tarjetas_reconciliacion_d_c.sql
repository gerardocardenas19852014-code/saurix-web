
-- BLOQUE D-C: reconciliacion por lotes para las alertas de tarjeta.
-- "uso": backstop (ya tiene triggers desde D-B, se relaja a */30 tras verificar).
-- "pago": unica via posible (nunca hay trigger, depende solo de la fecha),
-- se queda permanentemente cada minuto, igual que revisar-sla-tickets.

create or replace function presupuesto.fn_reconciliar_uso_tarjeta()
returns void
language sql
security definer
set search_path = ''
as $function$
  with pares as (
    select distinct mp.cuenta_presupuesto_id, mp.creado_por_usuario_id as usuario_id
    from presupuesto.movimiento_presupuesto mp
    join presupuesto.cuenta_presupuesto cp on cp.id = mp.cuenta_presupuesto_id and cp.tipo = 'Tarjeta'
  ),
  candidatos as (
    select p.cuenta_presupuesto_id, p.usuario_id, e.pct_uso
    from pares p
    cross join lateral presupuesto.fn_evaluar_uso_tarjeta(p.cuenta_presupuesto_id, p.usuario_id) e
    where e.candidato
  )
  select presupuesto.fn_generar_aviso_uso_tarjeta(c.cuenta_presupuesto_id, c.usuario_id, c.pct_uso)
  from candidatos c;
$function$;

create or replace function presupuesto.fn_reconciliar_pago_tarjeta()
returns void
language sql
security definer
set search_path = ''
as $function$
  with pares as (
    select distinct mp.cuenta_presupuesto_id, mp.creado_por_usuario_id as usuario_id
    from presupuesto.movimiento_presupuesto mp
    join presupuesto.cuenta_presupuesto cp on cp.id = mp.cuenta_presupuesto_id
      and cp.tipo = 'Tarjeta' and cp.dia_pago is not null
  ),
  candidatos as (
    select p.cuenta_presupuesto_id, p.usuario_id, e.deuda, e.proxima_fecha_pago, e.dias_restantes
    from pares p
    cross join lateral presupuesto.fn_evaluar_pago_tarjeta(p.cuenta_presupuesto_id, p.usuario_id, current_date) e
    where e.candidato
  )
  select presupuesto.fn_generar_aviso_pago_tarjeta(c.cuenta_presupuesto_id, c.usuario_id, c.deuda, c.proxima_fecha_pago, c.dias_restantes)
  from candidatos c;
$function$;

revoke all on function presupuesto.fn_reconciliar_uso_tarjeta() from public, anon, authenticated;
revoke all on function presupuesto.fn_reconciliar_pago_tarjeta() from public, anon, authenticated;

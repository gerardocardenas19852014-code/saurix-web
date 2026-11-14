
-- BLOQUE D-B: triggers event-driven para la alerta de "uso" (>=90% del limite
-- de credito). "Pago" queda fuera -- es 100% cron (D-C), por ser dependiente
-- del paso del tiempo y no de una escritura.

create or replace function presupuesto.fn_trigger_uso_tarjeta_movimiento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_eval record;
begin
  if tg_op = 'DELETE' then
    select * into v_eval from presupuesto.fn_evaluar_uso_tarjeta(old.cuenta_presupuesto_id, old.creado_por_usuario_id);
    if v_eval.candidato then
      perform presupuesto.fn_generar_aviso_uso_tarjeta(old.cuenta_presupuesto_id, old.creado_por_usuario_id, v_eval.pct_uso);
    end if;
    return null;
  end if;

  select * into v_eval from presupuesto.fn_evaluar_uso_tarjeta(new.cuenta_presupuesto_id, new.creado_por_usuario_id);
  if v_eval.candidato then
    perform presupuesto.fn_generar_aviso_uso_tarjeta(new.cuenta_presupuesto_id, new.creado_por_usuario_id, v_eval.pct_uso);
  end if;

  if tg_op = 'UPDATE' and (
    old.cuenta_presupuesto_id is distinct from new.cuenta_presupuesto_id
    or old.creado_por_usuario_id is distinct from new.creado_por_usuario_id
  ) then
    select * into v_eval from presupuesto.fn_evaluar_uso_tarjeta(old.cuenta_presupuesto_id, old.creado_por_usuario_id);
    if v_eval.candidato then
      perform presupuesto.fn_generar_aviso_uso_tarjeta(old.cuenta_presupuesto_id, old.creado_por_usuario_id, v_eval.pct_uso);
    end if;
  end if;

  return null;
end;
$function$;

create or replace function presupuesto.fn_trigger_uso_tarjeta_limite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_usuario_id bigint;
  v_eval record;
begin
  if new.tipo <> 'Tarjeta' then
    return null;
  end if;

  for v_usuario_id in
    select distinct mp.creado_por_usuario_id
    from presupuesto.movimiento_presupuesto mp
    where mp.cuenta_presupuesto_id = new.id
  loop
    select * into v_eval from presupuesto.fn_evaluar_uso_tarjeta(new.id, v_usuario_id);
    if v_eval.candidato then
      perform presupuesto.fn_generar_aviso_uso_tarjeta(new.id, v_usuario_id, v_eval.pct_uso);
    end if;
  end loop;

  return null;
end;
$function$;

create trigger trg_uso_tarjeta_desde_movimiento
after insert or delete or update of monto, tipo, proyectado, cuenta_presupuesto_id, creado_por_usuario_id
on presupuesto.movimiento_presupuesto
for each row execute function presupuesto.fn_trigger_uso_tarjeta_movimiento();

create trigger trg_uso_tarjeta_desde_limite
after update of limite_credito
on presupuesto.cuenta_presupuesto
for each row execute function presupuesto.fn_trigger_uso_tarjeta_limite();

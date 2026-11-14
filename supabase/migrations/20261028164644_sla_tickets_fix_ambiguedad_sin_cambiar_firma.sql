-- Mismo arreglo que el intento anterior (evitar que "usuario_id" se use como
-- columna interna ambigua con la variable implícita de RETURNS TABLE), pero
-- SIN cambiar la firma de salida (ticket_id, nivel_calculado, usuario_id) —
-- así basta con CREATE OR REPLACE, sin DROP (el DROP anterior se quedó
-- colgado por el mismo problema de timeout de siempre en este entorno; la
-- migración completa de todos modos no aplicó nada, lo confirmé leyendo la
-- firma real de la función antes de este statement).
create or replace function privado.fn_revisar_sla_tickets()
returns table (ticket_id bigint, nivel_calculado text, usuario_id bigint)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_lock_ok boolean;
begin
  v_lock_ok := pg_try_advisory_lock(hashtext('fn_revisar_sla_tickets'));
  if not v_lock_ok then
    return;
  end if;

  return query
  with prioridades_vigentes as (
    select tp.id, tp.empresa_id, tp.vigencia_horas, tp.aviso_horas,
           now() - ((tp.vigencia_horas - tp.aviso_horas) || ' hours')::interval as corte_aviso
    from proyectos.ticket_prioridad tp
    where tp.vigencia_horas > 0
  ),
  ultima_columna as (
    select proyecto_id, id as columna_id
    from (
      select proyecto_id, id,
             row_number() over (partition by proyecto_id order by orden desc) as rn
      from proyectos.tablero_columna
    ) x where rn = 1
  ),
  candidatos as (
    select t.id, t.empresa_id, t.proyecto_id, t.numero_ticket, t.titulo,
           t.asignado_usuario_id, t.ticket_prioridad_id,
           case when now() >= t.fecha_creacion + (pv.vigencia_horas || ' hours')::interval
                then 'expired' else 'warning' end as nivel_calc
    from proyectos.ticket t
    join prioridades_vigentes pv
      on pv.id = t.ticket_prioridad_id and pv.empresa_id = t.empresa_id
    join ultima_columna uc on uc.proyecto_id = t.proyecto_id
    where t.activo
      and t.tablero_columna_id <> uc.columna_id
      and t.sla_aviso_nivel is distinct from 'expired'
      and t.fecha_creacion <= pv.corte_aviso
  ),
  reclamados as (
    update proyectos.ticket t
    set sla_aviso_nivel = c.nivel_calc
    from candidatos c
    where t.id = c.id
      and t.sla_aviso_nivel is distinct from c.nivel_calc
    returning t.id, t.empresa_id, t.proyecto_id, c.numero_ticket, c.titulo,
              c.asignado_usuario_id, c.ticket_prioridad_id, c.nivel_calc
  ),
  destinatarios as (
    select r.id, r.empresa_id, r.numero_ticket, r.titulo, r.nivel_calc, r.asignado_usuario_id as dest_usuario_id
    from reclamados r where r.asignado_usuario_id is not null
    union
    select r.id, r.empresa_id, r.numero_ticket, r.titulo, r.nivel_calc, tpn.usuario_id as dest_usuario_id
    from reclamados r
    join proyectos.ticket_prioridad_notificar tpn on tpn.ticket_prioridad_id = r.ticket_prioridad_id
  ),
  avisos_insertados as (
    insert into proyectos.aviso_sla_ticket (ticket_id, nivel, usuario_id)
    select id, nivel_calc, dest_usuario_id from destinatarios
    on conflict (ticket_id, nivel, usuario_id) do nothing
    returning ticket_id as a_ticket_id, nivel as a_nivel, usuario_id as a_usuario_id
  ),
  notificados as (
    insert into seguridad.notificacion (usuario_id, titulo, link, leida, empresa_id, creado_por)
    select d.dest_usuario_id,
           case when d.nivel_calc = 'expired'
                then '🔥 SLA vencido: #' || d.numero_ticket || ' — ' || d.titulo
                else '⏰ SLA por vencer: #' || d.numero_ticket || ' — ' || d.titulo end,
           '/proyectos/tablero?ticket=' || d.id,
           false, d.empresa_id, d.dest_usuario_id
    from destinatarios d
    join avisos_insertados ai
      on ai.a_ticket_id = d.id and ai.a_nivel = d.nivel_calc and ai.a_usuario_id = d.dest_usuario_id
    returning d.id as r_ticket_id, d.nivel_calc as r_nivel, d.dest_usuario_id as r_usuario_id
  )
  select r_ticket_id, r_nivel, r_usuario_id from notificados;

  perform pg_advisory_unlock(hashtext('fn_revisar_sla_tickets'));
exception when others then
  perform pg_advisory_unlock(hashtext('fn_revisar_sla_tickets'));
  raise;
end;
$function$;

revoke all on function privado.fn_revisar_sla_tickets() from public, anon, authenticated;
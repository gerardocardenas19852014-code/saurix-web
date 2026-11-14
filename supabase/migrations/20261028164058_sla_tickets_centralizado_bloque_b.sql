-- BLOQUE B — SLA: tabla de deduplicación, índice de candidatos y función
-- centralizada. NO se instala pg_cron todavía, NO se activa ningún job.
-- Angular sigue llamando revisarSlaTickets() sin cambios hasta validar esto.

create table if not exists proyectos.aviso_sla_ticket (
  id bigserial primary key,
  ticket_id bigint not null references proyectos.ticket(id),
  nivel text not null check (nivel in ('warning','expired')),
  usuario_id bigint not null references seguridad.usuario(id),
  fecha_creacion timestamptz not null default now(),
  unique (ticket_id, nivel, usuario_id)
);

alter table proyectos.aviso_sla_ticket enable row level security;

-- Esta tabla la escribe únicamente la función SECURITY DEFINER (vía
-- fn_revisar_sla_tickets, que corre sin rol authenticated). No se expone
-- ninguna política PERMISSIVE para authenticated/anon: nadie desde el
-- cliente puede leer ni escribir aquí directamente, igual que
-- AvisoStockBajo/AvisoTarjetaCiclo/AvisoOrdenVencida no se consultan desde
-- Angular salvo a través de sus flujos ya existentes.

create index if not exists ticket_sla_candidatos_ix
  on proyectos.ticket (ticket_prioridad_id, fecha_creacion)
  where activo and sla_aviso_nivel is distinct from 'expired';

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
    select r.id, r.empresa_id, r.numero_ticket, r.titulo, r.nivel_calc, r.asignado_usuario_id as usuario_id
    from reclamados r where r.asignado_usuario_id is not null
    union
    select r.id, r.empresa_id, r.numero_ticket, r.titulo, r.nivel_calc, tpn.usuario_id
    from reclamados r
    join proyectos.ticket_prioridad_notificar tpn on tpn.ticket_prioridad_id = r.ticket_prioridad_id
  ),
  avisos_insertados as (
    insert into proyectos.aviso_sla_ticket (ticket_id, nivel, usuario_id)
    select id, nivel_calc, usuario_id from destinatarios
    on conflict (ticket_id, nivel, usuario_id) do nothing
    returning ticket_id as a_ticket_id, nivel as a_nivel, usuario_id as a_usuario_id
  ),
  notificados as (
    insert into seguridad.notificacion (usuario_id, titulo, link, leida, empresa_id, creado_por)
    select d.usuario_id,
           case when d.nivel_calc = 'expired'
                then '🔥 SLA vencido: #' || d.numero_ticket || ' — ' || d.titulo
                else '⏰ SLA por vencer: #' || d.numero_ticket || ' — ' || d.titulo end,
           '/proyectos/tablero?ticket=' || d.id,
           false, d.empresa_id, d.usuario_id
    from destinatarios d
    join avisos_insertados ai
      on ai.a_ticket_id = d.id and ai.a_nivel = d.nivel_calc and ai.a_usuario_id = d.usuario_id
    returning d.id as ticket_id, d.nivel_calc as nivel_calculado, d.usuario_id
  )
  select * from notificados;

  perform pg_advisory_unlock(hashtext('fn_revisar_sla_tickets'));
exception when others then
  perform pg_advisory_unlock(hashtext('fn_revisar_sla_tickets'));
  raise;
end;
$function$;

revoke all on function privado.fn_revisar_sla_tickets() from public, anon, authenticated;
-- Corrige el error real detectado por Postgres (no de PL/pgSQL): el
-- RETURNING del INSERT en seguridad.notificacion no puede leer columnas de
-- las tablas de origen del SELECT (d.id, d.nivel_calc, ...), solo columnas
-- de la propia tabla insertada. Se reestructura para que el SELECT final
-- lea de avisos_insertados (cuyo RETURNING sí es válido, son columnas
-- reales de aviso_sla_ticket) y se fuerza la ejecución del INSERT de
-- notificaciones (CTE con efecto secundario) referenciándolo en el FROM
-- final mediante un COUNT(*) de una sola fila (no multiplica resultados).
create or replace function privado.fn_revisar_sla_tickets_interna()
returns table (ticket_id bigint, nivel text, usuario_id bigint)
language sql
security definer
set search_path = ''
as $function$
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
    returning ticket_id, nivel, usuario_id
  ),
  notificados as (
    insert into seguridad.notificacion (usuario_id, titulo, link, leida, empresa_id, creado_por)
    select d.dest_usuario_id,
           case when ai.nivel = 'expired'
                then '🔥 SLA vencido: #' || d.numero_ticket || ' — ' || d.titulo
                else '⏰ SLA por vencer: #' || d.numero_ticket || ' — ' || d.titulo end,
           '/proyectos/tablero?ticket=' || ai.ticket_id,
           false, d.empresa_id, d.dest_usuario_id
    from avisos_insertados ai
    join destinatarios d
      on d.id = ai.ticket_id and d.nivel_calc = ai.nivel and d.dest_usuario_id = ai.usuario_id
    returning id
  )
  select ai.ticket_id, ai.nivel, ai.usuario_id
  from avisos_insertados ai, (select count(*) from notificados) as _forzar_notificacion;
$function$;

revoke all on function privado.fn_revisar_sla_tickets_interna() from public, anon, authenticated;
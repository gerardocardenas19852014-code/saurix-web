
create or replace function proyectos.fn_tickets_lista_pagina(
  p_proyecto_id            bigint,
  p_busqueda               text     default null,
  p_tipo_id                bigint   default null,
  p_modulo_id              bigint   default null,
  p_prioridad_id           bigint   default null,
  p_estado_ids             bigint[] default null,
  p_asignado_usuario_id    bigint   default null,
  p_planeado               smallint default 0,
  p_sprint_id              bigint   default null,
  p_sprint_sin_asignar     boolean  default false,
  p_vigencia_estado        text     default null,
  p_mostrar_inactivos      boolean  default false,
  p_mostrar_resueltos      boolean  default false,
  p_orden_columna          text     default 'numero_ticket',
  p_orden_direccion        text     default 'asc',
  p_desde                  integer  default 0,
  p_cantidad               integer  default 50
)
returns table (
  id bigint, proyecto_id bigint, tablero_columna_id bigint, ticket_tipo_id bigint,
  ticket_prioridad_id bigint, ticket_modulo_id bigint, asignado_usuario_id bigint,
  reportado_por_usuario_id bigint, numero_ticket text, folio_interno text, titulo text,
  descripcion text, planeado boolean, tiempo_estimado_min integer,
  fecha_fin_analisis date, fecha_fin_desarrollo date, fecha_fin_cliente date,
  fecha_inicio date, fecha_fin date, solucion text, sla_aviso_nivel text,
  ticket_padre_id bigint, sprint_id bigint, fecha_creacion timestamptz,
  fecha_modificacion timestamptz, creado_por bigint, modificado_por bigint, activo boolean,
  vigencia_estado text,
  total_filas bigint,
  desde_efectivo bigint
)
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_ultima_columna_id    bigint;
  v_orden_columna        text;
  v_orden_direccion      text;
  v_cantidad             integer;
  v_total                bigint;
  v_ultima_pagina_desde  bigint;
  v_desde_efectivo       bigint;
  v_base_sql text;
begin
  -- "Resuelto" = última columna del tablero de ESTE proyecto, mismo criterio
  -- que hoy usan kanban/backlog/balanceo/dashboard/resumen-ejecutivo en
  -- Angular (estaResuelto() y equivalentes: última columna por `orden`).
  -- NOTA (hallazgo documentado, no corregido aquí): proyectos.ticket tiene
  -- una columna `resuelto` mantenida por el trigger
  -- trg_ticket_calcular_resuelto / privado.fn_ticket_calcular_resuelto(),
  -- que probablemente calcula lo mismo -- pero ningún componente Angular
  -- la lee hoy (todos recalculan "última columna" por su cuenta). Para no
  -- cambiar ninguna regla funcional vigente sin autorización aparte, esta
  -- función reproduce exactamente el cálculo que Angular ya hace hoy
  -- (dinámico, contra tablero_columna.orden), no la columna `resuelto`.
  select tc.id into v_ultima_columna_id
    from proyectos.tablero_columna tc
   where tc.proyecto_id = p_proyecto_id
   order by tc.orden desc
   limit 1;

  v_orden_columna := case p_orden_columna
    when 'numero_ticket'       then 'numero_ticket'
    when 'folio_interno'       then 'folio_interno'
    when 'titulo'              then 'titulo'
    when 'ticket_tipo_id'      then 'ticket_tipo_id'
    when 'ticket_modulo_id'    then 'ticket_modulo_id'
    when 'sprint_id'           then 'sprint_id'
    when 'ticket_prioridad_id' then 'ticket_prioridad_id'
    when 'tablero_columna_id'  then 'tablero_columna_id'
    when 'asignado_usuario_id' then 'asignado_usuario_id'
    when 'planeado'            then 'planeado'
    when 'fecha_creacion'      then 'fecha_creacion'
    when 'vigencia_estado'     then 'vigencia_estado'
    else 'numero_ticket'
  end;
  v_orden_direccion := case when lower(p_orden_direccion) = 'desc' then 'desc' else 'asc' end;
  v_cantidad := greatest(1, p_cantidad);

  v_base_sql := '
    select
      t.id, t.proyecto_id, t.tablero_columna_id, t.ticket_tipo_id,
      t.ticket_prioridad_id, t.ticket_modulo_id, t.asignado_usuario_id,
      t.reportado_por_usuario_id, t.numero_ticket, t.folio_interno, t.titulo,
      t.descripcion, t.planeado, t.tiempo_estimado_min,
      t.fecha_fin_analisis, t.fecha_fin_desarrollo, t.fecha_fin_cliente,
      t.fecha_inicio, t.fecha_fin, t.solucion, t.sla_aviso_nivel,
      t.ticket_padre_id, t.sprint_id, t.fecha_creacion,
      t.fecha_modificacion, t.creado_por, t.modificado_por, t.activo,
      case
        when tp.vigencia_horas is null or tp.vigencia_horas = 0
             or t.fecha_creacion is null or t.tablero_columna_id = $1
          then ''sin_vigencia''
        when now() >= t.fecha_creacion + (tp.vigencia_horas * interval ''1 hour'')
          then ''vencido''
        when now() >= t.fecha_creacion + (tp.vigencia_horas * interval ''1 hour'')
                       - (coalesce(tp.aviso_horas, 0) * interval ''1 hour'')
          then ''por_vencer''
        else ''vigente''
      end as vigencia_estado
    from proyectos.ticket t
    left join proyectos.ticket_prioridad tp on tp.id = t.ticket_prioridad_id
    where t.proyecto_id = $2
      and ($3 or t.activo is distinct from false)
      and ($4 or t.tablero_columna_id is distinct from $1)
      and ($5::bigint is null or t.ticket_tipo_id = $5)
      and (
        $6::bigint is null
        or ($6 = -1 and t.ticket_modulo_id is null)
        or t.ticket_modulo_id = $6
      )
      and ($7::bigint is null or t.ticket_prioridad_id = $7)
      and ($8::bigint[] is null or cardinality($8) = 0 or t.tablero_columna_id = any($8))
      and ($9::bigint is null or t.asignado_usuario_id = $9)
      and (
        $10 = 0
        or ($10 = 1 and t.planeado is distinct from false)
        or ($10 = 2 and t.planeado is false)
      )
      and (
        $11::bigint is null
        or ($12 and t.sprint_id is null)
        or t.sprint_id = $11
      )
      and (
        $13::text is null or $13 = ''''
        or exists (
          select 1
          from unnest(string_to_array($13, '','')) as termino(valor)
          where length(trim(termino.valor)) > 0
            and (
              t.numero_ticket ilike ''%%'' || trim(termino.valor) || ''%%''
              or coalesce(t.folio_interno, '''') ilike ''%%'' || trim(termino.valor) || ''%%''
              or t.titulo ilike ''%%'' || trim(termino.valor) || ''%%''
              or exists (
                   select 1 from proyectos.ticket_etiqueta te
                    where te.ticket_id = t.id and te.activo is distinct from false
                      and te.texto ilike ''%%'' || trim(termino.valor) || ''%%''
                 )
              or exists (
                   select 1 from proyectos.sprint sp
                    where sp.id = t.sprint_id
                      and sp.nombre ilike ''%%'' || trim(termino.valor) || ''%%''
                 )
              or (t.sprint_id is null and ''backlog'' ilike ''%%'' || trim(termino.valor) || ''%%'')
            )
        )
      )
  ';

  execute 'select count(*) from (' || v_base_sql || ') base
           where ($14::text is null or base.vigencia_estado = $14)'
    into v_total
    using v_ultima_columna_id, p_proyecto_id, p_mostrar_inactivos, p_mostrar_resueltos,
          p_tipo_id, p_modulo_id, p_prioridad_id, p_estado_ids, p_asignado_usuario_id,
          p_planeado, p_sprint_id, p_sprint_sin_asignar, p_busqueda, p_vigencia_estado;

  if v_total = 0 then
    v_desde_efectivo := 0;
  else
    v_ultima_pagina_desde := ((v_total - 1) / v_cantidad) * v_cantidad;
    v_desde_efectivo := case
      when p_desde < 0 then 0
      when p_desde > v_ultima_pagina_desde then v_ultima_pagina_desde
      else p_desde
    end;
  end if;

  return query execute
    'select base.*, $15::bigint as total_filas, $16::bigint as desde_efectivo
     from (' || v_base_sql || ') base
     where ($14::text is null or base.vigencia_estado = $14)
     order by ' || format('%I %s', v_orden_columna, v_orden_direccion) || ' nulls last, base.id asc
     offset $16
     limit $17'
    using v_ultima_columna_id, p_proyecto_id, p_mostrar_inactivos, p_mostrar_resueltos,
          p_tipo_id, p_modulo_id, p_prioridad_id, p_estado_ids, p_asignado_usuario_id,
          p_planeado, p_sprint_id, p_sprint_sin_asignar, p_busqueda, p_vigencia_estado,
          v_total, v_desde_efectivo, v_cantidad;
end;
$function$;

revoke all on function proyectos.fn_tickets_lista_pagina(
  bigint, text, bigint, bigint, bigint, bigint[], bigint, smallint, bigint,
  boolean, text, boolean, boolean, text, text, integer, integer
) from public;

grant execute on function proyectos.fn_tickets_lista_pagina(
  bigint, text, bigint, bigint, bigint, bigint[], bigint, smallint, bigint,
  boolean, text, boolean, boolean, text, text, integer, integer
) to authenticated;

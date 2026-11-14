-- Problema: trg_auditoria (usado por TODAS las tablas con auditoría, no
-- solo ticket) estampa fecha_modificacion/modificado_por en CUALQUIER
-- UPDATE, incluido el UPDATE interno que sincroniza `resuelto` cuando se
-- reordena una columna del tablero -- eso haría que reordenar columnas
-- marque como "recién modificados" a todos los tickets del proyecto sin
-- que el usuario los haya tocado.
--
-- Solución elegida: una bandera de sesión con alcance de UNA transacción
-- (set_config con is_local=true, se revierte solo al terminar la
-- transacción aunque no se resetee explícitamente) que SOLO activa
-- fn_sincronizar_resuelto_proyecto() justo antes de su propio UPDATE y
-- apaga inmediatamente después. trg_auditoria sigue activo para TODO lo
-- demás, en TODAS las tablas, sin excepción -- no se desactiva
-- globalmente y no se abre ningún hueco para ediciones reales: ningún
-- otro código del sistema pone esta bandera en 'on'.

create or replace function privado.auditoria()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    new.fecha_creacion     := now();
    new.fecha_modificacion := null;
    new.creado_por         := coalesce(new.creado_por, privado.usuario_actual_id());
    new.modificado_por     := null;
  else
    new.fecha_creacion := old.fecha_creacion;
    new.creado_por     := old.creado_por;
    if coalesce(current_setting('privado.sincronizacion_interna', true), 'off') = 'on' then
      -- Sincronización interna del sistema (p.ej. recalcular
      -- ticket.resuelto tras reordenar columnas del tablero): no es una
      -- edición real del usuario, se conserva fecha_modificacion/
      -- modificado_por tal como estaban.
      new.fecha_modificacion := old.fecha_modificacion;
      new.modificado_por     := old.modificado_por;
    else
      new.fecha_modificacion := now();
      new.modificado_por     := privado.usuario_actual_id();
    end if;
  end if;
  return new;
end;
$function$;

create or replace function privado.fn_sincronizar_resuelto_proyecto(p_proyecto_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform set_config('privado.sincronizacion_interna', 'on', true);

  update proyectos.ticket t
  set resuelto = (t.tablero_columna_id = uc.columna_id)
  from (
    select id as columna_id
    from proyectos.tablero_columna
    where proyecto_id = p_proyecto_id
    order by orden desc
    limit 1
  ) uc
  where t.proyecto_id = p_proyecto_id
    and t.resuelto is distinct from (t.tablero_columna_id = uc.columna_id);

  perform set_config('privado.sincronizacion_interna', 'off', true);
end;
$function$;

revoke all on function privado.fn_sincronizar_resuelto_proyecto(bigint) from public, anon, authenticated;
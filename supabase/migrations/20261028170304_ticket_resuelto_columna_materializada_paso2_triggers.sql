-- Paso 2: PostgreSQL es la única autoridad sobre `resuelto` — ningún
-- cliente (Angular) necesita recordar actualizarlo.
--
-- Auditoría de escritura confirmada antes de este cambio (sesión de
-- revisión BLOQUE B): el único punto en Angular que cambia
-- ticket.tablero_columna_id después de creado es
-- KanbanComponent.moverTicketAColumna() (usado tanto por drag&drop
-- onDrop() como por los botones Aceptar/Regresar); la creación de ticket
-- también lo fija una vez. Ningún RPC, función PostgreSQL, trigger previo
-- ni importación masiva toca esta columna — todo pasa por UPDATE/INSERT
-- normales vía el cliente genérico de datos, que estos triggers
-- interceptan sin excepción. tablero_columna.orden solo cambia desde
-- TablerosComponent (alta de columna, edición, y el intercambio ▲▼ de
-- moverOrden() — este último son 2 escrituras independientes sin
-- transacción, preexistente, no introducido por este cambio). Borrar una
-- columna con tickets está bloqueado tanto en la UI como por el FK
-- ticket_tablero_columna_id_fkey (ON DELETE NO ACTION) — no puede quedar
-- un ticket huérfano.

create or replace function privado.fn_sincronizar_resuelto_proyecto(p_proyecto_id bigint)
returns void
language sql
security definer
set search_path = ''
as $function$
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
$function$;

revoke all on function privado.fn_sincronizar_resuelto_proyecto(bigint) from public, anon, authenticated;

-- Dispara al crear/mover un ticket: calcula resuelto contra la última
-- columna del proyecto EN ESE MOMENTO.
create or replace function privado.fn_ticket_calcular_resuelto()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ultima_columna_id bigint;
begin
  select tc.id into v_ultima_columna_id
  from proyectos.tablero_columna tc
  where tc.proyecto_id = new.proyecto_id
  order by tc.orden desc
  limit 1;

  new.resuelto := (new.tablero_columna_id = v_ultima_columna_id);
  return new;
end;
$function$;

create trigger trg_ticket_calcular_resuelto
  before insert or update of tablero_columna_id, proyecto_id on proyectos.ticket
  for each row execute function privado.fn_ticket_calcular_resuelto();

-- Dispara al crear/editar/borrar una columna del tablero: si cambia cuál
-- es la última columna del proyecto, recalcula resuelto para TODOS los
-- tickets de ese proyecto (acotado por proyecto, no global).
create or replace function privado.fn_tablero_columna_sincronizar_resueltos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    perform privado.fn_sincronizar_resuelto_proyecto(old.proyecto_id);
  else
    perform privado.fn_sincronizar_resuelto_proyecto(new.proyecto_id);
    if tg_op = 'UPDATE' and old.proyecto_id is distinct from new.proyecto_id then
      perform privado.fn_sincronizar_resuelto_proyecto(old.proyecto_id);
    end if;
  end if;
  return null;
end;
$function$;

create trigger trg_tablero_columna_sincronizar_resueltos
  after insert or update or delete on proyectos.tablero_columna
  for each row execute function privado.fn_tablero_columna_sincronizar_resueltos();

revoke all on function privado.fn_ticket_calcular_resuelto() from public, anon, authenticated;
revoke all on function privado.fn_tablero_columna_sincronizar_resueltos() from public, anon, authenticated;
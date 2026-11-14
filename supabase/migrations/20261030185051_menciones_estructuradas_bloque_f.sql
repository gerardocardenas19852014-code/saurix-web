
-- BLOQUE F: MENCIONES ESTRUCTURADAS. Decisiones del usuario: (1) arreglar la
-- ambiguedad de "solo primer nombre" en vez de solo estructurar el mismo bug
-- -- si @token coincide con mas de un usuario por primer nombre Y no hay un
-- match unico por nombre completo (sin espacios), no se notifica a nadie
-- (evita falsos positivos); (2) mover la deteccion a un trigger de Postgres
-- sobre ticket_comentario (consistente con el resto de la migracion), en vez
-- de dejarla en Angular.

create table proyectos.ticket_comentario_mencion (
  id bigint generated always as identity primary key,
  ticket_comentario_id bigint not null references proyectos.ticket_comentario(id) on delete cascade,
  usuario_id bigint not null references seguridad.usuario(id) on delete cascade,
  fecha_creacion timestamptz not null default now(),
  fecha_modificacion timestamptz,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null,
  unique (ticket_comentario_id, usuario_id)
);

alter table proyectos.ticket_comentario_mencion enable row level security;

create policy compartida_todo on proyectos.ticket_comentario_mencion
  for all using (privado.usuario_actual_id() is not null) with check (privado.usuario_actual_id() is not null);
create policy modulo_habilitado on proyectos.ticket_comentario_mencion
  for all using (privado.modulo_habilitado('proyectos')) with check (privado.modulo_habilitado('proyectos'));
create policy solo_mi_empresa on proyectos.ticket_comentario_mencion
  for all using (empresa_id = privado.empresa_actual_id()) with check (empresa_id = privado.empresa_actual_id());

create trigger trg_auditoria
  before insert or update on proyectos.ticket_comentario_mencion
  for each row execute function privado.auditoria();

create or replace function proyectos.fn_generar_menciones_comentario(p_ticket_comentario_id bigint)
returns table(usuario_id bigint)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tc record;
  v_t record;
  v_tok text;
  v_full_count int;
  v_full_match bigint;
  v_first_count int;
  v_first_match bigint;
  v_resuelto bigint;
  v_insertado_id bigint;
begin
  select tc.id, tc.texto, tc.ticket_id, tc.creado_por, tc.empresa_id into v_tc
  from proyectos.ticket_comentario tc where tc.id = p_ticket_comentario_id;

  if v_tc.id is null then
    return;
  end if;

  select t.id, t.numero_ticket, t.titulo into v_t
  from proyectos.ticket t where t.id = v_tc.ticket_id;

  for v_tok in
    select distinct lower(m[1]) as tok
    from regexp_matches(v_tc.texto, '@([[:alpha:][:digit:]_]+)', 'g') m
  loop
    -- intento 1: nombre completo sin espacios (desambigua "Juan Perez" de "Juan Garcia")
    select count(*), min(u.id) into v_full_count, v_full_match
    from seguridad.usuario u
    where u.empresa_id = v_tc.empresa_id and u.activo
      and lower(replace(
            trim(u.nombre) || coalesce(' ' || u.apellido_paterno, '') || coalesce(' ' || u.apellido_materno, ''),
            ' ', ''
          )) = v_tok;

    if v_full_count = 1 then
      v_resuelto := v_full_match;
    else
      -- intento 2: solo primer nombre (comportamiento original) -- si hay mas
      -- de un usuario con ese primer nombre, queda ambiguo y no se notifica
      -- a nadie (en vez de notificar al primero que matchee, que era el bug).
      select count(*), min(u.id) into v_first_count, v_first_match
      from seguridad.usuario u
      where u.empresa_id = v_tc.empresa_id and u.activo
        and lower(split_part(trim(u.nombre), ' ', 1)) = v_tok;
      v_resuelto := case when v_first_count = 1 then v_first_match else null end;
    end if;

    if v_resuelto is not null and v_resuelto is distinct from v_tc.creado_por then
      insert into proyectos.ticket_comentario_mencion (ticket_comentario_id, usuario_id, empresa_id)
      values (v_tc.id, v_resuelto, v_tc.empresa_id)
      on conflict (ticket_comentario_id, usuario_id) do nothing
      returning proyectos.ticket_comentario_mencion.usuario_id into v_insertado_id;

      if v_insertado_id is not null then
        insert into seguridad.notificacion (usuario_id, titulo, link, leida, empresa_id, creado_por)
        values (
          v_insertado_id,
          'Te mencionaron en el ticket #' || v_t.numero_ticket || ' — ' || v_t.titulo,
          '/proyectos/tablero?ticket=' || v_t.id,
          false, v_tc.empresa_id, v_insertado_id
        );
        usuario_id := v_insertado_id;
        return next;
      end if;
    end if;
    v_insertado_id := null;
  end loop;
end;
$function$;

create or replace function proyectos.fn_trigger_mencion_comentario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform proyectos.fn_generar_menciones_comentario(new.id);
  return null;
end;
$function$;

create trigger trg_mencion_comentario
  after insert on proyectos.ticket_comentario
  for each row execute function proyectos.fn_trigger_mencion_comentario();

revoke all on function proyectos.fn_generar_menciones_comentario(bigint) from public, anon, authenticated;

-- =====================================================================
-- Saurix · Supabase · 35 Eliminar empresa: quita el truco de desactivar
-- triggers (no funciona en Supabase)
--  - seguridad.eliminar_empresa() (migración 31) borraba tabla por tabla
--    con "alter table ... disable trigger all" para no depender del
--    orden de dependencias entre tablas — mismo truco que
--    privado.limpiar_datos_empresa() (migración 13).
--  - Al probarlo de verdad truena: "permission denied: ... is a system
--    trigger". Postgres solo deja desactivar los triggers INTERNOS de
--    llave foránea (RI_ConstraintTrigger_*) a un superusuario real, y en
--    Supabase ni siquiera el dueño de las funciones (postgres) lo es —
--    está restringido a propósito. Por eso la migración 31 nunca llegó a
--    aplicarse de verdad (se quedó solo en el repo).
--  - Esta versión ya NO toca ningún trigger: borra en varias "pasadas"
--    sobre las mismas tablas. Una tabla que todavía está siendo
--    referenciada por otra (FK) truena con foreign_key_violation en esa
--    pasada — se ignora y se reintenta en la siguiente, una vez que la
--    tabla que la referenciaba ya quedó vacía. No hace falta conocer de
--    antemano el orden real de dependencias entre las ~20 tablas. Si
--    después de 15 pasadas algo sigue sin poder borrarse (un ciclo
--    genuino, no solo orden), se avisa en vez de quedarse callado.
-- =====================================================================
set check_function_bodies = off;

create or replace function seguridad.eliminar_empresa(p_empresa bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_mia    bigint;
  t        record;
  v_pasada int;
begin
  if not privado.es_superadmin() then
    raise exception 'Solo el superadministrador puede eliminar empresas.';
  end if;
  select empresa_id into v_mia from seguridad.usuario where auth_user_id = auth.uid();
  if p_empresa = v_mia then
    raise exception 'No puedes eliminar tu propia empresa.';
  end if;
  if not exists (select 1 from seguridad.empresa where id = p_empresa) then
    raise exception 'Esa empresa ya no existe.';
  end if;

  -- Cualquiera (típicamente un superadmin, de OTRA empresa) que esté en
  -- modo soporte DENTRO de la empresa que se va a borrar, sale primero.
  update seguridad.usuario set empresa_activa_id = null where empresa_activa_id = p_empresa;

  -- Hasta 15 pasadas: en cada una se intenta borrar de TODAS las tablas
  -- con empresa_id; una tabla todavía referenciada por otra se ignora
  -- (queda para la siguiente pasada) en vez de tronar toda la operación.
  begin
    for v_pasada in 1..15 loop
      for t in
        select c.table_schema, c.table_name
        from information_schema.tables c
        where c.table_type = 'BASE TABLE'
          and c.table_schema in ('seguridad', 'panel_control', 'wikidocs', 'presupuesto', 'proyectos', 'familia', 'inventario', 'ventas')
          and exists (
            select 1 from information_schema.columns k
            where k.table_schema = c.table_schema and k.table_name = c.table_name and k.column_name = 'empresa_id'
          )
      loop
        begin
          execute format('delete from %I.%I where empresa_id = $1', t.table_schema, t.table_name) using p_empresa;
        exception when foreign_key_violation then
          null; -- se reintenta en la siguiente pasada
        end;
      end loop;
    end loop;

    -- Pasada final SIN atrapar el error: si algo sigue sin poder
    -- borrarse después de 15 vueltas, es un ciclo real y se avisa.
    for t in
      select c.table_schema, c.table_name
      from information_schema.tables c
      where c.table_type = 'BASE TABLE'
        and c.table_schema in ('seguridad', 'panel_control', 'wikidocs', 'presupuesto', 'proyectos', 'familia', 'inventario', 'ventas')
        and exists (
          select 1 from information_schema.columns k
          where k.table_schema = c.table_schema and k.table_name = c.table_name and k.column_name = 'empresa_id'
        )
    loop
      execute format('delete from %I.%I where empresa_id = $1', t.table_schema, t.table_name) using p_empresa;
    end loop;
  exception when foreign_key_violation then
    raise exception 'No se pudo eliminar: después de varios intentos todavía queda algo (fuera del orden normal de dependencias) referenciando datos de esta empresa.';
  end;

  begin
    delete from seguridad.empresa where id = p_empresa;
  exception when foreign_key_violation then
    raise exception 'No se pudo eliminar: todavía queda algo referenciando a esta empresa.';
  end;
end;
$$;

revoke all on function seguridad.eliminar_empresa(bigint) from public, anon;
grant execute on function seguridad.eliminar_empresa(bigint) to authenticated;

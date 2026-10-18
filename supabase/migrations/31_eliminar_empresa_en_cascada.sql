-- =====================================================================
-- Saurix · Supabase · 31 Eliminar empresa en cascada (solo superadmin)
--  - seguridad.eliminar_empresa() (migración 12) antes SOLO borraba una
--    empresa sin usuarios ni datos — si ya tenía algo capturado, tronaba
--    con foreign_key_violation y mandaba a "desactívala en su lugar".
--  - El cliente pidió poder eliminarla de verdad, con TODO lo suyo. Esta
--    migración reemplaza esa función: en vez de bloquear por FK, recorre
--    TODAS las tablas con columna empresa_id en los esquemas de datos
--    (mismo truco que privado.limpiar_datos_empresa(), migración 13:
--    desactiva triggers tabla por tabla, borra solo las filas de esa
--    empresa, reactiva) — a diferencia de esa función (que conserva
--    usuario/rol/permiso/rol_permiso porque ahí la empresa sigue
--    existiendo), aquí SÍ se incluyen esas tablas, y también inventario/
--    ventas (no existían cuando se escribió la 13), porque la intención
--    es borrar la empresa POR COMPLETO.
--  - Sigue siendo irreversible y solo para superadmin — el frontend pide
--    teclear la clave de la empresa para confirmar antes de llamar esto
--    (ver empresas.component.ts/html).
--  - Límite conocido (igual que la migración 13): esto borra las FILAS en
--    Postgres, no los archivos físicos en Storage (fotos/adjuntos) que
--    esas filas referenciaban — quedan huérfanos en el bucket "adjuntos".
--
--  NOTA: esta migración se aplicó a mano desde el Editor SQL de Supabase
--  (el MCP de Supabase se quedó esperando indefinidamente al intentar
--  aplicarla — cualquier sentencia con DELETE parece requerir una
--  confirmación del usuario que no llega en una sesión sin supervisión;
--  create table/grant/revoke de migraciones anteriores sí pasaron sin
--  problema). Si en el futuro se vuelve a necesitar tocar esta función,
--  considerar aplicarla igual directamente en el dashboard.
-- =====================================================================
set check_function_bodies = off;

create or replace function seguridad.eliminar_empresa(p_empresa bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_mia bigint;
  t     record;
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

  -- Mismo truco que privado.limpiar_datos_empresa() (migración 13):
  -- desactiva triggers (incluye los de llave foránea) tabla por tabla
  -- para poder borrar sin depender del orden de dependencias entre
  -- ellas, y los reactiva de inmediato después de cada una.
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
    execute format('alter table %I.%I disable trigger all', t.table_schema, t.table_name);
    execute format('delete from %I.%I where empresa_id = $1', t.table_schema, t.table_name) using p_empresa;
    execute format('alter table %I.%I enable trigger all', t.table_schema, t.table_name);
  end loop;

  -- Con todo lo referenciado ya borrado arriba, esto ya no debería
  -- tronar por llave foránea — se deja el aviso igual, por si acaso.
  begin
    delete from seguridad.empresa where id = p_empresa;
  exception when foreign_key_violation then
    raise exception 'No se pudo eliminar: todavía queda algo referenciando a esta empresa.';
  end;
exception when others then
  -- Si algo falla a medio camino, reactiva los triggers de TODAS las
  -- tablas del loop (alguna podría haber quedado desactivada) antes de
  -- que la transacción haga rollback — mismo criterio de
  -- privado.limpiar_datos_empresa().
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
      execute format('alter table %I.%I enable trigger all', t.table_schema, t.table_name);
    exception when others then null;
    end;
  end loop;
  raise;
end;
$$;

revoke all on function seguridad.eliminar_empresa(bigint) from public, anon;
grant execute on function seguridad.eliminar_empresa(bigint) to authenticated;

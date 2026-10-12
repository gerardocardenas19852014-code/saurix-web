-- =====================================================================
-- Saurix · Supabase · 13 Limpiar los datos capturados de mi empresa
-- Panel de Control → Restauración y respaldo gana un botón "Limpiar" (modo
-- Nube): borra TODO lo capturado de la empresa del admin que lo ejecuta
-- (tickets, movimientos, miembros de familia, documentos, bitácora,
-- notificaciones, etc. — cualquier tabla con empresa_id en los esquemas de
-- datos), pero CONSERVA usuario/rol/permiso/rol_permiso (nadie se queda
-- sin poder entrar ni pierde sus roles) y valor_lista/configuracion_
-- apariencia (catálogos y tema no se vuelven a sembrar). Es el equivalente
-- "limpiar sin borrar la empresa" de seguridad.eliminar_empresa
-- (migración 12, que solo borra empresas SIN datos).
--
-- Cualquier admin puede limpiar los datos de SU PROPIA empresa (no hace
-- falta ser superadmin) — igual que puede importar un respaldo
-- (privado.importar_entidad, migración 08). Se ejecuta con los triggers
-- desactivados tabla por tabla (incluye los de integridad referencial)
-- mientras dura el borrado, para no depender de un orden exacto de
-- dependencias entre tablas: todas las tablas a limpiar se vacían dentro
-- de la misma transacción, así que al terminar no quedan huérfanos. El
-- registro en Bitácora de esta limpieza lo escribe el frontend DESPUÉS de
-- que la llamada regresa bien (ver respaldo.component.ts) — si se
-- insertara aquí, quedaría borrado por este mismo proceso al limpiar
-- seguridad.bitacora.
-- =====================================================================
set check_function_bodies = off;

create or replace function privado.limpiar_datos_empresa()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_empresa      bigint := privado.empresa_actual_id();
  v_conservar    text[][] := array[
    array['seguridad', 'usuario'],
    array['seguridad', 'rol'],
    array['seguridad', 'permiso'],
    array['seguridad', 'rol_permiso'],
    array['panel_control', 'valor_lista'],
    array['panel_control', 'configuracion_apariencia']
  ];
  t              record;
  v_n            bigint;
  v_resultado    jsonb := '[]';
  v_total        bigint := 0;
begin
  if not privado.es_admin() then
    raise exception 'Solo un administrador puede limpiar los datos de la empresa.';
  end if;
  if v_empresa is null then
    raise exception 'No se pudo identificar tu empresa.';
  end if;

  -- Desactiva triggers (incluye los de llave foránea) en todas las tablas
  -- a limpiar antes de borrar nada, para poder hacerlo sin importar el
  -- orden de dependencias entre ellas.
  for t in
    select c.table_schema, c.table_name
    from information_schema.tables c
    where c.table_type = 'BASE TABLE'
      and c.table_schema in ('seguridad', 'panel_control', 'wikidocs', 'presupuesto', 'proyectos', 'familia')
      and exists (
        select 1 from information_schema.columns k
        where k.table_schema = c.table_schema and k.table_name = c.table_name and k.column_name = 'empresa_id'
      )
      and not (array[c.table_schema::text, c.table_name::text] = any (v_conservar))
  loop
    execute format('alter table %I.%I disable trigger all', t.table_schema, t.table_name);
  end loop;

  -- Borra, tabla por tabla, solo las filas de esta empresa, y reactiva sus
  -- triggers de inmediato (no hace falta esperar a que terminen las demás).
  for t in
    select c.table_schema, c.table_name
    from information_schema.tables c
    where c.table_type = 'BASE TABLE'
      and c.table_schema in ('seguridad', 'panel_control', 'wikidocs', 'presupuesto', 'proyectos', 'familia')
      and exists (
        select 1 from information_schema.columns k
        where k.table_schema = c.table_schema and k.table_name = c.table_name and k.column_name = 'empresa_id'
      )
      and not (array[c.table_schema::text, c.table_name::text] = any (v_conservar))
    order by c.table_schema, c.table_name
  loop
    execute format('delete from %I.%I where empresa_id = $1', t.table_schema, t.table_name) using v_empresa;
    get diagnostics v_n = row_count;
    execute format('alter table %I.%I enable trigger all', t.table_schema, t.table_name);
    if v_n > 0 then
      v_total := v_total + v_n;
      v_resultado := v_resultado || jsonb_build_object('tabla', t.table_schema || '.' || t.table_name, 'borrados', v_n);
    end if;
  end loop;

  return jsonb_build_object('totalRegistros', v_total, 'tablas', v_resultado);
exception when others then
  -- Si algo falla a medio camino, reactiva los triggers de TODAS las
  -- tablas (algunas podrían haber quedado desactivadas) antes de que la
  -- transacción haga rollback, para no dejar la sesión en un estado raro
  -- si algo reutiliza la conexión sin hacer rollback real.
  for t in
    select c.table_schema, c.table_name
    from information_schema.tables c
    where c.table_type = 'BASE TABLE'
      and c.table_schema in ('seguridad', 'panel_control', 'wikidocs', 'presupuesto', 'proyectos', 'familia')
      and exists (
        select 1 from information_schema.columns k
        where k.table_schema = c.table_schema and k.table_name = c.table_name and k.column_name = 'empresa_id'
      )
      and not (array[c.table_schema::text, c.table_name::text] = any (v_conservar))
  loop
    begin
      execute format('alter table %I.%I enable trigger all', t.table_schema, t.table_name);
    exception when others then null;
    end;
  end loop;
  raise;
end;
$$;

revoke all on function privado.limpiar_datos_empresa() from public, anon;
grant execute on function privado.limpiar_datos_empresa() to authenticated;

-- Punto de entrada expuesto en la API (esquema panel_control), mismo
-- patrón que panel_control.importar_entidad (migración 08).
create or replace function panel_control.limpiar_datos_empresa()
returns jsonb
language sql security definer set search_path = ''
as $$ select privado.limpiar_datos_empresa() $$;

revoke all on function panel_control.limpiar_datos_empresa() from public, anon;
grant execute on function panel_control.limpiar_datos_empresa() to authenticated;

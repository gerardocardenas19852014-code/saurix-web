-- =====================================================================
-- Saurix · Supabase · 08 Importar un respaldo de IndexedDB
-- La pantalla Panel de Control → Respaldo manda el respaldo (.json) una
-- entidad a la vez: panel_control.importar_entidad(entidad, filas, usuarios).
--  - Conserva los ids originales (las relaciones quedan iguales).
--  - Usuarios del respaldo se relacionan por nombre_usuario con los perfiles
--    existentes; si no existe, se asigna al admin que importa.
--  - FK = 0 ("sin seleccionar" en los formularios) → NULL; '' en columnas
--    que no son texto → NULL; campos que la tabla no tiene se ignoran.
--  - Conserva fecha_creacion / fecha_modificacion del respaldo.
--  - Si un registro ya existe (mismo id o misma clave única) se omite, así
--    que se puede volver a correr sin duplicar.
--  - Los adjuntos ya llegan con ruta_storage (el navegador sube el archivo
--    a Storage antes de llamar).
-- Solo un admin puede usarla.
-- =====================================================================
set check_function_bodies = off;

create or replace function privado.importar_entidad(p_entidad text, p_filas jsonb, p_usuarios jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_yo          bigint := privado.usuario_actual_id();
  v_tabla       text := lower(regexp_replace(p_entidad, '([a-z0-9])([A-Z])', '\1_\2', 'g'));
  v_esquema     text;
  v_mapa        jsonb := '{}';
  v_usr         jsonb;
  v_id          bigint;
  v_fila        jsonb;
  v_r           jsonb;
  v_limpia      jsonb;
  v_valor       jsonb;
  v_cols        text[];
  v_autorefs    text[];
  v_tiene_id    boolean;
  v_n           integer;
  v_ok          integer := 0;
  v_omitidos    integer := 0;
  v_errores     jsonb := '[]';
  v_col         text;
  -- columnas que guardan ids de usuario
  v_cols_usuario text[] := array['usuario_id','creado_por_usuario_id','asignado_usuario_id','reportado_por_usuario_id','creado_por'];
  v_nombres     text[];
  v_tipos       text[];
  v_nulos       boolean[];
  i             integer;
begin
  if not privado.es_admin() then
    raise exception 'Solo un administrador puede importar respaldos.';
  end if;

  select table_schema into v_esquema
  from information_schema.tables
  where table_name = v_tabla
    and table_schema in ('seguridad','panel_control','wikidocs','presupuesto','proyectos','familia')
  limit 1;
  if v_esquema is null or v_tabla = 'usuario' then
    return jsonb_build_object('entidad', p_entidad, 'sinTabla', true, 'filas', jsonb_array_length(coalesce(p_filas, '[]')));
  end if;

  -- Mapa id de usuario del respaldo -> id de seguridad.usuario
  for v_usr in select * from jsonb_array_elements(coalesce(p_usuarios, '[]')) loop
    select u.id into v_id from seguridad.usuario u where lower(u.nombre_usuario) = lower(v_usr->>'nombreUsuario');
    v_mapa := v_mapa || jsonb_build_object(v_usr->>'id', coalesce(v_id, v_yo));
  end loop;

  -- Columnas que apuntan a la misma tabla (padre/madre, subcategorías, ticket padre):
  -- se cargan en una segunda pasada para no depender del orden de las filas.
  select coalesce(array_agg(a.attname::text), '{}') into v_autorefs
  from pg_constraint k
  join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
  where k.contype = 'f' and k.conrelid = format('%I.%I', v_esquema, v_tabla)::regclass and k.confrelid = k.conrelid;

  -- Columnas de la tabla (se leen una sola vez).
  select array_agg(column_name::text order by ordinal_position),
         array_agg(data_type::text order by ordinal_position),
         array_agg(is_nullable = 'YES' order by ordinal_position)
    into v_nombres, v_tipos, v_nulos
  from information_schema.columns
  where table_schema = v_esquema and table_name = v_tabla;

  -- Notificaciones y bitácora no las referencia nadie: ids nuevos.
  v_tiene_id := v_tabla not in ('notificacion', 'bitacora');

  execute format('alter table %I.%I disable trigger trg_auditoria', v_esquema, v_tabla);

  for v_fila in select * from jsonb_array_elements(coalesce(p_filas, '[]')) loop
    -- camelCase -> snake_case
    select coalesce(jsonb_object_agg(lower(regexp_replace(k, '([a-z0-9])([A-Z])', '\1_\2', 'g')), v), '{}')
      into v_r from jsonb_each(v_fila) e(k, v);

    v_limpia := '{}';
    v_cols := '{}';
    for i in 1 .. coalesce(array_length(v_nombres, 1), 0) loop
      v_col := v_nombres[i];
      continue when not (v_r ? v_col);
      continue when v_col = 'id' and not v_tiene_id;
      continue when v_col = any (v_autorefs);
      v_valor := v_r -> v_col;
      if v_col like '%\_id' and v_col <> 'id' and v_valor = '0'::jsonb then v_valor := 'null'; end if;
      if v_tipos[i] not in ('text', 'character varying') and v_valor = '""'::jsonb then v_valor := 'null'; end if;
      if v_col = any (v_cols_usuario) and jsonb_typeof(v_valor) = 'number' then
        v_valor := coalesce(v_mapa -> (v_valor #>> '{}'), to_jsonb(v_yo));
      end if;
      continue when v_valor = 'null'::jsonb and not v_nulos[i];   -- deja el default de la columna
      v_limpia := v_limpia || jsonb_build_object(v_col, v_valor);
      v_cols := v_cols || v_col;
    end loop;

    if not ('creado_por' = any (v_cols)) then
      v_limpia := v_limpia || jsonb_build_object('creado_por', v_yo);
      v_cols := v_cols || 'creado_por'::text;
    end if;

    begin
      execute format(
        'insert into %I.%I (%s) overriding system value select %s from jsonb_populate_record(null::%I.%I, $1) on conflict do nothing',
        v_esquema, v_tabla,
        (select string_agg(format('%I', x), ', ') from unnest(v_cols) x),
        (select string_agg(format('%I', x), ', ') from unnest(v_cols) x),
        v_esquema, v_tabla)
      using v_limpia;
      get diagnostics v_n = row_count;
      if v_n > 0 then v_ok := v_ok + 1; else v_omitidos := v_omitidos + 1; end if;
    exception when others then
      v_omitidos := v_omitidos + 1;
      if jsonb_array_length(v_errores) < 5 then
        v_errores := v_errores || to_jsonb(format('id %s: %s', v_fila->>'id', sqlerrm));
      end if;
    end;
  end loop;

  -- Segunda pasada: referencias a la misma tabla.
  if array_length(v_autorefs, 1) > 0 then
    for v_fila in select * from jsonb_array_elements(coalesce(p_filas, '[]')) loop
      select coalesce(jsonb_object_agg(lower(regexp_replace(k, '([a-z0-9])([A-Z])', '\1_\2', 'g')), v), '{}')
        into v_r from jsonb_each(v_fila) e(k, v);
      foreach v_col in array v_autorefs loop
        if v_r ? v_col and jsonb_typeof(v_r -> v_col) = 'number' and (v_r ->> v_col)::bigint <> 0 then
          begin
            execute format('update %I.%I set %I = $1 where id = $2', v_esquema, v_tabla, v_col)
              using (v_r ->> v_col)::bigint, (v_r ->> 'id')::bigint;
          exception when others then
            if jsonb_array_length(v_errores) < 5 then
              v_errores := v_errores || to_jsonb(format('id %s (%s): %s', v_r->>'id', v_col, sqlerrm));
            end if;
          end;
        end if;
      end loop;
    end loop;
  end if;

  execute format('alter table %I.%I enable trigger trg_auditoria', v_esquema, v_tabla);

  if v_tiene_id then
    execute format(
      'select setval(pg_get_serial_sequence(%L, ''id''), greatest((select coalesce(max(id), 0) from %I.%I), 1))',
      v_esquema || '.' || v_tabla, v_esquema, v_tabla);
  end if;

  return jsonb_build_object('entidad', p_entidad, 'importados', v_ok, 'omitidos', v_omitidos, 'errores', v_errores);
end;
$$;

revoke all on function privado.importar_entidad(text, jsonb, jsonb) from public, anon;
grant execute on function privado.importar_entidad(text, jsonb, jsonb) to authenticated;

-- Punto de entrada expuesto en la API (esquema panel_control).
create or replace function panel_control.importar_entidad(p_entidad text, p_filas jsonb, p_usuarios jsonb)
returns jsonb
language sql security invoker set search_path = ''
as $$ select privado.importar_entidad(p_entidad, p_filas, p_usuarios) $$;

revoke all on function panel_control.importar_entidad(text, jsonb, jsonb) from public, anon;
grant execute on function panel_control.importar_entidad(text, jsonb, jsonb) to authenticated;

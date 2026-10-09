-- =====================================================================
-- Saurix · Supabase · 04 Corrección: el nombre del perfil creado al
-- registrarse ya no se recorta a 3 caracteres.
-- =====================================================================
create or replace function privado.crear_perfil_usuario()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_nombre_usuario text;
  v_nombre text;
  v_rol text;
begin
  v_nombre_usuario := coalesce(
    nullif(new.raw_user_meta_data->>'nombre_usuario', ''),
    split_part(new.email, '@', 1)
  );
  if char_length(v_nombre_usuario) < 4 then
    v_nombre_usuario := rpad(v_nombre_usuario, 4, '0');
  end if;
  if exists (select 1 from seguridad.usuario where lower(nombre_usuario) = lower(v_nombre_usuario)) then
    v_nombre_usuario := v_nombre_usuario || '_' || substr(replace(new.id::text, '-', ''), 1, 4);
  end if;

  v_nombre := left(coalesce(nullif(trim(new.raw_user_meta_data->>'nombre'), ''), v_nombre_usuario), 30);
  if char_length(v_nombre) < 3 then
    v_nombre := rpad(v_nombre, 3, '.');
  end if;

  v_rol := case when exists (select 1 from seguridad.usuario) then 'viewer' else 'admin' end;

  insert into seguridad.usuario (auth_user_id, nombre_usuario, nombre, apellido_paterno, apellido_materno, email, role)
  values (
    new.id,
    v_nombre_usuario,
    v_nombre,
    nullif(left(new.raw_user_meta_data->>'apellido_paterno', 30), ''),
    nullif(left(new.raw_user_meta_data->>'apellido_materno', 30), ''),
    new.email,
    v_rol
  )
  on conflict do nothing;
  return new;
end;
$$;

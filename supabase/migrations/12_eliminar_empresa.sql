-- =====================================================================
-- Saurix · Supabase · 12 Eliminar una empresa (solo superadmin)
-- Borra la empresa junto con lo que se le crea solo (Listas de valores
-- sembradas y Apariencia). Si ya tiene usuarios o datos capturados, no se
-- borra: hay que desactivarla.
-- =====================================================================
set check_function_bodies = off;

create or replace function seguridad.eliminar_empresa(p_empresa bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_mia bigint;
begin
  if not privado.es_superadmin() then
    raise exception 'Solo el superadministrador puede eliminar empresas.';
  end if;
  select empresa_id into v_mia from seguridad.usuario where auth_user_id = auth.uid();
  if p_empresa = v_mia then
    raise exception 'No puedes eliminar tu propia empresa.';
  end if;
  if exists (select 1 from seguridad.usuario where empresa_id = p_empresa) then
    raise exception 'La empresa tiene usuarios: elimínalos primero o desactiva la empresa.';
  end if;

  -- Salir de esa empresa si alguien estaba en modo soporte dentro de ella.
  update seguridad.usuario set empresa_activa_id = null where empresa_activa_id = p_empresa;

  delete from panel_control.valor_lista where empresa_id = p_empresa;
  delete from panel_control.configuracion_apariencia where empresa_id = p_empresa;

  begin
    delete from seguridad.empresa where id = p_empresa;
  exception when foreign_key_violation then
    raise exception 'La empresa ya tiene datos capturados: desactívala en lugar de eliminarla.';
  end;
end;
$$;
revoke all on function seguridad.eliminar_empresa(bigint) from public, anon;
grant execute on function seguridad.eliminar_empresa(bigint) to authenticated;

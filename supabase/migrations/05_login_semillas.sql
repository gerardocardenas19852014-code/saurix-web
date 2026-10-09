-- =====================================================================
-- Saurix · Supabase · 05 Login por nombre de usuario, foto de miembro
-- y valores iniciales de "Listas de valores".
-- =====================================================================

-- La pantalla de login pide "usuario" (no correo). Supabase Auth inicia
-- sesión con correo, así que esta función traduce nombre_usuario -> email.
-- Si ya viene un correo, lo regresa tal cual. Accesible sin sesión (anon).
create or replace function seguridad.email_para_login(p_usuario text)
returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when position('@' in coalesce(p_usuario, '')) > 0 then trim(p_usuario)
    else (select u.email from seguridad.usuario u
          where lower(u.nombre_usuario) = lower(trim(p_usuario))
          limit 1)
  end
$$;
revoke all on function seguridad.email_para_login(text) from public;
grant execute on function seguridad.email_para_login(text) to anon, authenticated;

-- La app guarda la foto del miembro como data URL pequeña (miniatura).
alter table familia.miembro_familia rename column foto_ruta to foto;

-- Valores iniciales (antes los sembraba SeedService en IndexedDB).
insert into panel_control.valor_lista (grupo, clave, etiqueta, orden) values
  ('CuentaPresupuestoTipo','Efectivo','Efectivo',1),
  ('CuentaPresupuestoTipo','Banco','Banco',2),
  ('CuentaPresupuestoTipo','Tarjeta','Tarjeta',3),
  ('CuentaPresupuestoTipo','Ahorro','Ahorro',4),
  ('MovimientoPresupuestoTipo','Ingreso','Ingreso',1),
  ('MovimientoPresupuestoTipo','Gasto','Gasto',2),
  ('MovimientoRecurrenteFrecuencia','Mensual','Mensual',1),
  ('MovimientoRecurrenteFrecuencia','Anual','Anual',2),
  ('PresupuestoAnualEstatus','Creacion','Creación',1),
  ('PresupuestoAnualEstatus','Proyeccion','Proyección',2),
  ('PresupuestoAnualEstatus','Autorizado','Autorizado',3),
  ('PresupuestoAnualEstatus','Ejecutado','Ejecutado',4)
on conflict (grupo, clave) do nothing;

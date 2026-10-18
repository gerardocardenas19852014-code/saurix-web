-- 28_tienda_publica_fix_grants.sql
-- La migración 27 (tienda pública) solo otorgó EXECUTE sobre las 2 funciones
-- públicas a `anon`. Pero el cliente de Supabase (supabase-js) siempre manda
-- el JWT de la sesión activa si el usuario ya está logueado en el panel —
-- no hay forma de "forzar anon" sin cerrar sesión. Resultado: cualquier
-- usuario logueado que visite /tienda/:clave recibía 403 (Postgres 42501,
-- insufficient_privilege) porque el rol `authenticated` nunca tuvo permiso.
-- Esta migración solo agrega ese grant faltante; no cambia nada más.

grant execute on function seguridad.tiendas_activas() to authenticated;
grant execute on function seguridad.tienda_detalle(text) to authenticated;

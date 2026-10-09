-- =====================================================================
-- Saurix · Supabase · 06 Corrección del login
-- anon necesita USAGE en el esquema seguridad para poder llamar
-- seguridad.email_para_login (sigue sin privilegios sobre sus tablas).
-- =====================================================================
grant usage on schema seguridad to anon;

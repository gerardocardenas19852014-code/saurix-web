-- =====================================================================
-- Saurix · Supabase · 09b Quitar claves únicas globales
-- Ya existen sus equivalentes POR EMPRESA (ver 09_empresas). Sin esto, dos
-- empresas no podrían usar la misma clave de proyecto, tipo de ticket, etc.
-- Correr en el SQL Editor de Supabase.
-- =====================================================================
alter table proyectos.proyecto        drop constraint if exists proyecto_clave_key;
alter table proyectos.ticket_tipo     drop constraint if exists ticket_tipo_clave_key;
alter table proyectos.ticket_prioridad drop constraint if exists ticket_prioridad_clave_key;
alter table proyectos.ticket_modulo   drop constraint if exists ticket_modulo_clave_key;
alter table seguridad.rol             drop constraint if exists rol_nombre_key;
alter table seguridad.permiso         drop constraint if exists permiso_nombre_key;

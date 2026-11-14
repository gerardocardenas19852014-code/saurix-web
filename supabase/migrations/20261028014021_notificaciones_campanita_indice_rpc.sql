
-- BLOQUE A (notificaciones): índice parcial para la campanita — solo indexa
-- notificaciones NO leídas, así el índice se queda chico para siempre (en
-- cuanto se marca leída, sale del índice), cubre tanto el ORDER BY
-- fecha_creacion DESC LIMIT 10 como el COUNT(*) de no leídas, ambos
-- filtrados por usuario_id.
create index if not exists notificacion_usuario_pendientes_ix
  on seguridad.notificacion (usuario_id, fecha_creacion desc)
  where leida = false;

-- Reemplaza, en modo Supabase, a NotificacionesService.recargar() (que hoy
-- hace list('Notificacion', {usuarioId, leida:false}) SIN LIMIT y corta a
-- 10 en el navegador con .slice()). Esta función hace el LIMIT real en
-- PostgreSQL y devuelve en la misma vuelta el total REAL de no leídas (vía
-- count(*) over(), calculado sobre el conjunto filtrado completo ANTES del
-- LIMIT, no sobre las 10 filas devueltas) — antes totalNoLeidas se calculaba
-- en Angular como notificaciones().filter(n=>!n.leida).length, que al venir
-- la lista ya topada a 10, nunca podía mostrar más de 10 aunque hubiera 47
-- pendientes reales (bug encontrado durante esta optimización, se corrige
-- de paso).
-- SECURITY INVOKER (por omisión): respeta RLS tal cual (notificacion_ver:
-- usuario_id = yo OR creado_por = yo; solo_mi_empresa), mismo criterio que
-- el resto de las funciones de Saurix.
create or replace function seguridad.fn_notificaciones_campanita(p_limite integer default 10)
returns table (
  id bigint,
  titulo text,
  link text,
  fecha_creacion timestamptz,
  total_no_leidas bigint
)
language sql
stable
set search_path = ''
as $function$
  select n.id, n.titulo, n.link, n.fecha_creacion, count(*) over() as total_no_leidas
  from seguridad.notificacion n
  where n.usuario_id = (select privado.usuario_actual_id())
    and n.leida = false
  order by n.fecha_creacion desc
  limit greatest(1, coalesce(p_limite, 10));
$function$;

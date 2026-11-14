
-- Mismo criterio que tienda_detalle(): el portal de tiendas (/tienda) ya
-- no debe transportar el logo en base64 — usa la URL de Storage.
create or replace function seguridad.tiendas_activas()
returns table(clave text, nombre text, descripcion text, logo text)
language sql
stable
security definer
set search_path = ''
as $function$
  select e.clave, e.nombre, e.descripcion_publica, e.logo_url
  from seguridad.empresa e
  where e.activo and e.catalogo_publico_activo
  order by e.nombre
$function$;

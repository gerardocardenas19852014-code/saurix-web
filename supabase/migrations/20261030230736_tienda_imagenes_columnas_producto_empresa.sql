
-- URLs públicas derivadas de producto.foto (que sigue siendo la fuente que
-- edita el staff en Productos y servicios, sin cambios). foto_version se
-- incrementa en cada cambio de foto para que la URL incluya la versión
-- (cache-busting real: una URL con versión nueva nunca choca con la
-- cacheada por el navegador/CDN de la versión anterior).
alter table inventario.producto
  add column if not exists foto_thumb_url text,
  add column if not exists foto_detalle_url text,
  add column if not exists foto_version bigint not null default 0;

alter table seguridad.empresa
  add column if not exists logo_url text,
  add column if not exists logo_version bigint not null default 0;

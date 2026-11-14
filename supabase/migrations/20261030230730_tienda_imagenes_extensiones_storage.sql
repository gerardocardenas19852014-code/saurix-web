
-- pg_net para poder llamar la Edge Function de procesamiento de imágenes
-- desde un trigger, de forma asíncrona (no bloquea el INSERT/UPDATE).
create extension if not exists pg_net;

-- Bucket público para imágenes de catálogo (thumbnails + detalle de
-- producto, logo de tienda). Separado de "adjuntos" (privado, 10MB,
-- adjuntos internos) porque este debe ser leíble sin autenticación vía
-- URL directa, con límite y tipos acotados a imagen.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('catalogo-publico', 'catalogo-publico', true, 2097152, array['image/jpeg','image/webp','image/png'])
on conflict (id) do nothing;

-- Lectura: pública (bucket marcado public=true ya sirve los objetos sin
-- pasar por RLS vía la URL .../object/public/..., pero se agrega política
-- de SELECT explícita para quien consulte storage.objects directo, p.ej.
-- el propio panel de administración).
create policy "catalogo_publico_ver" on storage.objects
  for select
  using (bucket_id = 'catalogo-publico');

-- Escritura: solo la Edge Function (rol service_role, que no pasa por RLS)
-- y el propio staff autenticado de la empresa dueña de la carpeta
-- empresa_<id>/..., igual que el patrón ya usado en "adjuntos".
create policy "catalogo_publico_subir" on storage.objects
  for insert
  with check (
    bucket_id = 'catalogo-publico'
    and (storage.foldername(name))[1] = ('empresa_' || (select privado.empresa_actual_id()))
  );

create policy "catalogo_publico_actualizar" on storage.objects
  for update
  using (
    bucket_id = 'catalogo-publico'
    and (storage.foldername(name))[1] = ('empresa_' || (select privado.empresa_actual_id()))
  );

create policy "catalogo_publico_borrar" on storage.objects
  for delete
  using (
    bucket_id = 'catalogo-publico'
    and (storage.foldername(name))[1] = ('empresa_' || (select privado.empresa_actual_id()))
  );

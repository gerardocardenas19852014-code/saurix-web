-- =====================================================================
-- Saurix · Supabase · 03 Storage para adjuntos
-- Bucket privado "adjuntos". Convención de ruta sugerida:
--   {Entidad}/{padreId}/{uuid}-{nombreArchivo}
--   p.ej. TicketAdjunto/42/9f1c...-captura.png
-- Las tablas *_adjunto guardan esa ruta en ruta_storage.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('adjuntos', 'adjuntos', false, 10485760)  -- 10 MB por archivo
on conflict (id) do nothing;

create policy adjuntos_ver on storage.objects for select to authenticated
  using (bucket_id = 'adjuntos' and (select privado.usuario_actual_id()) is not null);
create policy adjuntos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'adjuntos' and (select privado.usuario_actual_id()) is not null);
create policy adjuntos_actualizar on storage.objects for update to authenticated
  using (bucket_id = 'adjuntos' and (select privado.usuario_actual_id()) is not null)
  with check (bucket_id = 'adjuntos' and (select privado.usuario_actual_id()) is not null);
create policy adjuntos_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'adjuntos' and (select privado.usuario_actual_id()) is not null);

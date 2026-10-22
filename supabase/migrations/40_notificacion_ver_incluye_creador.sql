-- =====================================================================
-- Saurix · Supabase · 40 Notificaciones: permitir ver las que uno mismo
-- creó para otra persona
--  - Bug real: notificar a OTRO usuario (asignar un ticket, mencionar a
--    alguien, SLA de alguien más — ver notificaciones.service.ts) fallaba
--    con 403 "No tienes permiso para esta operación" y el INSERT se
--    abortaba por completo (no solo el toast salía feo).
--  - Causa: el cliente de Supabase (SupabaseDataClientService.insertar())
--    siempre hace `.insert(...).select().single()`, es decir, un
--    `INSERT ... RETURNING`. Postgres filtra esa fila devuelta con la
--    política de SELECT de la tabla — y notificacion_ver solo dejaba ver
--    notificaciones dirigidas a uno mismo (usuario_id = usuario_actual_id()).
--    Como la notificación es para OTRA persona, esa fila no pasaba el
--    SELECT y Postgres rechazaba el INSERT completo con
--    "new row violates row-level security policy for table notificacion".
--    Las notificaciones a uno mismo (alertas de stock bajo, etc.)
--    sí funcionaban porque ahí usuario_id SÍ coincide.
--  - Fix: además de ver lo dirigido a uno, se puede ver lo que uno mismo
--    creó (creado_por, columna de auditoría ya confiable vía
--    privado.auditoria(), trigger trg_auditoria). Esto solo habilita leer
--    de vuelta lo que uno acaba de insertar para otro usuario; seguir
--    viendo/editando/borrando notificaciones ajenas sigue bloqueado
--    (notificacion_actualizar/notificacion_borrar no cambiaron).
-- =====================================================================
alter policy notificacion_ver on seguridad.notificacion
  using (
    usuario_id = (select privado.usuario_actual_id())
    or creado_por = (select privado.usuario_actual_id())
  );

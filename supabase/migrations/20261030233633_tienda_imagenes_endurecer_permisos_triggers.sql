
-- Son funciones de TRIGGER (returns trigger): Postgres ya rechaza llamarlas
-- fuera de un trigger ("trigger functions can only be called as
-- triggers"), pero por default toda función nueva queda con EXECUTE para
-- PUBLIC — el advisor de seguridad las marca como invocables por anon/
-- authenticated vía /rest/v1/rpc/. Se revoca ese EXECUTE explícitamente
-- (defensa en profundidad, igual criterio que seguridad.fn_verificar_secreto_webhook).
revoke all on function inventario.fn_trigger_procesar_foto_producto() from public, anon, authenticated;
revoke all on function seguridad.fn_trigger_procesar_logo_empresa() from public, anon, authenticated;

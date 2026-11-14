-- Mismo endurecimiento ya aplicado a fn_trigger_procesar_logo_empresa:
-- esta función solo debe dispararse vía el trigger (seguridad.empresa),
-- nunca ser llamable directamente por anon/authenticated a través de
-- /rest/v1/rpc/.
revoke execute on function seguridad.fn_trigger_procesar_portada_empresa() from public;
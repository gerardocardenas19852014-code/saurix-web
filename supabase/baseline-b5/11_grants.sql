-- ============================================================================
-- SAURIX — Línea base reproducible (Etapa B5.1, corregida en Corrección 1,
-- 2026-11-11) — Permisos (GRANTs) y privilegios por defecto.
-- NUEVO en Corrección 1: la línea base de B5.1 extraía DDL de tablas, funciones,
-- índices, triggers y políticas RLS, pero NO extraía los GRANT explícitos a
-- anon/authenticated/service_role. Sin este archivo, las políticas RLS de los
-- 10 archivos anteriores son insuficientes por sí solas: PostgreSQL exige TANTO
-- el privilegio de tabla (GRANT) COMO el permiso de fila (RLS) — sin GRANT,
-- ningún rol de aplicación puede ni siquiera intentar la operación, sin
-- importar lo que digan las políticas.
--
-- Generado por introspección de pg_catalog/information_schema el 2026-11-11,
-- reflejando el estado EXACTO verificado en producción (ver
-- claude/saurix-b5-1-correccion1-validacion-linea-base-2026-11.md, Bloque C).
--
-- UNDÉCIMO archivo a ejecutar — después de 01_privado.sql .. 10_ventas.sql
-- (los GRANT sobre "ALL TABLES IN SCHEMA x" requieren que las tablas ya
-- existan; en Postgres también pueden emitirse antes si se usa ALTER DEFAULT
-- PRIVILEGES únicamente, pero aquí se aplican los dos tipos de sentencia y es
-- más simple/seguro ejecutarlo al final).
--
-- Se ejecuta como el rol `postgres` (o un rol con sus mismos privilegios) —
-- es el rol que posee todos los objetos en producción (ver Bloque C del
-- informe de Corrección 1: "propietarios de objetos" — 100% `postgres`,
-- sin excepción, en los 11 esquemas de aplicación).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- USAGE sobre esquemas (sin esto, ningún GRANT sobre tablas de ese esquema
-- tiene efecto para un rol que llega desde PostgREST/el cliente)
-- ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA privado TO authenticated;
GRANT USAGE ON SCHEMA comercial TO anon, authenticated;
GRANT USAGE ON SCHEMA seguridad TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA familia, inventario, panel_control, presupuesto, proyectos, ventas, wikidocs
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- comercial: único esquema con exposición pública parcial. Solo
-- plan_pagina_web es de lectura pública; mensaje_contacto NO tiene ningún
-- GRANT a anon/authenticated (coincide con que tiene RLS habilitado y 0
-- políticas — solo accesible por service_role, p. ej. desde una Edge
-- Function). No otorgar aquí nada adicional sobre mensaje_contacto.
-- ----------------------------------------------------------------------------
GRANT SELECT ON comercial.plan_pagina_web TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- Los 8 esquemas de aplicación multiempresa: CRUD completo para
-- `authenticated` (acotado después por las políticas RLS de cada tabla),
-- y privilegios completos (incluye TRUNCATE/REFERENCES/TRIGGER) para
-- `service_role`, que es como está hoy en producción. `anon` no tiene
-- ningún privilegio sobre estos 8 esquemas.
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA familia TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA familia TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA familia TO authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA inventario TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA inventario TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA inventario TO authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA panel_control TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA panel_control TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA panel_control TO authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA presupuesto TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA presupuesto TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA presupuesto TO authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA proyectos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA proyectos TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA proyectos TO authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA seguridad TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA seguridad TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA seguridad TO authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ventas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA ventas TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ventas TO authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA wikidocs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA wikidocs TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA wikidocs TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- privado: SIN grants a anon/authenticated/service_role sobre su única tabla
-- nueva (configuracion_entorno) — a propósito. Solo el rol que aprovisiona
-- (postgres) debe poder leerla/escribirla directamente; el resto del sistema
-- la usa indirectamente a través de privado.fn_config_imagenes_requerida(),
-- que es SECURITY DEFINER y corre con los privilegios de su propietario.
-- No añadir GRANT sobre privado.configuracion_entorno sin una razón explícita.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- Hallazgo de B5.2, Fase 1 (preflight) — permiso de ejecución de función:
-- por defecto, PostgreSQL otorga EXECUTE sobre cualquier función nueva a
-- PUBLIC (es decir, a anon/authenticated también, salvo que se revoque
-- explícitamente). privado.fn_config_imagenes_requerida() no la necesita
-- llamar ningún rol de la API — solo la invocan, internamente, las 3
-- funciones trigger de imágenes (seguridad.fn_trigger_procesar_logo_empresa,
-- seguridad.fn_trigger_procesar_portada_empresa,
-- inventario.fn_trigger_procesar_foto_producto), todas SECURITY DEFINER
-- propiedad de postgres, que no necesitan un GRANT porque ya son el
-- propietario de la función que llaman. Se revoca aquí el EXECUTE por
-- defecto de PUBLIC para que ningún cliente pueda invocarla directamente
-- (p. ej. como RPC, si el esquema `privado` llegara a exponerse alguna vez):
-- hoy no habría ningún secreto que filtrar (los valores de
-- configuracion_entorno no son secretos de Vault), pero no hay ninguna razón
-- para dejar esa vía abierta.
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION privado.fn_config_imagenes_requerida() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- Privilegios por defecto para objetos FUTUROS (así una tabla nueva creada
-- después de este aprovisionamiento recibe automáticamente los mismos
-- permisos, sin depender de que alguien recuerde otorgarlos a mano).
-- Reproduce exactamente lo ya configurado hoy en producción para el rol
-- `postgres` en estos 8 esquemas (verificado vía pg_default_acl).
-- ----------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA familia
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA familia
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA familia
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA inventario
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA inventario
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA inventario
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA panel_control
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA panel_control
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA panel_control
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA presupuesto
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA presupuesto
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA presupuesto
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA proyectos
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA proyectos
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA proyectos
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA seguridad
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA seguridad
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA seguridad
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ventas
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ventas
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ventas
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA wikidocs
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA wikidocs
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA wikidocs
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- NOTA sobre `public`: no se incluyen sentencias para el esquema `public`
-- porque está confirmado vacío (0 objetos) y porque cualquier proyecto
-- Supabase nuevo nace con sus propios privilegios por defecto sobre `public`
-- ya configurados automáticamente por la plataforma (verificado: existen
-- entradas de pg_default_acl puestas por el rol `supabase_admin`, no por
-- Saurix) — no hay nada específico de la aplicación que reproducir ahí.
-- ----------------------------------------------------------------------------

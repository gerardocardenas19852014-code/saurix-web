-- La política "modulo_habilitado" se creaba con la llamada a la función
-- SIN envolver en (select ...): privado.modulo_habilitado('<modulo>'::text).
-- Aunque la función es STABLE, sin el envoltorio (select ...) Postgres NO
-- la cachea como InitPlan: la evalúa una vez POR CADA FILA examinada por el
-- scan, en vez de una sola vez por consulta. A escala pequeña es
-- imperceptible, pero con tablas grandes (la prueba de rendimiento de
-- 200,000 tickets lo expuso: un conteo que debía tardar ~50ms tardó
-- 23 SEGUNDOS y causó un 500 por "statement timeout" en el Kanban) se
-- vuelve un cuello de botella que crece con el número de filas.
--
-- El arreglo es envolver la misma llamada en (select ...) — exactamente el
-- patrón que ya usan correctamente "compartida_todo" y "solo_mi_empresa" en
-- estas mismas tablas. No cambia la lógica de la política, solo le permite
-- a Postgres evaluarla una sola vez por consulta en vez de una vez por fila.
--
-- Afecta 58 tablas en 4 módulos (proyectos.ticket ya se corrigió antes, por
-- separado, al diagnosticar el 500 del Kanban).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, qual, with_check
    FROM pg_policies
    WHERE policyname = 'modulo_habilitado'
      AND schemaname NOT IN ('pg_catalog', 'information_schema')
      AND (qual NOT LIKE '%( SELECT%' OR with_check NOT LIKE '%( SELECT%')
  LOOP
    EXECUTE format(
      'ALTER POLICY modulo_habilitado ON %I.%I USING ((select %s)) WITH CHECK ((select %s))',
      r.schemaname, r.tablename, r.qual, r.with_check
    );
  END LOOP;
END $$;

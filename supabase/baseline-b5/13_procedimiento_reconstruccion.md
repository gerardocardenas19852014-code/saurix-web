# SAURIX — Línea base reproducible (Etapa B5.1/B5.2, última corrección 2026-11-11) — Bloque D: Procedimiento de reconstrucción y gobierno de migraciones futuras

**Corrección 1 (2026-11-11):** este documento reemplaza por completo la versión de B5.1. El orden de ejecución original tenía un error de dependencias (varios esquemas con llave foránea hacia `seguridad` estaban numerados — y por lo tanto se ejecutarían — antes que `seguridad` mismo). Los 10 archivos SQL se **renombraron** para que el prefijo numérico sea, esta vez, el orden real de ejecución. Ver Bloque C del informe `claude/saurix-b5-1-correccion1-validacion-linea-base-2026-11.md` para el detalle completo de cómo se detectó y verificó.

**B5.2, Fase 1 — Preflight (2026-11-11), correcciones adicionales antes de cualquier ejecución:**
1. **Hallazgo crítico, corregido:** dentro de CADA UNO de los 9 archivos `02_seguridad.sql` .. `10_ventas.sql`, las sentencias `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` estaban colocadas **antes** de las sentencias `CREATE TABLE` correspondientes (un artefacto de cómo el script de introspección agrupó las banderas de RLS, separado de la creación de columnas). Ejecutado tal cual, el primer archivo con tablas (`02_seguridad.sql`) habría fallado en su segunda sentencia útil con `relation "seguridad.bitacora" does not exist` — la restauración no habría llegado ni a terminar el primer archivo. Se corrigió moviendo, en los 9 archivos, el bloque de `ENABLE ROW LEVEL SECURITY` de cada tabla a **después** de todas las sentencias `CREATE TABLE` del archivo y **antes** de las sentencias `ALTER TABLE ... ADD CONSTRAINT`. Se verificó, tabla por tabla y archivo por archivo, que el número de tablas, funciones, políticas y triggers de cada archivo es idéntico antes y después de la corrección — solo cambió el orden, no el contenido.
2. `privado.configuracion_entorno` ahora tiene RLS habilitado (sin ninguna política — denegación por defecto), como una segunda barrera además de la ausencia de GRANT a `anon`/`authenticated`/`service_role`.
3. `11_grants.sql` ahora incluye `REVOKE EXECUTE ON FUNCTION privado.fn_config_imagenes_requerida() FROM PUBLIC;`, para que ningún rol de la API pueda invocar esa función directamente (solo la llaman, internamente, las 3 funciones trigger de imágenes, que no necesitan GRANT porque corren como el propietario de la función).

Ver el informe `claude/saurix-b5-2-primera-restauracion-2026-11.md`, Fase 1, para el detalle completo.

## D.1 — Ubicación de la línea base y separación de las migraciones históricas

- Los **140 archivos históricos** de `supabase/migrations/` permanecen **intactos**, sin modificar, mover ni eliminar ninguno. Esta auditoría (B5.1 y esta Corrección 1) no tocó ese directorio en ningún momento.
- La línea base versionada se deposita en una carpeta **separada**: `supabase/baseline-b5/`, en la raíz del repositorio, al mismo nivel que `supabase/migrations/` — **nunca dentro de ella**.
- Motivo: cualquier herramienta de migración (Supabase CLI, un pipeline de CI/CD, un script local) que recorra `supabase/migrations/` por convención de nombre/orden ejecutaría automáticamente cualquier archivo `.sql` que encontrara ahí. Al vivir en `supabase/baseline-b5/`, estos archivos quedan fuera de ese barrido automático y solo se ejecutan cuando un humano los invoca explícitamente contra el proyecto B5 nuevo.
- Contenido actual de `supabase/baseline-b5/` (13 archivos — antes 12; se agregó `11_grants.sql`):
  ```
  supabase/baseline-b5/
    01_privado.sql              (esquema privado — PRIMERO; incluye la nueva
                                  tabla de configuración y la función de validación)
    02_seguridad.sql             (esquema seguridad — SEGUNDO, antes que todo
                                  lo que depende de seguridad.empresa/usuario)
    03_comercial.sql
    04_familia.sql
    05_panel_control.sql
    06_presupuesto.sql
    07_proyectos.sql
    08_wikidocs.sql
    09_inventario.sql            (antes que ventas, ver D.2)
    10_ventas.sql
    11_grants.sql                 (NUEVO en Corrección 1 — GRANT y privilegios por defecto)
    12_manifiesto_componentes.md
    13_procedimiento_reconstruccion.md (este archivo)
  ```
  (El esquema `public` no requiere archivo: se confirmó vacío — 0 tablas, 0 funciones, 0 políticas, 0 triggers.)

## D.2 — Orden de ejecución correcto para provisionar B5

Los archivos deben ejecutarse en **este orden exacto**, verificado contra las llaves foráneas cruzadas reales de producción (consulta dedicada sobre `pg_constraint`, ver informe de Corrección 1, Bloque C):

1. **`01_privado.sql`** — sin FKs posibles (0 tablas), pero sus funciones (`empresa_actual_id()`, `usuario_actual_id()`, `modulo_habilitado()`, `auditoria()`, y ahora `fn_config_imagenes_requerida()`) son usadas como `DEFAULT` de columna, en políticas RLS y en triggers de **todos** los demás esquemas — debe existir antes que cualquier `CREATE TABLE` que las referencie en un `DEFAULT`.
2. **`02_seguridad.sql`** — **debe ir aquí, no al final.** Se verificó que `familia`, `inventario`, `panel_control`, `presupuesto`, `proyectos`, `ventas` y `wikidocs` tienen, cada uno, llaves foráneas hacia `seguridad.empresa` y/o `seguridad.usuario`. Si `seguridad` se crea después de esos esquemas (como ocurría en la numeración original de B5.1), cada `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY ... REFERENCES seguridad.empresa(id)` falla con `relation "seguridad.empresa" does not exist`.
3. `03_comercial.sql` — sin FKs cruzadas hacia ningún otro esquema de aplicación (verificado); puede ir en cualquier punto después de `seguridad`, se deja aquí por simplicidad.
4. `04_familia.sql`
5. `05_panel_control.sql`
6. `06_presupuesto.sql`
7. `07_proyectos.sql`
8. `08_wikidocs.sql`
9. **`09_inventario.sql`** — antes de `ventas`. Además de la dependencia de FK (`ventas.venta_item`, `ventas.cotizacion_item`, etc. referencian `inventario.producto`/`inventario.bodega`/`inventario.tipo_lista_precio`), varias funciones `LANGUAGE sql` de `ventas` (p. ej. `fn_dashboard_ventas_top_productos`, que hace `JOIN inventario.producto`) **se validan contra el catálogo en el momento de `CREATE FUNCTION`**, no solo al ejecutarse — a diferencia de una función `plpgsql` (que compila perezosamente en su primera llamada), una función `LANGUAGE sql` que referencia una tabla inexistente puede fallar al crearse. Por eso `inventario` no es opcionalmente anterior a `ventas`: es obligatorio.
10. `10_ventas.sql`
11. **`11_grants.sql`** — al final, porque usa `GRANT ... ON ALL TABLES IN SCHEMA x`, que necesita que las tablas ya existan.

**Antes de que cualquier trigger de imágenes pueda ejecutarse** (no antes de aplicar el DDL, pero sí antes de que la aplicación suba una foto/logo/portada real): completar la configuración en `privado.configuracion_entorno` —
```sql
update privado.configuracion_entorno set valor = '<url de la Edge Function tienda-imagenes en B5>', fecha_modificacion = now() where clave = 'imagenes_webhook_url';
update privado.configuracion_entorno set valor = '<clave anon/publishable de B5>', fecha_modificacion = now() where clave = 'imagenes_anon_key';
```
Si no se hace, las 3 funciones trigger (`seguridad.fn_trigger_procesar_logo_empresa`, `seguridad.fn_trigger_procesar_portada_empresa`, `inventario.fn_trigger_procesar_foto_producto`) **lanzan una excepción y no llaman a ninguna URL** — no fallan en silencio ni caen de vuelta a producción. Ver Bloque B del informe de Corrección 1 para el diseño completo de esta validación, incluida la verificación previa descrita en D.2.1 a continuación.

### D.2.1 — Verificación previa (pre-flight) recomendada antes de dar por buena la restauración de prueba

Después de ejecutar los 11 archivos SQL y antes de considerar terminada una primera restauración de prueba, ejecutar esta consulta de verificación (de solo lectura, sin efectos secundarios) contra el proyecto B5:

```sql
select
  (select count(*) from pg_namespace where nspname in
    ('comercial','familia','inventario','panel_control','presupuesto','privado','proyectos','seguridad','ventas','wikidocs')) as esquemas_creados,
  (select valor from privado.configuracion_entorno where clave='imagenes_webhook_url') as url_configurada,
  (select valor from privado.configuracion_entorno where clave='imagenes_anon_key') as anon_configurada,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('comercial','familia','inventario','panel_control','presupuesto','privado','proyectos','seguridad','ventas','wikidocs')) as total_funciones,
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('comercial','familia','inventario','panel_control','presupuesto','privado','proyectos','seguridad','ventas','wikidocs') and c.relkind='r') as total_tablas;
```

Resultado esperado si la restauración fue completa: `esquemas_creados = 10`, `total_tablas = 106` (más la nueva `privado.configuracion_entorno` = 107), `total_funciones = 94` (más `fn_config_imagenes_requerida` = 95). `url_configurada`/`anon_configurada` deberán seguir en `NULL` justo después de ejecutar el DDL — eso es correcto y esperado hasta que se complete el paso de configuración de D.2; **no** son un error, son la prueba de que el bloqueo por defecto funciona.

## D.3 — Gobierno de migraciones futuras, una vez adoptada la nueva línea base

- A partir de la adopción de esta línea base como punto de partida de B5, **ya no se debe seguir numerando migraciones sobre el historial de 140 archivos** de `supabase/migrations/` del proyecto de producción actual — ese historial queda congelado como registro arqueológico del proyecto original.
- El proyecto B5 nuevo inicia su **propio** directorio de migraciones, con una numeración/fecha que parte de cero a partir de la fecha de creación de B5 — **no se reutiliza ni se continúa la numeración `2026-11-*` del proyecto actual**.
- La decisión definitiva de **cómo** se gestionarán las migraciones de B5 en adelante (Supabase CLI local + control de versiones, generación automática de diffs, o aplicación manual vía MCP) sigue siendo una decisión de **B5.2 o posterior**, no de esta corrección.
- **No se insertó ningún registro en `schema_migrations`** durante B5.1 ni durante esta Corrección 1.

## D.4 — Confirmación de restricciones respetadas en esta Corrección 1

- No se modificó la producción actual (proyecto `fcumlscwxcmzxkknjjgo`) en ningún momento — todas las consultas contra producción fueron `select`/lecturas de catálogo.
- No se escribió ningún `insert`/`update`/`delete`/`create`/`alter`/`drop` contra la base de datos real.
- No se modificó código Angular, Edge Functions desplegadas, Storage ni Auth del proyecto real.
- No se creó ningún proyecto Supabase nuevo.
- No se ejecutó ninguna migración histórica.
- No se realizó ningún despliegue.
- Todo lo corregido en esta etapa está limitado a los archivos locales de `supabase/baseline-b5/` y a su documentación asociada, exactamente como autorizó el mandato de Corrección 1.

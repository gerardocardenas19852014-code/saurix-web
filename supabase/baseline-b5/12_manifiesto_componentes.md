# SAURIX — Línea base reproducible (Etapa B5.1, corregida en Corrección 1, 2026-11-11) — Bloque C: Manifiestos de componentes

**Fecha de generación:** 2026-11-11 (actualizado en Corrección 1, 2026-11-11) · **Método:** introspección de solo lectura (SQL vía `pg_catalog`/`information_schema`/`vault.secrets`/`storage.buckets`, y las herramientas de gestión de Supabase `list_extensions`, `list_edge_functions`, `get_project`). Ningún secreto real, credencial ni dato de cliente fue extraído o copiado en este documento.

Este archivo cubre los componentes de Saurix que NO forman parte del DDL de los 11 esquemas de aplicación: `01_privado.sql`, `02_seguridad.sql`, `03_comercial.sql`, `04_familia.sql`, `05_panel_control.sql`, `06_presupuesto.sql`, `07_proyectos.sql`, `08_wikidocs.sql`, `09_inventario.sql`, `10_ventas.sql`, más `11_grants.sql` (nuevo en Corrección 1 — ver Bloque C del informe de corrección). Storage, Auth, Edge Functions, Vault, Cron y Extensions, más el procedimiento de datos de prueba ficticios. Cada sección es un manifiesto independiente, tal como exige el mandato (Bloque C).

**Nota de numeración (Corrección 1):** los archivos SQL se renombraron para que el prefijo numérico coincida con el orden de ejecución real (antes no coincidía: varios esquemas con llave foránea hacia `seguridad` estaban numerados antes que `seguridad` mismo). Ver `13_procedimiento_reconstruccion.md` para el orden completo y su justificación.

---

## C.1 — Storage

### Buckets (2)

| id | público | límite de tamaño | tipos MIME permitidos | creado |
|---|---|---|---|---|
| `adjuntos` | No | 10 MB (10485760 B) | sin restricción (`null`) | 2026-10-09 |
| `catalogo-publico` | **Sí** | 2 MB (2097152 B) | `image/jpeg`, `image/webp`, `image/png` | 2026-10-30 |

### Políticas sobre `storage.objects` (6)

| Política | Permisiva/Restrictiva | Comando | Roles | Regla |
|---|---|---|---|---|
| `adjuntos_ver` | PERMISSIVE | SELECT | authenticated | `bucket_id = 'adjuntos'` y usuario autenticado |
| `adjuntos_subir` | PERMISSIVE | INSERT | authenticated | igual, en `with_check` |
| `adjuntos_actualizar` | PERMISSIVE | UPDATE | authenticated | igual |
| `adjuntos_borrar` | PERMISSIVE | DELETE | authenticated | igual |
| `adjuntos_solo_mi_empresa` | **RESTRICTIVE** | ALL | authenticated | si el bucket es `adjuntos`, la primera carpeta de la ruta debe ser `empresa_<empresa_actual_id()>` — aísla adjuntos por empresa |
| `catalogo_publico_ver` | PERMISSIVE | **SELECT únicamente** | `public` (cualquiera, incluye `anon`) | `bucket_id = 'catalogo-publico'` |

**Confirmación explícita (Bloque B):** sobre `catalogo-publico` existe **únicamente** una política de lectura (`SELECT`). No existe ninguna política de escritura directa (`INSERT`/`UPDATE`/`DELETE`) para roles públicos — la política histórica de escritura directa reportada en etapas anteriores de Corrección 2 ya no está presente en el estado actual.

### Procedimiento de reconstrucción

1. Crear ambos buckets en el proyecto B5 con los mismos parámetros (público/privado, límite de tamaño, tipos MIME).
2. Recrear las 6 políticas de `storage.objects` listadas arriba, verbatim.
3. No copiar ningún objeto/archivo real: poblar con 1–2 archivos ficticios mínimos (p. ej. una imagen de prueba) solo si se necesita para pruebas funcionales.

---

## C.2 — Auth

Ya documentado en detalle en `claude/saurix-correccion2-etapa-b4.1-04-configuracion-auth-2026-11.md` (Corrección 2, Etapa B4.1-04); resumen vigente, reconfirmado hoy sin cambios:

### Verificado por SQL (hechos)

| Dato | Valor |
|---|---|
| Total de usuarios (`auth.users`) | 8 |
| Confirmados (`email_confirmed_at`) | 8/8 |
| Bloqueados (`banned_until`) | 0 |
| Eliminados (`deleted_at`) | 0 |
| Proveedor de identidad | únicamente `email` (sin OAuth/SSO) |
| Factores MFA | 0 |
| Protección contraseñas filtradas (HaveIBeenPwned) | Deshabilitada |

### No verificable por SQL — pendiente de obtención manual (NO "ausente")

- Plantillas de correo (confirmación, recuperación, cambio de email).
- URLs de redirección permitidas.
- Política de contraseña (longitud/complejidad más allá del check de filtradas).
- Duración/expiración de sesión y refresh token.
- Configuración SMTP.
- Si la confirmación de correo es obligatoria para registros nuevos.

Estos parámetros viven en el Management API / panel de Supabase, no en `pg_catalog` ni en tablas de `auth`, por lo que esta auditoría de solo lectura por SQL no puede obtenerlos. Deben documentarse manualmente desde el panel de producción ANTES de crear el proyecto B5.

### Dependencia estructural a preservar

`seguridad.usuario.auth_user_id` → `auth.users.id`; `privado.usuario_actual_id()` y `privado.empresa_actual_id()` dependen de `auth.uid()`. Los 8 usuarios reales NO se migran con `pg_dump --schema-only` (es solo estructura); en B5 deben crearse usuarios de prueba nuevos y enlazarlos manualmente a los registros correspondientes de `seguridad.usuario`, nunca con las contraseñas reales de producción.

---

## C.3 — Edge Functions

| slug | estado | versión | verify_jwt | creado | actualizado |
|---|---|---|---|---|---|
| `admin-usuarios` | ACTIVE | 5 | true | 2026-10 | 2026-11 |
| `tienda-imagenes` | ACTIVE | 3 | true | 2026-10 | 2026-11 |

Solo existen estas 2 funciones, ambas ACTIVE — no hay funciones obsoletas o retiradas que limpiar.

**Relación con el hallazgo crítico (corregido en Corrección 1):** `tienda-imagenes` es el destino de las llamadas de `seguridad.fn_trigger_procesar_logo_empresa()`, `seguridad.fn_trigger_procesar_portada_empresa()` e `inventario.fn_trigger_procesar_foto_producto()`. Estas 3 funciones **ya no tienen la URL ni la clave `anon` hardcoded** — ahora la obtienen de `privado.fn_config_imagenes_requerida()` (`01_privado.sql`), que bloquea la llamada con una excepción si la configuración falta o si contiene los valores del proyecto de producción original. El código y configuración de despliegue de ambas Edge Functions deben copiarse al proyecto B5, y **después** debe ejecutarse:
```sql
update privado.configuracion_entorno set valor = '<url de la Edge Function tienda-imagenes en B5>', fecha_modificacion = now() where clave = 'imagenes_webhook_url';
update privado.configuracion_entorno set valor = '<clave anon/publishable de B5>', fecha_modificacion = now() where clave = 'imagenes_anon_key';
```
Ver el detalle completo del diseño y su validación en `claude/saurix-b5-1-correccion1-validacion-linea-base-2026-11.md`, Bloque B.

El código fuente (`index.ts`) de ambas funciones no se reprodujo en este documento por brevedad; `mcp__Supabase__get_edge_function` permite obtenerlo íntegro al momento de ejecutar B5.2, bajo el mismo régimen de solo lectura.

---

## C.4 — Vault

| Nombre del secreto | Descripción | Creado |
|---|---|---|
| `webhook_tienda_imagenes` | Secreto compartido entre los triggers de producto/empresa y la Edge Function `tienda-imagenes` | 2026-10-30 |

**Solo existe 1 secreto.** Conforme al mandato, **no se extrajo ni se copió el valor real** de este secreto en ningún momento de esta auditoría.

### Procedimiento para B5 (nunca copiar el valor real)

1. En el proyecto B5, generar un valor NUEVO y aleatorio (p. ej. `openssl rand -hex 32`) para un secreto con el mismo nombre, `webhook_tienda_imagenes`.
2. Actualizar la variable de entorno/secreto correspondiente en la Edge Function `tienda-imagenes` del proyecto B5 con ese mismo valor nuevo.
3. Nunca reutilizar el valor del secreto de producción en el proyecto de prueba/reconstrucción.

---

## C.5 — Cron (pg_cron)

| jobid | nombre | horario | comando | activo |
|---|---|---|---|---|
| 9 | `expirar_ordenes_menu_qr` | `*/15 * * * *` | `select ventas.fn_expirar_ordenes_menu_qr();` | **true** |

**Confirmación explícita (Bloque B):** existe un único job activo. `pg_cron` no conserva jobs eliminados (el hueco de jobid 1–8 es evidencia de jobs antiguos ya borrados, no de jobs inactivos pendientes de limpieza) — no hay ningún job histórico/inactivo que excluir de la línea base.

---

## C.6 — Extensions

Extensiones **instaladas** (8) en los esquemas de aplicación relevantes — coincide exactamente con lo confirmado en etapas previas de Corrección 2:

| Extensión | Esquema | Versión instalada |
|---|---|---|
| `pgcrypto` | extensions | 1.3 |
| `uuid-ossp` | extensions | 1.1 |
| `pg_trgm` | extensions | 1.6 |
| `pg_stat_statements` | extensions | 1.11 |
| `pg_net` | extensions | 0.20.4 |
| `supabase_vault` | vault | 0.3.1 |
| `pg_cron` | pg_catalog | 1.6.4 |
| `plpgsql` | pg_catalog | 1.0 |

Todas las demás extensiones disponibles en el catálogo de Supabase (PostGIS, pgvector, pg_graphql, etc.) están **no instaladas** (`installed_version: null`) y no deben instalarse en B5 salvo necesidad futura explícita.

---

## C.7 — Permisos (GRANT) y privilegios por defecto — NUEVO en Corrección 1

La extracción original de B5.1 cubrió DDL de tablas/funciones/índices/triggers/políticas RLS, pero **no** incluía los `GRANT` explícitos a `anon`/`authenticated`/`service_role`, ni los privilegios por defecto (`ALTER DEFAULT PRIVILEGES`) para objetos futuros. Sin esto, las políticas RLS de los 10 archivos de DDL son insuficientes: PostgreSQL exige tanto el privilegio de tabla como el permiso de fila. Ver `11_grants.sql`, generado a partir de una verificación exacta contra producción (`information_schema.role_table_grants`, `pg_namespace.nspacl`, `pg_default_acl`):

- **`anon`**: únicamente `USAGE` sobre `comercial` y `seguridad`, y `SELECT` sobre `comercial.plan_pagina_web`. Sin ningún otro privilegio.
- **`authenticated`**: `USAGE` sobre los 9 esquemas de aplicación con objetos de usuario (no sobre `public`, que está vacío); CRUD completo (`SELECT`/`INSERT`/`UPDATE`/`DELETE`) sobre las tablas de `familia`, `inventario`, `panel_control`, `presupuesto`, `proyectos`, `seguridad`, `ventas`, `wikidocs`; solo `SELECT` sobre `comercial.plan_pagina_web`.
- **`service_role`**: privilegios completos (incluye `TRUNCATE`/`REFERENCES`/`TRIGGER`) sobre las mismas 8 tablas CRUD.
- **`privado.configuracion_entorno`** (nueva en Corrección 1) deliberadamente **sin** ningún `GRANT` a roles de aplicación — solo el rol de aprovisionamiento (`postgres`) debe leerla/escribirla directamente; el resto del sistema la usa indirectamente vía la función `SECURITY DEFINER`.
- Confirmado: **propietario uniforme** — el 100% de las tablas y funciones de los 11 esquemas de aplicación son propiedad de `postgres`, sin excepciones ni roles mixtos que compliquen el `GRANT`/`REVOKE`.
- El esquema `public`, al estar confirmado vacío, no requiere ningún `GRANT` propio de Saurix — cualquier proyecto Supabase nuevo nace ya con sus privilegios por defecto de plataforma sobre `public` (puestos por `supabase_admin`, no por la aplicación).

---

## C.8 — Datos de prueba mínimos ficticios (procedimiento, no ejecutado)

Ningún dato real de cliente fue extraído. Para poblar el proyecto B5 con datos funcionales mínimos, sin usar información real:

1. 1 empresa ficticia (`seguridad.empresa`) con un nombre claramente de prueba (p. ej. "Empresa Demo B5").
2. 1–2 usuarios de prueba (`auth.users` + `seguridad.usuario`) con correos de prueba, enlazados a la empresa ficticia, con los módulos (`seguridad.empresa_modulo`) habilitados necesarios para ejercitar la matriz de pruebas funcionales ya documentada en etapas B4.x.
3. Un puñado de registros mínimos por módulo (1–3 productos, 1 bodega, 1 cliente, 1 proveedor, etc.) — solo lo necesario para validar que las políticas RLS, triggers y funciones del Bloque A funcionan correctamente sobre la nueva línea base.
4. Ningún correo real, teléfono real, RFC real ni fotografía real de producto/cliente de producción debe copiarse jamás a este entorno.

Este procedimiento se ejecutará, si se autoriza, en una etapa posterior (B5.2 o siguiente), nunca en B5.1.

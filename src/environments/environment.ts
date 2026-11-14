/**
 * ARCHIVO BASE — NO debe usarse directamente en ningún build real.
 *
 * Cada configuración de Angular (development / staging / production, ver
 * angular.json → fileReplacements) reemplaza este archivo por su propio
 * environment.<config>.ts antes de compilar. Si esta versión termina en un
 * bundle, significa que esa configuración NO tiene fileReplacements
 * configurado — por eso `conexiones` queda vacío a propósito: la app
 * truena al iniciar (SupabaseService no puede crear el cliente) en vez de
 * conectarse silenciosamente a cualquier proyecto, bueno o malo.
 *
 * Ver Mandato 75 (B5.5 — Configuración segura de entornos).
 */
export const environment = {
  production: false,
  apiUrl: '',
  conexiones: [] as { clave: string; nombre: string; supabaseUrl: string; supabaseKey: string }[],
};

export const environment = {
  production: true,
  apiUrl: 'https://api.saurix.local',
  // Fuente de datos: 'supabase' (nube) o 'indexeddb' (solo este navegador).
  fuenteDatos: 'supabase' as 'supabase' | 'indexeddb',
  // Proyectos de Supabase disponibles (ver core/services/conexion.ts).
  // Hoy uno solo: todos los clientes ahí, separados por empresa. Para darle
  // a un cliente su propia base, agrega otra entrada con su proyecto.
  // Las llaves son las públicas ("publishable"); lo que protege los datos
  // son las reglas RLS. NUNCA pongas aquí una service_role key.
  conexiones: [
    {
      clave: 'principal',
      nombre: 'Saurix',
      supabaseUrl: 'https://fcumlscwxcmzxkknjjgo.supabase.co',
      supabaseKey: 'sb_publishable_ndUhAol8g2w4wz17GX70cQ_So2LwGag',
    },
  ],
};

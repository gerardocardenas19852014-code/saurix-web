export const environment = {
  production: false,
  apiUrl: 'http://localhost:5000',
  // Fuente de datos: 'supabase' (nube) o 'indexeddb' (solo este navegador).
  fuenteDatos: 'supabase' as 'supabase' | 'indexeddb',
  supabaseUrl: 'https://fcumlscwxcmzxkknjjgo.supabase.co',
  // Llave pública ("publishable"): puede ir en el código; lo que protege
  // los datos son las reglas RLS. NUNCA pongas aquí la service_role key.
  supabaseKey: 'sb_publishable_ndUhAol8g2w4wz17GX70cQ_So2LwGag',
};

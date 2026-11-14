export const environment = {
  production: false,
  apiUrl: 'http://localhost:5000',
  // MANDATO 75 (B5.5): esta configuración (development, usada por "ng
  // serve"/"npm start") apunta a Supabase STAGING — para pruebas con datos
  // ficticios, nunca a producción. Ver angular.json → fileReplacements.
  //
  // Proyectos de Supabase disponibles (ver core/services/conexion.ts).
  // Hoy uno solo: todos los clientes ahí, separados por empresa. Para darle
  // a un cliente su propia base, agrega otra entrada con su proyecto.
  // Las llaves son las públicas ("publishable"); lo que protege los datos
  // son las reglas RLS. NUNCA pongas aquí una service_role key.
  conexiones: [
    {
      clave: 'principal',
      nombre: 'Saurix (STAGING)',
      supabaseUrl: 'https://bidinwafzyuowfjetyvp.supabase.co',
      supabaseKey: 'sb_publishable_kT8FXPPU-0Qr-nNkxL6jxg_16uBAS1U',
    },
  ],
};

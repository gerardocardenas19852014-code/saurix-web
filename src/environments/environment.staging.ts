export const environment = {
  production: false,
  apiUrl: 'http://localhost:5000',
  // MANDATO 75 (B5.5): configuración "staging" — build más cercano a
  // producción (mismas optimizaciones) pero apuntando a Supabase STAGING.
  // Pensado para validar un build antes de promoverlo a producción, sin
  // riesgo de escribir en datos reales. Ver angular.json → fileReplacements.
  conexiones: [
    {
      clave: 'principal',
      nombre: 'Saurix (STAGING)',
      supabaseUrl: 'https://bidinwafzyuowfjetyvp.supabase.co',
      supabaseKey: 'sb_publishable_kT8FXPPU-0Qr-nNkxL6jxg_16uBAS1U',
    },
  ],
};

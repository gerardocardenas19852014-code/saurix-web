#!/usr/bin/env node
/**
 * MANDATO 75 (B5.5) — Verificación previa a cada build/serve de Angular.
 *
 * Antes de compilar, confirma que el archivo environment.<entorno>.ts que
 * Angular va a usar (vía fileReplacements, ver angular.json) apunta al
 * proyecto de Supabase correcto para ese entorno — y detiene el build
 * (código de salida distinto de 0) si no es así. Así se evita que una
 * configuración STAGING apunte a producción, o viceversa, por un error al
 * editar un archivo de entorno.
 *
 * No depende de ningún paquete externo (solo Node). No imprime llaves ni
 * credenciales — únicamente la referencia de proyecto, que es la parte
 * pública de la URL (no protege nada; lo que protege los datos son las
 * reglas RLS en la base de datos).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Referencia de proyecto esperada para cada entorno. Nunca cambiar
// 'production' aquí sin una decisión explícita y documentada — es el
// candado que evita apuntar accidentalmente a producción.
const ENTORNOS = {
  development: { archivo: 'environment.development.ts', refEsperada: 'bidinwafzyuowfjetyvp', nombre: 'STAGING (saurix-staging)' },
  staging: { archivo: 'environment.staging.ts', refEsperada: 'bidinwafzyuowfjetyvp', nombre: 'STAGING (saurix-staging)' },
  production: { archivo: 'environment.production.ts', refEsperada: 'fcumlscwxcmzxkknjjgo', nombre: 'PRODUCCIÓN (Saurix)' },
};

const entorno = process.argv[2];
const config = ENTORNOS[entorno];

if (!config) {
  console.error(
    `verificar-entorno: entorno desconocido "${entorno ?? ''}". Usar uno de: ${Object.keys(ENTORNOS).join(', ')}.`,
  );
  process.exit(1);
}

const ruta = join(__dirname, '..', 'src', 'environments', config.archivo);

let contenido;
try {
  contenido = readFileSync(ruta, 'utf8');
} catch {
  console.error(`verificar-entorno: BUILD DETENIDO -- no se pudo leer ${config.archivo}.`);
  process.exit(1);
}

const match = contenido.match(/supabaseUrl:\s*'https:\/\/([a-z0-9]+)\.supabase\.co'/);
if (!match) {
  console.error(
    `verificar-entorno: BUILD DETENIDO -- no se encontró una supabaseUrl reconocible en ${config.archivo}.`,
  );
  process.exit(1);
}

const refReal = match[1];

if (refReal !== config.refEsperada) {
  console.error(
    `verificar-entorno: BUILD DETENIDO -- la configuración "${entorno}" debe apuntar a ${config.nombre} ` +
      `(referencia de proyecto esperada "${config.refEsperada}"), pero ${config.archivo} tiene la referencia ` +
      `"${refReal}". Revisar ${config.archivo} antes de compilar. No se ejecutó ningún build.`,
  );
  process.exit(1);
}

console.log(`verificar-entorno: "${entorno}" -> ${config.nombre} (referencia ${refReal}) -- correcto.`);

/**
 * Hash de contraseñas 100% en el cliente — no hay backend real todavía, así
 * que esto es SHA-256 vía Web Crypto, codificado en hexadecimal. No sustituye
 * un hash con sal pensado para servidor (bcrypt/argon2/etc.), pero evita
 * seguir guardando la contraseña en texto plano en IndexedDB, que es lo
 * mínimo razonable mientras no exista PlataformaSaurix conectado de verdad.
 */
export async function hashPassword(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(password);
  const buffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Un hash SHA-256 en hex siempre son 64 caracteres [0-9a-f]. Sirve para
 * distinguir, en los datos ya guardados, una contraseña migrada de una que
 * todavía está en texto plano (de antes de que existiera este hashing).
 */
export function pareceHashSha256(valor: string | undefined | null): boolean {
  return !!valor && /^[0-9a-f]{64}$/i.test(valor);
}

export type NivelFortalezaPassword = 'vacia' | 'debil' | 'media' | 'fuerte';

export interface FortalezaPassword {
  nivel: NivelFortalezaPassword;
  etiqueta: string;
}

/** Evaluación simple de fortaleza, solo para dar retroalimentación visual mientras se escribe. */
export function evaluarFortaleza(password: string): FortalezaPassword {
  if (!password) return { nivel: 'vacia', etiqueta: '' };

  const tieneMinLength = password.length >= 8;
  const tieneMayuscula = /[A-Z]/.test(password);
  const tieneMinuscula = /[a-z]/.test(password);
  const tieneNumero = /[0-9]/.test(password);
  const tieneSimbolo = /[^A-Za-z0-9]/.test(password);
  const puntos = [tieneMinLength, tieneMayuscula, tieneMinuscula, tieneNumero, tieneSimbolo].filter(
    Boolean,
  ).length;

  if (!tieneMinLength || puntos <= 2) return { nivel: 'debil', etiqueta: 'Débil' };
  if (puntos <= 3) return { nivel: 'media', etiqueta: 'Media' };
  return { nivel: 'fuerte', etiqueta: 'Fuerte' };
}

/** Política mínima exigida al capturar/cambiar una contraseña desde el formulario de Usuario. */
export function passwordCumpleMinimo(password: string): boolean {
  return password.length >= 8 && /[A-Z]/.test(password) && /[0-9]/.test(password);
}

/** Sin caracteres ambiguos (0/O, 1/l/I) para que sea fácil de leer y transcribir. */
const ALFABETO_PASSWORD_TEMPORAL = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/**
 * Genera una contraseña temporal legible que ya cumple la política mínima
 * (ver passwordCumpleMinimo) — usada por el botón de "Resetear contraseña"
 * del admin: se le muestra una sola vez, y el usuario debe cambiarla en su
 * próximo inicio de sesión (ver Usuario.debeCambiarPassword).
 */
export function generarPasswordTemporal(longitud = 10): string {
  let resultado = '';
  for (let i = 0; i < longitud; i++) {
    resultado += ALFABETO_PASSWORD_TEMPORAL[Math.floor(Math.random() * ALFABETO_PASSWORD_TEMPORAL.length)];
  }
  // Por si el azar no puso alguna: garantiza que cumpla la política siempre.
  if (!/[A-Z]/.test(resultado)) resultado = 'A' + resultado.slice(1);
  if (!/[0-9]/.test(resultado)) resultado = resultado.slice(0, -1) + '7';
  return resultado;
}

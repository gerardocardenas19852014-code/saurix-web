/**
 * Avatares del tablero Kanban: mismo criterio que el prototipo de
 * referencia — un color determinístico por hash simple del nombre (no
 * aleatorio), para reconocer "de un vistazo" quién es quién, e iniciales
 * (máx. 2 letras) tomadas de las primeras dos palabras del nombre.
 */
const AVATAR_COLORS = ['#4C5FD5', '#6BA368', '#C08A2E', '#b3432f', '#7c5cbf', '#2E86AB', '#C2410C'];

export function colorAvatar(nombre: string): string {
  let hash = 0;
  for (let i = 0; i < nombre.length; i++) {
    hash = (hash * 31 + nombre.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function iniciales(nombre: string | null | undefined): string {
  if (!nombre || !nombre.trim()) return '?';
  return nombre
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((parte) => parte[0])
    .join('')
    .toUpperCase();
}

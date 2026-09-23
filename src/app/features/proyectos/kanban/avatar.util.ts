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

function hexARgb(hex: string): [number, number, number] {
  const limpio = hex.replace('#', '');
  const valor = limpio.length === 3
    ? limpio.split('').map((c) => c + c).join('')
    : limpio.padEnd(6, '0').slice(0, 6);
  return [
    parseInt(valor.slice(0, 2), 16) || 0,
    parseInt(valor.slice(2, 4), 16) || 0,
    parseInt(valor.slice(4, 6), 16) || 0,
  ];
}

function rgbAHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}

function hslARgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360 / 360;
  s /= 100;
  l /= 100;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

function rgbAHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/**
 * A partir de un color hex arbitrario (p.ej. el `codigoHex` configurable de
 * una prioridad, elegido libremente por el usuario con un selector de color),
 * genera un PAR fondo+texto siempre legible: se conserva el tono (H) elegido
 * pero se normaliza su saturación/luminosidad, así el resultado se ve bien
 * sin importar si el hex original era muy pálido (texto casi invisible sobre
 * blanco) o muy oscuro/saturado (texto oscuro sobre fondo oscuro, poco
 * contraste). Se usa para pintar prioridades como "pill" en vez de solo
 * texto de color plano.
 */
export function colorBadgeTexto(hex: string | null | undefined): string {
  if (!hex) return '#5a6268';
  const [r, g, b] = hexARgb(hex);
  const [h, s] = rgbAHsl(r, g, b);
  const [nr, ng, nb] = hslARgb(h, Math.max(s, 55), 34);
  return rgbAHex(nr, ng, nb);
}

export function colorBadgeFondo(hex: string | null | undefined): string {
  if (!hex) return '#eceff1';
  const [r, g, b] = hexARgb(hex);
  const [h] = rgbAHsl(r, g, b);
  const [nr, ng, nb] = hslARgb(h, 60, 91);
  return rgbAHex(nr, ng, nb);
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

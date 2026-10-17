/**
 * Días que faltan para que caduque un lote (ver LoteProducto.fechaCaducidad).
 * Negativo = ya vencido hace esos días. NULL = sin fecha de caducidad
 * capturada (no se puede calcular).
 */
export function diasParaCaducar(fechaCaducidad: string | null): number | null {
  if (!fechaCaducidad) return null;
  const hoy = new Date();
  const hoyUtc = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const [anio, mes, dia] = fechaCaducidad.slice(0, 10).split('-').map(Number);
  const caducaUtc = Date.UTC(anio, mes - 1, dia);
  return Math.round((caducaUtc - hoyUtc) / 86400000);
}

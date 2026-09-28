import { DocumentoFamilia, DIAS_AVISO_VENCIMIENTO, EstadoVencimientoDocumento } from './documento-familia.model';

/** Igual que fechaLocalDeTexto en presupuesto/shared/wallet.util.ts: arma la
 *  fecha en hora LOCAL a partir de "YYYY-MM-DD" (evita el corrimiento de un
 *  día que da `new Date("YYYY-MM-DD")` al interpretarlo como UTC). */
export function fechaLocalDeTexto(fecha: string): Date {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  return new Date(anio, mes - 1, dia);
}

/** Edad en años cumplidos a partir de una fecha de nacimiento "YYYY-MM-DD". */
export function calcularEdad(fechaNacimiento: string): number | null {
  if (!fechaNacimiento) return null;
  const nacimiento = fechaLocalDeTexto(fechaNacimiento);
  const hoy = new Date();
  let edad = hoy.getFullYear() - nacimiento.getFullYear();
  const aunNoCumple =
    hoy.getMonth() < nacimiento.getMonth() ||
    (hoy.getMonth() === nacimiento.getMonth() && hoy.getDate() < nacimiento.getDate());
  if (aunNoCumple) edad -= 1;
  return edad;
}

/** Estado de vencimiento de un DocumentoFamilia: 'sin-vencimiento' cuando no
 *  se capturó fecha (p.ej. un acta de nacimiento), o 'vigente'/'por-vencer'
 *  (dentro de DIAS_AVISO_VENCIMIENTO días)/'vencido' según hoy. */
export function estadoVencimiento(documento: Pick<DocumentoFamilia, 'fechaVencimiento'>): EstadoVencimientoDocumento {
  if (!documento.fechaVencimiento) return 'sin-vencimiento';
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const vencimiento = fechaLocalDeTexto(documento.fechaVencimiento);
  const diasRestantes = Math.round((vencimiento.getTime() - hoy.getTime()) / 86_400_000);
  if (diasRestantes < 0) return 'vencido';
  if (diasRestantes <= DIAS_AVISO_VENCIMIENTO) return 'por-vencer';
  return 'vigente';
}

export const ETIQUETA_ESTADO_VENCIMIENTO: Record<EstadoVencimientoDocumento, string> = {
  'sin-vencimiento': 'No vence',
  vigente: 'Vigente',
  'por-vencer': 'Por vencer',
  vencido: 'Vencido',
};

export const CLASE_ESTADO_VENCIMIENTO: Record<EstadoVencimientoDocumento, string> = {
  'sin-vencimiento': 'grid-badge-muted',
  vigente: 'grid-badge-success',
  'por-vencer': 'grid-badge-warning',
  vencido: 'grid-badge-danger',
};

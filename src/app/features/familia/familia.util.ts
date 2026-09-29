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

// ── Cumpleaños próximos ────────────────────────────────────────────────

/** Días de antelación para avisar de un cumpleaños próximo en el inicio de
 *  Familia/Miembros — más corto que DIAS_AVISO_VENCIMIENTO porque un
 *  cumpleaños es un recordatorio de "esta quincena", no de todo un mes. */
export const DIAS_AVISO_CUMPLEANOS = 14;

/** Próxima fecha en que cumple años (este año si todavía no pasó, o el que
 *  sigue si ya pasó) — null si no hay fecha de nacimiento capturada. */
export function proximoCumpleanos(fechaNacimiento: string): Date | null {
  if (!fechaNacimiento) return null;
  const nacimiento = fechaLocalDeTexto(fechaNacimiento);
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  let proximo = new Date(hoy.getFullYear(), nacimiento.getMonth(), nacimiento.getDate());
  if (proximo.getTime() < hoy.getTime()) {
    proximo = new Date(hoy.getFullYear() + 1, nacimiento.getMonth(), nacimiento.getDate());
  }
  return proximo;
}

/** Días que faltan para el próximo cumpleaños (0 = es hoy) — null si no hay
 *  fecha de nacimiento capturada. */
export function diasHastaCumpleanos(fechaNacimiento: string): number | null {
  const proximo = proximoCumpleanos(fechaNacimiento);
  if (!proximo) return null;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return Math.round((proximo.getTime() - hoy.getTime()) / 86_400_000);
}

/** Edad que va a cumplir en esa próxima fecha (no la edad actual: si su
 *  cumpleaños todavía no llega este año, es la edad actual + 1; si es
 *  justo hoy, calcularEdad() ya la refleja porque el día ya se cumplió). */
export function edadEnProximoCumpleanos(fechaNacimiento: string): number | null {
  const edadActual = calcularEdad(fechaNacimiento);
  if (edadActual === null) return null;
  const dias = diasHastaCumpleanos(fechaNacimiento);
  return dias === 0 ? edadActual : edadActual + 1;
}

/** Texto legible de la próxima fecha de cumpleaños, p.ej. "15 de septiembre"
 *  — mismo criterio que el pie de la tarjeta de emergencia (toLocaleDateString
 *  'es-MX'), sin el año porque siempre es "este año o el que sigue". */
export function proximoCumpleanosTexto(fechaNacimiento: string): string {
  const proximo = proximoCumpleanos(fechaNacimiento);
  if (!proximo) return '';
  return proximo.toLocaleDateString('es-MX', { day: 'numeric', month: 'long' });
}

// ── Semilla de catálogos ValorLista que necesitan datos de fábrica ────────
// A diferencia de Parentesco/Tipo de documento (catálogos libres que el
// usuario llena desde cero), Sexo, Entidad de nacimiento y Tipo de sangre
// necesitan traer sus valores desde el primer momento: Sexo/Entidad
// alimentan directamente a calcularRfcYCurp() (ver rfc-curp.util.ts) con
// las claves exactas que exige la librería "curp" — si el catálogo
// arrancara vacío, el usuario tendría que adivinar esas claves a mano y
// cualquier error ahí rompería el cálculo en silencio.
import { forkJoin, map, of, switchMap, type Observable } from 'rxjs';
import type { DataClientService } from '../../core/services/data-client.service';
import type { ValorLista } from '../../shared/valor-lista/valor-lista.model';

/**
 * Si el grupo ya tiene registros, los devuelve tal cual. Si está vacío (primera
 * vez que se usa en este navegador), da de alta `semilla` en orden y devuelve
 * los registros recién creados. Idempotente: una vez sembrado, las llamadas
 * siguientes solo leen.
 */
export function obtenerOSembrarValorLista(
  data: DataClientService,
  grupo: string,
  semilla: { clave: string; etiqueta: string }[],
): Observable<ValorLista[]> {
  return data.list<ValorLista>('ValorLista', { grupo }).pipe(
    switchMap((existentes) => {
      const propios = existentes.filter((r) => r.grupo === grupo);
      if (propios.length) return of(propios);
      if (!semilla.length) return of(propios);
      const altas = semilla.map((fila, i) =>
        data.alta<ValorLista>('ValorLista', { ...fila, grupo, orden: i + 1, activo: true }),
      );
      return forkJoin(altas);
    }),
  );
}

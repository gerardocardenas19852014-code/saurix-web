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

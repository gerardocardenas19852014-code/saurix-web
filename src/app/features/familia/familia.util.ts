import { DocumentoFamilia, DIAS_AVISO_VENCIMIENTO, EstadoVencimientoDocumento } from './documento-familia.model';
import { MiembroFamilia } from './miembro-familia.model';
import { PolizaSeguroMiembro } from './poliza-seguro-miembro.model';
import { CitaMedicaMiembro } from './cita-medica-miembro.model';
import { EventoFamiliar } from './evento-familiar.model';

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

/** Edad en MESES cumplidos a partir de una fecha de nacimiento "YYYY-MM-DD"
 *  — a diferencia de calcularEdad (años), esta se usa donde un año es
 *  demasiado grueso: esquema de vacunación sugerido y línea de
 *  crecimiento de bebés/niños pequeños. */
export function calcularEdadMeses(fechaNacimiento: string, fechaReferencia?: string): number | null {
  if (!fechaNacimiento) return null;
  const nacimiento = fechaLocalDeTexto(fechaNacimiento);
  const referencia = fechaReferencia ? fechaLocalDeTexto(fechaReferencia) : new Date();
  let meses = (referencia.getFullYear() - nacimiento.getFullYear()) * 12 + (referencia.getMonth() - nacimiento.getMonth());
  if (referencia.getDate() < nacimiento.getDate()) meses -= 1;
  return Math.max(0, meses);
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

// ── Gráfica de línea simple (SVG inline, sin librería nueva) ───────────
// Usada hoy solo por la línea de crecimiento (peso/estatura vs. edad) en
// la pestaña Salud de cada miembro — ver miembros.component.ts.

export interface PuntoSerie {
  x: number;
  y: number;
}

export interface SerieSvg {
  puntosPolyline: string;
  circulos: { cx: number; cy: number; x: number; y: number }[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export const DIMENSIONES_GRAFICA_SVG = { ancho: 300, alto: 100 } as const;
const PADDING_GRAFICA_SVG = 12;

/** Normaliza una serie de puntos {x,y} a coordenadas dentro del viewBox de
 *  DIMENSIONES_GRAFICA_SVG, lista para dibujar con <polyline>/<circle>. Un
 *  solo punto, o una serie plana (mismo valor repetido), no truena: el
 *  rango se protege con `|| 1` para no dividir entre cero. */
export function construirSerieSvg(puntos: PuntoSerie[]): SerieSvg | null {
  if (puntos.length === 0) return null;
  const xs = puntos.map((p) => p.x);
  const ys = puntos.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rangoX = maxX - minX || 1;
  const rangoY = maxY - minY || 1;
  const { ancho, alto } = DIMENSIONES_GRAFICA_SVG;
  const escalarX = (x: number) => PADDING_GRAFICA_SVG + ((x - minX) / rangoX) * (ancho - 2 * PADDING_GRAFICA_SVG);
  const escalarY = (y: number) => alto - PADDING_GRAFICA_SVG - ((y - minY) / rangoY) * (alto - 2 * PADDING_GRAFICA_SVG);
  const circulos = puntos.map((p) => ({ cx: escalarX(p.x), cy: escalarY(p.y), x: p.x, y: p.y }));
  const puntosPolyline = circulos.map((c) => `${c.cx},${c.cy}`).join(' ');
  return { puntosPolyline, circulos, minX, maxX, minY, maxY };
}

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


// ── Agenda unificada (Calendario familiar y Resumen) ──────────────────────

export interface EventoAgendaFamiliar {
  fecha: Date;
  icono: string;
  titulo: string;
  detalle: string;
  miembroId: number | null;
  tipo: 'cumpleanos' | 'documento' | 'poliza' | 'cita' | 'evento';
}

export interface FuentesEventosFamiliares {
  miembros: MiembroFamilia[];
  documentos: DocumentoFamilia[];
  polizas: PolizaSeguroMiembro[];
  citas: CitaMedicaMiembro[];
  eventos: EventoFamiliar[];
}

function nombreCortoMiembro(m: MiembroFamilia): string {
  return [m.nombre, m.apellidoPaterno].filter(Boolean).join(' ');
}

/**
 * Lista unificada de "eventos" de toda la familia, usada tanto por el
 * Calendario (vista de mes) como por el Resumen (próximos pendientes):
 * cumpleaños, documentos/pólizas por vencer y citas médicas pendientes de
 * miembros ACTIVOS, más los eventos manuales capturados (EventoFamiliar).
 * Un miembro inactivo (dado de baja) no genera ningún evento, igual que ya
 * hacían documentosPorVencer/cumpleanosProximos en miembros.component.ts.
 *
 * `anioCumpleanos`: si se da, fija el año en que se calcula la fecha de
 * cumpleaños de cada quien — necesario para poder mostrarlos en CUALQUIER
 * mes que el Calendario esté mostrando, no solo el próximo. Si se omite
 * (caso del Resumen, que solo lista lo próximo), usa proximoCumpleanos().
 */
export function eventosFamiliares(fuentes: FuentesEventosFamiliares, anioCumpleanos?: number): EventoAgendaFamiliar[] {
  const miembrosActivosPorId = new Map(
    fuentes.miembros.filter((m) => m.activo !== false).map((m) => [Number(m.id), m]),
  );
  const eventos: EventoAgendaFamiliar[] = [];

  for (const m of miembrosActivosPorId.values()) {
    if (!m.fechaNacimiento) continue;
    let fecha: Date | null;
    let edad: number | null;
    if (anioCumpleanos !== undefined) {
      const nacimiento = fechaLocalDeTexto(m.fechaNacimiento);
      fecha = new Date(anioCumpleanos, nacimiento.getMonth(), nacimiento.getDate());
      edad = anioCumpleanos - nacimiento.getFullYear();
    } else {
      fecha = proximoCumpleanos(m.fechaNacimiento);
      edad = edadEnProximoCumpleanos(m.fechaNacimiento);
    }
    if (!fecha) continue;
    eventos.push({
      fecha,
      icono: '🎂',
      titulo: `Cumpleaños de ${nombreCortoMiembro(m)}`,
      detalle: edad !== null ? `Cumple ${edad} años` : 'Cumpleaños',
      miembroId: m.id,
      tipo: 'cumpleanos',
    });
  }

  for (const d of fuentes.documentos) {
    if (!d.fechaVencimiento) continue;
    const m = miembrosActivosPorId.get(Number(d.miembroFamiliaId));
    if (!m) continue;
    eventos.push({
      fecha: fechaLocalDeTexto(d.fechaVencimiento),
      icono: '📄',
      titulo: `Vence documento de ${nombreCortoMiembro(m)}`,
      detalle: d.notas || 'Documento',
      miembroId: m.id,
      tipo: 'documento',
    });
  }

  for (const p of fuentes.polizas) {
    if (!p.fechaVigenciaFin || p.activo === false) continue;
    const m = miembrosActivosPorId.get(Number(p.miembroFamiliaId));
    if (!m) continue;
    eventos.push({
      fecha: fechaLocalDeTexto(p.fechaVigenciaFin),
      icono: '🛡️',
      titulo: `Vence póliza de ${nombreCortoMiembro(m)}`,
      detalle: p.aseguradora || 'Póliza de seguro',
      miembroId: m.id,
      tipo: 'poliza',
    });
  }

  for (const c of fuentes.citas) {
    if (!c.fecha || c.completada) continue;
    const m = miembrosActivosPorId.get(Number(c.miembroFamiliaId));
    if (!m) continue;
    eventos.push({
      fecha: fechaLocalDeTexto(c.fecha),
      icono: '⚕️',
      titulo: `Cita médica de ${nombreCortoMiembro(m)}`,
      detalle: c.motivo || c.especialidad || 'Cita médica',
      miembroId: m.id,
      tipo: 'cita',
    });
  }

  for (const e of fuentes.eventos) {
    if (!e.fecha || e.activo === false) continue;
    const m = e.miembroFamiliaId ? miembrosActivosPorId.get(Number(e.miembroFamiliaId)) : null;
    eventos.push({
      fecha: fechaLocalDeTexto(e.fecha),
      icono: '📌',
      titulo: e.titulo,
      detalle: m ? nombreCortoMiembro(m) : e.notas || 'Evento familiar',
      miembroId: m ? m.id : null,
      tipo: 'evento',
    });
  }

  return eventos.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
}

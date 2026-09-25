/**
 * Utilidades compartidas por las pantallas de Presupuesto (estilo wallet
 * app del prototipo). Los catálogos CategoriaPresupuesto/CuentaPresupuesto
 * (módulo Catálogos) no tienen campo `color`, así que el color del punto
 * de categoría se deriva de forma determinista de su id, ciclando sobre
 * la paleta de acento ya definida en styles.scss.
 */
import type { CuentaPresupuesto } from '../cuenta-presupuesto/cuenta-presupuesto.model';
import type { CategoriaPresupuesto } from '../categoria-presupuesto/categoria-presupuesto.model';
import type { MovimientoPresupuesto } from '../movimientos/movimiento.model';

const PALETA_CATEGORIAS = [
  'var(--client)',
  'var(--danger)',
  'var(--amber)',
  'var(--indigo)',
  'var(--teal)',
  'var(--technical)',
];

/** Parsea un texto "YYYY-MM-DD" (el formato que guardan los <input type="date">)
 *  como fecha LOCAL a medianoche, en vez de `new Date(texto)` — que lo
 *  interpreta como UTC: en una zona horaria detrás de UTC (México) eso puede
 *  recorrer la fecha un día para atrás y cruzarla a un mes o año distinto
 *  (p. ej. "2026-10-01" termina cayendo en septiembre). Úsese en cualquier
 *  comparación por año/mes/rango sobre el campo `fecha` de un movimiento. */
export function fechaLocalDeTexto(fecha: string): Date {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  return new Date(anio, mes - 1, dia);
}

/** Arma un texto "YYYY-MM-DD" a partir de año/mes(0-indexado)/día LOCALES,
 *  sin pasar por `Date.toISOString()` — que convierte a UTC y, según la
 *  zona horaria, puede recorrer la fecha a un día (y por tanto mes) distinto. */
export function textoFechaDeLocal(anio: number, mes0: number, dia: number): string {
  return `${anio}-${String(mes0 + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** "Septiembre 2026" a partir de año/mes (0-indexado) — mismo formato para
 *  el combo "Mes" y los encabezados de grupo en Movimientos y el Dashboard. */
export function etiquetaMes(anio: number, mes: number): string {
  const texto = new Date(anio, mes, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Solo el nombre del mes (0-indexado), sin año — p.ej. "Septiembre" — para
 *  las opciones de un selector de Mes independiente de Año. */
export function nombreMes(mes: number): string {
  const texto = new Date(2000, mes, 1).toLocaleDateString('es-MX', { month: 'long' });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// ── Jerarquía de categorías (raíz + hijas directas, para <optgroup>) ──

export interface GrupoCategoriaJerarquia {
  raiz: CategoriaPresupuesto;
  hijos: CategoriaPresupuesto[];
}

/** Agrupa una lista de categorías (ya filtrada por Tipo si aplica) en
 *  raíz + hijas directas, para pintarlas con <optgroup> en un <select>: la
 *  raíz es el label en negritas y sus hijas van adentro como <option>s. Si
 *  una raíz no tiene hijas EN LA LISTA RECIBIDA, la plantilla debe mostrarla
 *  como <option> plana en vez de <optgroup> — así nunca se repite su nombre
 *  como opción dentro de su propio grupo (bug reportado: "SALARIO" aparecía
 *  como label Y como primera opción bajo su propio optgroup).
 *  Si una hija quedara sin su padre en la lista (p. ej. un filtro por Tipo
 *  raro dejara fuera al padre), se conserva como raíz suelta para no
 *  perderla en silencio del combo — aunque en la práctica no pasa, porque
 *  una subcategoría siempre hereda el Tipo de su padre. */
export function agruparCategoriasJerarquia(categorias: CategoriaPresupuesto[]): GrupoCategoriaJerarquia[] {
  const idsPresentes = new Set(categorias.map((c) => Number(c.id)));
  const esRaiz = (c: CategoriaPresupuesto) =>
    c.categoriaPresupuestoPadreId === null || !idsPresentes.has(Number(c.categoriaPresupuestoPadreId));
  return categorias
    .filter(esRaiz)
    .map((raiz) => ({
      raiz,
      hijos: categorias.filter((c) => c.id !== raiz.id && Number(c.categoriaPresupuestoPadreId) === Number(raiz.id)),
    }));
}

export function colorCategoria(id: number | null | undefined): string {
  if (!id) return 'var(--technical)';
  return PALETA_CATEGORIAS[id % PALETA_CATEGORIAS.length];
}

const ICONOS_TIPO_CUENTA: Record<string, string> = {
  Efectivo: '💵',
  Banco: '🏦',
  Tarjeta: '💳',
  Ahorro: '🐷',
};

export function iconoTipoCuenta(tipo: string): string {
  return ICONOS_TIPO_CUENTA[tipo] ?? '💰';
}

export function formatMoneda(valor: number): string {
  const signo = valor < 0 ? '-$' : '$';
  return signo + Math.abs(valor).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Nivel de uso (ok/warn/over) para pintar una barra de límite/progreso. */
export function nivelUso(pctReal: number): 'ok' | 'warn' | 'over' {
  if (pctReal >= 100) return 'over';
  if (pctReal >= 70) return 'warn';
  return 'ok';
}

// ── Tarjetas de crédito: deuda/disponible/% de uso/próxima fecha de pago ──

export interface InfoTarjeta {
  deuda: number;
  /** null si la cuenta no tiene límite de crédito capturado. */
  disponible: number | null;
  /** 0-100, topado en 100 aunque la deuda supere el límite. */
  pctUso: number;
  proximaFechaPago: Date | null;
}

/** Próxima fecha (hoy o después) en que cae un "día del mes" dado, clampado al
 *  último día de cada mes — mismo cálculo que usa Calendario para fijos/tarjetas. */
export function proximaFechaMensual(diaDelMes: number, hoy: Date = new Date()): Date {
  const ultimoDiaEsteMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
  let candidata = new Date(hoy.getFullYear(), hoy.getMonth(), Math.min(diaDelMes, ultimoDiaEsteMes));
  candidata.setHours(0, 0, 0, 0);
  const hoySinHora = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  if (candidata < hoySinHora) {
    const ultimoDiaSiguiente = new Date(hoy.getFullYear(), hoy.getMonth() + 2, 0).getDate();
    candidata = new Date(hoy.getFullYear(), hoy.getMonth() + 1, Math.min(diaDelMes, ultimoDiaSiguiente));
  }
  return candidata;
}

/** Info de una cuenta tipo Tarjeta a partir de su saldo ya calculado (ingresos -
 *  gastos de MIS movimientos sobre esa cuenta compartida — el mismo criterio que
 *  usan Movimientos/Calendario/Dashboard). Un saldo negativo es deuda. */
export function infoTarjeta(cuenta: CuentaPresupuesto, saldo: number, hoy: Date = new Date()): InfoTarjeta {
  const deuda = Math.max(-saldo, 0);
  const disponible = cuenta.limiteCredito != null ? Math.max(cuenta.limiteCredito - deuda, 0) : null;
  const pctUso = cuenta.limiteCredito ? Math.min((deuda / cuenta.limiteCredito) * 100, 100) : 0;
  const proximaFechaPago = cuenta.diaPago ? proximaFechaMensual(cuenta.diaPago, hoy) : null;
  return { deuda, disponible, pctUso, proximaFechaPago };
}

// ── Gastos inusuales: mes actual vs. promedio de los 3 meses anteriores ──

export interface GastoInusual {
  categoriaId: number | null;
  nombreCategoria: string;
  montoMes: number;
  promedio: number;
  /** montoMes / promedio, p.ej. 1.8 = 80% arriba del promedio. */
  veces: number;
}

/** Categorías cuyo gasto del mes en curso es ≥1.5x el promedio de gasto de esa
 *  misma categoría en los 3 meses completos anteriores (mismo umbral del prototipo). */
export function gastosInusuales(
  movimientos: MovimientoPresupuesto[],
  categorias: CategoriaPresupuesto[],
  hoy: Date = new Date(),
): GastoInusual[] {
  const esGasto = (m: MovimientoPresupuesto) => m.tipo === 'Gasto' && !m.transferenciaId;
  const totalPorCategoriaEnRango = (inicio: Date, fin: Date): Map<number | null, number> => {
    const mapa = new Map<number | null, number>();
    for (const m of movimientos.filter(esGasto)) {
      const f = fechaLocalDeTexto(m.fecha);
      if (f < inicio || f > fin) continue;
      const id = m.categoriaPresupuestoId ? Number(m.categoriaPresupuestoId) : null;
      mapa.set(id, (mapa.get(id) ?? 0) + m.monto);
    }
    return mapa;
  };

  const inicioMesActual = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const finMesActual = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0, 23, 59, 59);
  const porCategoriaMes = totalPorCategoriaEnRango(inicioMesActual, finMesActual);

  const promedios = new Map<number | null, number>();
  for (let i = 1; i <= 3; i++) {
    const base = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const inicio = new Date(base.getFullYear(), base.getMonth(), 1);
    const fin = new Date(base.getFullYear(), base.getMonth() + 1, 0, 23, 59, 59);
    for (const [id, monto] of totalPorCategoriaEnRango(inicio, fin)) {
      promedios.set(id, (promedios.get(id) ?? 0) + monto / 3);
    }
  }

  const resultado: GastoInusual[] = [];
  for (const [id, montoMes] of porCategoriaMes) {
    const promedio = promedios.get(id) ?? 0;
    if (promedio > 0 && montoMes >= promedio * 1.5) {
      resultado.push({
        categoriaId: id,
        nombreCategoria: id ? (categorias.find((c) => Number(c.id) === id)?.nombre ?? '—') : 'Sin categoría',
        montoMes,
        promedio,
        veces: montoMes / promedio,
      });
    }
  }
  return resultado.sort((a, b) => b.veces - a.veces);
}

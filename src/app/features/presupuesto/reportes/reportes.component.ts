import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { AuthService } from '../../../core/services/auth.service';
import { DataClientService } from '../../../core/services/data-client.service';
import { CategoriaPresupuesto } from '../../catalogos/categoria-presupuesto/categoria-presupuesto.model';
import { MovimientoPresupuesto } from '../movimientos/movimiento.model';
import { MovimientoRecurrentePresupuesto } from '../recurrentes/recurrente.model';
import { colorCategoria, formatMoneda } from '../shared/wallet.util';

type PeriodoId = 'mes-actual' | 'mes-anterior' | 'anio-actual' | 'anio-anterior';

interface RangoFecha {
  inicio: Date;
  fin: Date;
}

interface GastoCategoria {
  id: number | null;
  nombre: string;
  monto: number;
  pct: number;
  color: string;
}

interface PuntoPatrimonio {
  etiqueta: string;
  valor: number;
  x: number;
  y: number;
}

interface PlaneadoReal {
  clave: string;
  nombre: string;
  tipo: 'Ingreso' | 'Gasto';
  planeado: number;
  real: number;
}

/**
 * Reportes: ingresos vs. gastos con comparación de periodo, gasto por
 * categoría (dona/barra) y patrimonio neto histórico. Todo se calcula en
 * cliente a partir de los movimientos ya cargados (GetList) — sin
 * agregaciones del lado del servidor, tal como lo documenta el prototipo.
 */
@Component({
  selector: 'app-reportes',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './reportes.component.html',
  styleUrl: './reportes.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportesComponent implements OnInit {
  private readonly data = inject(DataClientService);
  private readonly auth = inject(AuthService);

  protected readonly formatMoneda = formatMoneda;

  protected readonly movimientos = signal<MovimientoPresupuesto[]>([]);

  /** Excluye los proyectados a futuro (generados por adelantado con "Generar
   *  futuros" en Fijos y Proyección, aún sin confirmar): estos reportes deben
   *  reflejar solo lo que ya ocurrió de verdad. */
  protected readonly movimientosReales = computed(() => this.movimientos().filter((m) => !m.proyectado));
  protected readonly categorias = signal<CategoriaPresupuesto[]>([]);
  protected readonly recurrentes = signal<MovimientoRecurrentePresupuesto[]>([]);
  protected readonly cargando = signal(false);

  protected readonly periodo = signal<PeriodoId>('mes-actual');
  protected readonly vistaCategoria = signal<'dona' | 'barra'>('dona');

  private get usuarioActualId(): number {
    return this.auth.usuarioActual()?.id ?? 0;
  }

  ngOnInit(): void {
    this.cargando.set(true);
    this.data.list<CategoriaPresupuesto>('CategoriaPresupuesto').subscribe((c) => this.categorias.set(c));
    this.data
      .list<MovimientoRecurrentePresupuesto>('MovimientoRecurrentePresupuesto', { creadoPorUsuarioId: this.usuarioActualId })
      .subscribe((r) => this.recurrentes.set(r));
    this.data.list<MovimientoPresupuesto>('MovimientoPresupuesto', { creadoPorUsuarioId: this.usuarioActualId }).subscribe({
      next: (m) => {
        this.movimientos.set(m);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  private rangosDe(id: PeriodoId): { actual: RangoFecha; anterior: RangoFecha; etiqueta: string } {
    const hoy = new Date();
    if (id === 'mes-actual' || id === 'mes-anterior') {
      const offset = id === 'mes-actual' ? 0 : -1;
      const base = new Date(hoy.getFullYear(), hoy.getMonth() + offset, 1);
      return {
        actual: { inicio: new Date(base.getFullYear(), base.getMonth(), 1), fin: new Date(base.getFullYear(), base.getMonth() + 1, 0, 23, 59, 59) },
        anterior: { inicio: new Date(base.getFullYear(), base.getMonth() - 1, 1), fin: new Date(base.getFullYear(), base.getMonth(), 0, 23, 59, 59) },
        etiqueta: base.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }),
      };
    }
    const offsetAnio = id === 'anio-actual' ? 0 : -1;
    const anio = hoy.getFullYear() + offsetAnio;
    return {
      actual: { inicio: new Date(anio, 0, 1), fin: new Date(anio, 11, 31, 23, 59, 59) },
      anterior: { inicio: new Date(anio - 1, 0, 1), fin: new Date(anio - 1, 11, 31, 23, 59, 59) },
      etiqueta: String(anio),
    };
  }

  protected readonly etiquetaPeriodo = computed(() => this.rangosDe(this.periodo()).etiqueta);

  private enRango(fecha: string, rango: RangoFecha): boolean {
    const f = new Date(fecha);
    return f >= rango.inicio && f <= rango.fin;
  }

  private totales(rango: RangoFecha): { ingreso: number; gasto: number } {
    const reales = this.movimientosReales().filter((m) => !m.transferenciaId && this.enRango(m.fecha, rango));
    return {
      ingreso: reales.filter((m) => m.tipo === 'Ingreso').reduce((s, m) => s + m.monto, 0),
      gasto: reales.filter((m) => m.tipo === 'Gasto').reduce((s, m) => s + m.monto, 0),
    };
  }

  protected readonly totalesActual = computed(() => this.totales(this.rangosDe(this.periodo()).actual));
  protected readonly totalesAnterior = computed(() => this.totales(this.rangosDe(this.periodo()).anterior));

  protected readonly netoActual = computed(() => this.totalesActual().ingreso - this.totalesActual().gasto);

  private variacionPct(actual: number, anterior: number): number | null {
    if (anterior === 0) return null;
    return ((actual - anterior) / anterior) * 100;
  }

  protected readonly variacionIngreso = computed(() => this.variacionPct(this.totalesActual().ingreso, this.totalesAnterior().ingreso));
  protected readonly variacionGasto = computed(() => this.variacionPct(this.totalesActual().gasto, this.totalesAnterior().gasto));

  protected claseComparacion(tipo: 'ingreso' | 'gasto', variacion: number | null): string {
    if (variacion === null) return 'wallet-compare-neutral';
    const mejora = tipo === 'ingreso' ? variacion > 0 : variacion < 0;
    if (variacion === 0) return 'wallet-compare-neutral';
    return mejora ? 'wallet-compare-good' : 'wallet-compare-bad';
  }

  protected textoComparacion(variacion: number | null): string {
    if (variacion === null) return 'sin datos del periodo anterior';
    const signo = variacion > 0 ? '▲' : variacion < 0 ? '▼' : '·';
    return `${signo} ${Math.abs(variacion).toFixed(0)}% vs. periodo anterior`;
  }

  /** Gasto por categoría del periodo seleccionado, de mayor a menor. */
  protected readonly gastoPorCategoria = computed<GastoCategoria[]>(() => {
    const rango = this.rangosDe(this.periodo()).actual;
    const gastos = this.movimientosReales().filter((m) => m.tipo === 'Gasto' && !m.transferenciaId && this.enRango(m.fecha, rango));
    const total = gastos.reduce((s, m) => s + m.monto, 0);
    const porCategoria = new Map<number | null, number>();
    for (const m of gastos) {
      const id = m.categoriaPresupuestoId ? Number(m.categoriaPresupuestoId) : null;
      porCategoria.set(id, (porCategoria.get(id) ?? 0) + m.monto);
    }
    return [...porCategoria.entries()]
      .map(([id, monto]) => ({
        id,
        nombre: id ? (this.categorias().find((c) => Number(c.id) === id)?.nombre ?? '—') : 'Sin categoría',
        monto,
        pct: total > 0 ? (monto / total) * 100 : 0,
        color: colorCategoria(id),
      }))
      .sort((a, b) => b.monto - a.monto);
  });

  protected readonly totalGastoCategorias = computed(() => this.gastoPorCategoria().reduce((s, c) => s + c.monto, 0));

  protected readonly maxCategoria = computed(() => Math.max(1, ...this.gastoPorCategoria().map((c) => c.monto)));

  /** Ingresos por categoría del periodo seleccionado, de mayor a menor (misma lógica que gasto por categoría). */
  protected readonly ingresoPorCategoria = computed<GastoCategoria[]>(() => {
    const rango = this.rangosDe(this.periodo()).actual;
    const ingresos = this.movimientosReales().filter((m) => m.tipo === 'Ingreso' && !m.transferenciaId && this.enRango(m.fecha, rango));
    const total = ingresos.reduce((s, m) => s + m.monto, 0);
    const porCategoria = new Map<number | null, number>();
    for (const m of ingresos) {
      const id = m.categoriaPresupuestoId ? Number(m.categoriaPresupuestoId) : null;
      porCategoria.set(id, (porCategoria.get(id) ?? 0) + m.monto);
    }
    return [...porCategoria.entries()]
      .map(([id, monto]) => ({
        id,
        nombre: id ? (this.categorias().find((c) => Number(c.id) === id)?.nombre ?? '—') : 'Sin categoría',
        monto,
        pct: total > 0 ? (monto / total) * 100 : 0,
        color: colorCategoria(id),
      }))
      .sort((a, b) => b.monto - a.monto);
  });

  protected readonly maxIngresoCategoria = computed(() => Math.max(1, ...this.ingresoPorCategoria().map((c) => c.monto)));

  /** Gradiente cónico para la dona, construido a partir de los porcentajes acumulados. */
  protected readonly gradienteDona = computed(() => {
    const categorias = this.gastoPorCategoria();
    if (categorias.length === 0) return 'conic-gradient(var(--line) 0 100%)';
    let acumulado = 0;
    const segmentos: string[] = [];
    for (const c of categorias) {
      const inicio = acumulado;
      acumulado += c.pct;
      segmentos.push(`${c.color} ${inicio}% ${acumulado}%`);
    }
    return `conic-gradient(${segmentos.join(', ')})`;
  });

  /** Patrimonio neto histórico: saldo acumulado de todos los movimientos hasta el fin de cada uno de los últimos 12 meses. */
  protected readonly patrimonioHistorico = computed<PuntoPatrimonio[]>(() => {
    const hoy = new Date();
    const movimientos = this.movimientosReales();
    const puntos: { etiqueta: string; valor: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const finMes = new Date(hoy.getFullYear(), hoy.getMonth() - i + 1, 0, 23, 59, 59);
      const valor = movimientos
        .filter((m) => new Date(m.fecha) <= finMes)
        .reduce((s, m) => s + (m.tipo === 'Ingreso' ? m.monto : -m.monto), 0);
      puntos.push({ etiqueta: finMes.toLocaleDateString('es-MX', { month: 'short' }), valor });
    }

    const valores = puntos.map((p) => p.valor);
    const minValor = Math.min(0, ...valores);
    const maxValor = Math.max(1, ...valores);
    const rango = maxValor - minValor || 1;
    const ancho = 640;
    const alto = 200;
    const paso = puntos.length > 1 ? ancho / (puntos.length - 1) : 0;

    return puntos.map((p, i) => ({
      etiqueta: p.etiqueta,
      valor: p.valor,
      x: Math.round(i * paso),
      y: Math.round(alto - ((p.valor - minValor) / rango) * alto),
    }));
  });

  protected readonly puntosPatrimonioSvg = computed(() => this.patrimonioHistorico().map((p) => `${p.x},${p.y}`).join(' '));

  /** Mismos puntos que la línea, más dos vértices en la base para cerrar el área rellena. */
  protected readonly areaPatrimonioSvg = computed(() => {
    const puntos = this.patrimonioHistorico();
    if (puntos.length === 0) return '';
    return `${puntos[0].x},200 ${this.puntosPatrimonioSvg()} ${puntos[puntos.length - 1].x},200`;
  });

  protected readonly patrimonioActual = computed(() => {
    const puntos = this.patrimonioHistorico();
    return puntos.length > 0 ? puntos[puntos.length - 1].valor : 0;
  });

  /** Cuántos meses caben, completos, dentro de un rango (1 para mes-actual/anterior, 12 para año-actual/anterior). */
  private mesesEnRango(rango: RangoFecha): number {
    return (
      (rango.fin.getFullYear() - rango.inicio.getFullYear()) * 12 + (rango.fin.getMonth() - rango.inicio.getMonth()) + 1
    );
  }

  /**
   * "Planeado vs. real": lo que los fijos (Fijos y Proyección) configurados hoy
   * DEBERÍAN haber producido durante el periodo seleccionado (planeado) contra lo
   * que realmente se registró en Movimientos en ese mismo periodo (real),
   * agrupado por categoría + tipo. Un fijo Mensual cuenta una vez por cada mes
   * del rango; uno Anual cuenta solo si el mes de su fechaCreacion cae dentro
   * del rango (siempre una vez cuando el rango es un año completo).
   */
  protected readonly planeadoVsReal = computed<PlaneadoReal[]>(() => {
    const rango = this.rangosDe(this.periodo()).actual;
    const mesesEnRango = this.mesesEnRango(rango);
    const nombreCategoria = (id: number | null) =>
      id ? (this.categorias().find((c) => Number(c.id) === id)?.nombre ?? '—') : 'Sin categoría';
    const clave = (id: number | null, tipo: string) => `${id ?? 'null'}|${tipo}`;

    const planeado = new Map<string, number>();
    for (const fijo of this.recurrentes()) {
      const id = fijo.categoriaPresupuestoId ? Number(fijo.categoriaPresupuestoId) : null;
      // 'Anual' es la única frecuencia con su propio conteo; cualquier otra
      // (Mensual, Quincenal, o una clave nueva del catálogo) cuenta una vez
      // por cada mes del rango, igual que Fijos y Proyección/Calendario.
      let veces = 0;
      if (fijo.frecuencia === 'Anual') {
        const mesAncla = fijo.fechaCreacion ? new Date(fijo.fechaCreacion).getMonth() : 0;
        veces = mesesEnRango >= 12 || rango.inicio.getMonth() === mesAncla ? 1 : 0;
      } else {
        veces = mesesEnRango;
      }
      if (veces > 0) {
        const k = clave(id, fijo.tipo);
        planeado.set(k, (planeado.get(k) ?? 0) + fijo.monto * veces);
      }
    }

    const real = new Map<string, number>();
    for (const m of this.movimientosReales().filter((m) => !m.transferenciaId && this.enRango(m.fecha, rango))) {
      const id = m.categoriaPresupuestoId ? Number(m.categoriaPresupuestoId) : null;
      const k = clave(id, m.tipo);
      real.set(k, (real.get(k) ?? 0) + m.monto);
    }

    const claves = new Set([...planeado.keys(), ...real.keys()]);
    const filas: PlaneadoReal[] = [];
    for (const k of claves) {
      const [idTexto, tipo] = k.split('|');
      const id = idTexto === 'null' ? null : Number(idTexto);
      filas.push({
        clave: k,
        nombre: nombreCategoria(id),
        tipo: tipo as 'Ingreso' | 'Gasto',
        planeado: planeado.get(k) ?? 0,
        real: real.get(k) ?? 0,
      });
    }
    return filas.sort((a, b) => a.tipo.localeCompare(b.tipo) || b.planeado - a.planeado);
  });

  /** 'over' cuando lo real perjudica (gastaste más de lo planeado, o ingresaste menos), 'ok' en caso contrario. */
  protected estadoPlaneado(fila: PlaneadoReal): 'ok' | 'over' {
    if (fila.tipo === 'Gasto') return fila.real > fila.planeado ? 'over' : 'ok';
    return fila.real < fila.planeado ? 'over' : 'ok';
  }

  protected etiquetaPlaneado(fila: PlaneadoReal): string {
    const diferencia = fila.real - fila.planeado;
    if (diferencia === 0) return 'exacto';
    const signo = diferencia > 0 ? '+' : '−';
    return `${signo}${this.formatMoneda(Math.abs(diferencia))}`;
  }
}

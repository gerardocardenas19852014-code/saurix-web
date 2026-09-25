import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { DataClientService } from '../../../core/services/data-client.service';
import { CategoriaPresupuesto } from '../categoria-presupuesto/categoria-presupuesto.model';
import { CuentaPresupuesto } from '../cuenta-presupuesto/cuenta-presupuesto.model';
import { PresupuestoAnual } from '../presupuesto-anual/presupuesto-anual.model';
import { MovimientoPresupuesto } from '../movimientos/movimiento.model';
import { PagoTarjetaService } from '../shared/pago-tarjeta.service';
import { AnioTrabajoService } from '../shared/anio-trabajo.service';
import {
  GastoInusual,
  InfoTarjeta,
  colorCategoria,
  etiquetaMes,
  fechaLocalDeTexto,
  formatMoneda,
  gastosInusuales,
  iconoTipoCuenta,
  infoTarjeta,
  nivelUso,
  nombreMes,
} from '../shared/wallet.util';

interface CuentaConInfo {
  cuenta: CuentaPresupuesto;
  saldo: number;
  esTarjeta: boolean;
  info: InfoTarjeta | null;
}

/** Orden preferido de las pestañas de Cuentas — coincide con los tipos
 * protegidos del catálogo "Tipo de cuenta" (Efectivo/Banco/Tarjeta/Ahorro);
 * cualquier tipo adicional que el usuario dé de alta ahí se agrega al final,
 * alfabéticamente, sin tener que tocar este componente. */
const ORDEN_TIPOS_CUENTA = ['Efectivo', 'Banco', 'Tarjeta', 'Ahorro'];
const TAB_TODAS = 'Todas';

interface CategoriaMonto {
  id: number | null;
  nombre: string;
  monto: number;
  color: string;
}

interface MovimientoReciente {
  movimiento: MovimientoPresupuesto;
  nombreCuenta: string;
  nombreCategoria: string;
}

/** 0-11, para el selector "Mes" (independiente del selector "Año"). */
const MESES_OPCIONES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/**
 * Resumen (dashboard financiero real, no solo un menú de accesos) — igual que
 * viewWalletDashboard() del prototipo: saldo/ingresos/gastos del mes, deuda
 * total en tarjetas, aviso de gasto inusual, cuentas (con barra de uso +
 * atajo "Pagar tarjeta" en las de tipo Tarjeta), top categorías del mes y
 * movimientos recientes.
 */
@Component({
  selector: 'app-presupuesto-landing',
  standalone: true,
  imports: [RouterLink, DatePipe, DecimalPipe],
  templateUrl: './presupuesto-landing.component.html',
  styleUrl: './presupuesto-landing.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PresupuestoLandingComponent implements OnInit, OnDestroy {
  private readonly data = inject(DataClientService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly pagoTarjeta = inject(PagoTarjetaService);

  protected readonly formatMoneda = formatMoneda;
  protected readonly colorCategoria = colorCategoria;
  protected readonly iconoTipoCuenta = iconoTipoCuenta;
  protected readonly nivelUso = nivelUso;

  protected readonly cuentas = signal<CuentaPresupuesto[]>([]);
  protected readonly movimientos = signal<MovimientoPresupuesto[]>([]);
  protected readonly categorias = signal<CategoriaPresupuesto[]>([]);
  protected readonly presupuestosAnuales = signal<PresupuestoAnual[]>([]);

  protected readonly anioTrabajo = inject(AnioTrabajoService);
  protected readonly mesesOpciones = MESES_OPCIONES;
  protected readonly nombreMes = nombreMes;

  /** Años dados de alta en Catálogos → "Presupuesto por año" — mismo origen
   *  que en Movimientos/Proyección/Fijos, para que el selector "Año" del
   *  Dashboard solo ofrezca años ya registrados. */
  protected readonly aniosDisponibles = computed<number[]>(() => {
    const anios = new Set(this.presupuestosAnuales().map((p) => Number(p.anio)));
    return [...anios].sort((a, b) => a - b);
  });

  /** Año de trabajo COMPARTIDO con Movimientos, Fijos y Proyección y
   *  Proyección — elegir un año aquí (o en cualquiera de esas 3) se refleja
   *  en las demás. Si aún no hay ninguno elegido, se propone uno apenas se
   *  conocen los años registrados (ver AnioTrabajoService.asegurarSeleccion). */
  protected readonly filtroAnio = this.anioTrabajo.seleccionado;
  private readonly _asegurarAnioTrabajo = effect(() => this.anioTrabajo.asegurarSeleccion(this.aniosDisponibles()));

  /** Número real para los cálculos de fecha — filtroAnio puede estar
   *  transitoriamente en 'todos' (antes de que cargue el catálogo o si
   *  todavía no hay ningún año registrado); en ese caso se usa el año
   *  calendario actual mientras tanto. */
  protected readonly anioSeleccionadoNumero = computed(() => {
    const v = this.filtroAnio();
    return v === 'todos' ? new Date().getFullYear() : v;
  });

  /** Mes del Dashboard (0-indexado) — independiente del Año, con su propio
   *  selector; arranca en el mes calendario actual. */
  protected readonly filtroMes = signal<number>(new Date().getMonth());

  /** "Septiembre 2026" — para los encabezados que dependen del período
   *  elegido en vez de "del mes" a secas. */
  protected readonly etiquetaPeriodo = computed(() => etiquetaMes(this.anioSeleccionadoNumero(), this.filtroMes()));

  /** Excluye los proyectados (generados por adelantado con "Generar futuros"
   *  en Fijos y Proyección, aún sin confirmar) — el saldo total (a la fecha
   *  de hoy) solo debe reflejar dinero que ya entró o salió de verdad. */
  protected readonly movimientosReales = computed(() => this.movimientos().filter((m) => !m.proyectado));

  private enElPeriodoSeleccionado(fecha: string): boolean {
    const f = fechaLocalDeTexto(fecha);
    return f.getFullYear() === this.anioSeleccionadoNumero() && f.getMonth() === this.filtroMes();
  }

  protected readonly saldoTotal = computed(() =>
    this.movimientosReales().reduce((s, m) => s + (m.tipo === 'Ingreso' ? m.monto : -m.monto), 0),
  );

  protected readonly ingresosRealesDelMes = computed(() =>
    this.movimientosReales()
      .filter((m) => m.tipo === 'Ingreso' && !m.transferenciaId && this.enElPeriodoSeleccionado(m.fecha))
      .reduce((s, m) => s + m.monto, 0),
  );

  protected readonly gastosRealesDelMes = computed(() =>
    this.movimientosReales()
      .filter((m) => m.tipo === 'Gasto' && !m.transferenciaId && this.enElPeriodoSeleccionado(m.fecha))
      .reduce((s, m) => s + m.monto, 0),
  );

  /** Movimientos ya generados por adelantado ("Generar futuros" en Fijos y
   *  Proyección) para el período elegido, pero aún no confirmados/ocurridos
   *  de verdad — lo "proyectado" del Dashboard, junto a lo "real" de arriba. */
  protected readonly ingresosProyectadosDelMes = computed(() =>
    this.movimientos()
      .filter((m) => m.proyectado && m.tipo === 'Ingreso' && !m.transferenciaId && this.enElPeriodoSeleccionado(m.fecha))
      .reduce((s, m) => s + m.monto, 0),
  );

  protected readonly gastosProyectadosDelMes = computed(() =>
    this.movimientos()
      .filter((m) => m.proyectado && m.tipo === 'Gasto' && !m.transferenciaId && this.enElPeriodoSeleccionado(m.fecha))
      .reduce((s, m) => s + m.monto, 0),
  );

  /** Saldo total (real, de hoy) + el neto proyectado del período elegido —
   *  a dónde quedaría el saldo si los movimientos ya generados por
   *  adelantado para ese mes se confirman tal cual. Solo tiene sentido
   *  mostrarlo cuando hay algo proyectado que sumar/restar. */
  protected readonly haySaldoProyectado = computed(
    () => this.ingresosProyectadosDelMes() > 0 || this.gastosProyectadosDelMes() > 0,
  );

  protected readonly saldoProyectadoFinDeMes = computed(
    () => this.saldoTotal() + this.ingresosProyectadosDelMes() - this.gastosProyectadosDelMes(),
  );

  private saldoDeCuenta(cuentaId: number): number {
    return this.movimientosReales()
      .filter((m) => Number(m.cuentaPresupuestoId) === Number(cuentaId))
      .reduce((s, m) => s + (m.tipo === 'Ingreso' ? m.monto : -m.monto), 0);
  }

  protected readonly cuentasConInfo = computed<CuentaConInfo[]>(() =>
    this.cuentas().map((cuenta) => {
      const saldo = this.saldoDeCuenta(Number(cuenta.id));
      const esTarjeta = cuenta.tipo === 'Tarjeta';
      return { cuenta, saldo, esTarjeta, info: esTarjeta ? infoTarjeta(cuenta, saldo) : null };
    }),
  );

  /** Pestaña principal del Dashboard: "Resumen" (KPIs, alertas, top
   *  categorías y movimientos recientes) o "Cuentas" (antes siempre visible
   *  debajo de los KPIs, ahora en su propia pestaña para no empujar los
   *  Movimientos tan abajo). */
  protected readonly tabPrincipal = signal<'resumen' | 'cuentas'>('resumen');

  seleccionarTabPrincipal(tab: 'resumen' | 'cuentas'): void {
    this.tabPrincipal.set(tab);
  }

  /** Pestaña de Cuentas seleccionada ('Todas' o un tipo, p.ej. 'Tarjeta'). */
  protected readonly tabCuentaActiva = signal<string>(TAB_TODAS);

  protected readonly tabsCuenta = computed<string[]>(() => {
    const presentes = new Set(this.cuentasConInfo().map((c) => c.cuenta.tipo));
    const conocidos = ORDEN_TIPOS_CUENTA.filter((t) => presentes.has(t));
    const extras = [...presentes].filter((t) => !ORDEN_TIPOS_CUENTA.includes(t)).sort();
    return [TAB_TODAS, ...conocidos, ...extras];
  });

  protected readonly cuentasFiltradas = computed<CuentaConInfo[]>(() => {
    const tab = this.tabCuentaActiva();
    return tab === TAB_TODAS ? this.cuentasConInfo() : this.cuentasConInfo().filter((c) => c.cuenta.tipo === tab);
  });

  seleccionarTabCuenta(tab: string): void {
    this.tabCuentaActiva.set(tab);
  }

  protected readonly deudaTotalTarjetas = computed(() =>
    this.cuentasConInfo().reduce((s, c) => s + (c.info?.deuda ?? 0), 0),
  );

  /** Solo tiene sentido mostrar el total agregado cuando hay más de una tarjeta. */
  protected readonly hayVariasTarjetas = computed(() => this.cuentasConInfo().filter((c) => c.esTarjeta).length > 1);

  protected readonly topCategorias = computed<CategoriaMonto[]>(() => {
    const gastos = this.movimientosReales().filter((m) => m.tipo === 'Gasto' && !m.transferenciaId && this.enElPeriodoSeleccionado(m.fecha));
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
        color: colorCategoria(id),
      }))
      .sort((a, b) => b.monto - a.monto)
      .slice(0, 5);
  });

  protected readonly maxTopCategoria = computed(() => Math.max(1, ...this.topCategorias().map((c) => c.monto)));

  /** Movimientos del período elegido — reales Y proyectados, con la
   *  etiqueta de cuál es cuál (ver plantilla), para poder ver ambos juntos
   *  en vez de solo lo real. */
  protected readonly movimientosRecientes = computed<MovimientoReciente[]>(() =>
    [...this.movimientos()]
      .filter((m) => this.enElPeriodoSeleccionado(m.fecha))
      .sort((a, b) => (a.fecha < b.fecha ? 1 : -1))
      .slice(0, 6)
      .map((movimiento) => ({
        movimiento,
        nombreCuenta: this.cuentas().find((c) => Number(c.id) === Number(movimiento.cuentaPresupuestoId))?.nombre ?? '—',
        nombreCategoria: movimiento.categoriaPresupuestoId
          ? (this.categorias().find((c) => Number(c.id) === Number(movimiento.categoriaPresupuestoId))?.nombre ?? '—')
          : 'Sin categoría',
      })),
  );

  /** Referencia = primer día del período elegido, para comparar ese mes
   *  contra el promedio de los 3 anteriores (en vez de siempre "hoy"). */
  protected readonly inusuales = computed<GastoInusual[]>(() =>
    gastosInusuales(this.movimientosReales(), this.categorias(), new Date(this.anioSeleccionadoNumero(), this.filtroMes(), 1)),
  );

  ngOnInit(): void {
    // Varias tarjetas + selectores de Año/Mes lado a lado — usa el ancho
    // "wide" del layout (ver html[data-wide='grid'] en styles.scss, mismo
    // patrón que Proyección).
    document.documentElement.setAttribute('data-wide', 'grid');
    this.data.list<CuentaPresupuesto>('CuentaPresupuesto').subscribe((c) => this.cuentas.set(c));
    this.data.list<CategoriaPresupuesto>('CategoriaPresupuesto').subscribe((c) => this.categorias.set(c));
    this.data.list<PresupuestoAnual>('PresupuestoAnual').subscribe((p) => this.presupuestosAnuales.set(p));
    this.data
      .list<MovimientoPresupuesto>('MovimientoPresupuesto', { creadoPorUsuarioId: this.auth.usuarioActual()?.id ?? 0 })
      .subscribe((m) => this.movimientos.set(m));
  }

  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  /** Atajo "Pagar tarjeta": deja la solicitud (cuenta destino + monto de la deuda)
   *  para que Movimientos abra el modal de transferencia ya prellenado. */
  pagarTarjeta(cuentaInfo: CuentaConInfo): void {
    if (!cuentaInfo.info || cuentaInfo.info.deuda <= 0) return;
    this.pagoTarjeta.solicitar(cuentaInfo.cuenta, cuentaInfo.info.deuda);
    void this.router.navigate(['/presupuesto/movimientos']);
  }
}

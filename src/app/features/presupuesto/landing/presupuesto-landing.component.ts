import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { DataClientService } from '../../../core/services/data-client.service';
import { CategoriaPresupuesto } from '../../catalogos/categoria-presupuesto/categoria-presupuesto.model';
import { CuentaPresupuesto } from '../../catalogos/cuenta-presupuesto/cuenta-presupuesto.model';
import { MovimientoPresupuesto } from '../movimientos/movimiento.model';
import { PagoTarjetaService } from '../shared/pago-tarjeta.service';
import {
  GastoInusual,
  InfoTarjeta,
  colorCategoria,
  fechaLocalDeTexto,
  formatMoneda,
  gastosInusuales,
  iconoTipoCuenta,
  infoTarjeta,
  nivelUso,
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
export class PresupuestoLandingComponent implements OnInit {
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

  /** Excluye los proyectados (generados por adelantado con "Generar futuros"
   *  en Fijos y Proyección, aún sin confirmar) — el Dashboard solo debe
   *  reflejar dinero que ya entró o salió de verdad, no una proyección. */
  protected readonly movimientosReales = computed(() => this.movimientos().filter((m) => !m.proyectado));

  private enElMesActual(fecha: string): boolean {
    const hoy = new Date();
    const f = fechaLocalDeTexto(fecha);
    return f.getFullYear() === hoy.getFullYear() && f.getMonth() === hoy.getMonth();
  }

  protected readonly saldoTotal = computed(() =>
    this.movimientosReales().reduce((s, m) => s + (m.tipo === 'Ingreso' ? m.monto : -m.monto), 0),
  );

  protected readonly ingresosDelMes = computed(() =>
    this.movimientosReales()
      .filter((m) => m.tipo === 'Ingreso' && !m.transferenciaId && this.enElMesActual(m.fecha))
      .reduce((s, m) => s + m.monto, 0),
  );

  protected readonly gastosDelMes = computed(() =>
    this.movimientosReales()
      .filter((m) => m.tipo === 'Gasto' && !m.transferenciaId && this.enElMesActual(m.fecha))
      .reduce((s, m) => s + m.monto, 0),
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
    const gastos = this.movimientosReales().filter((m) => m.tipo === 'Gasto' && !m.transferenciaId && this.enElMesActual(m.fecha));
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

  protected readonly movimientosRecientes = computed<MovimientoReciente[]>(() =>
    [...this.movimientosReales()]
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

  protected readonly inusuales = computed<GastoInusual[]>(() => gastosInusuales(this.movimientosReales(), this.categorias()));

  ngOnInit(): void {
    this.data.list<CuentaPresupuesto>('CuentaPresupuesto').subscribe((c) => this.cuentas.set(c));
    this.data.list<CategoriaPresupuesto>('CategoriaPresupuesto').subscribe((c) => this.categorias.set(c));
    this.data
      .list<MovimientoPresupuesto>('MovimientoPresupuesto', { creadoPorUsuarioId: this.auth.usuarioActual()?.id ?? 0 })
      .subscribe((m) => this.movimientos.set(m));
  }

  /** Atajo "Pagar tarjeta": deja la solicitud (cuenta destino + monto de la deuda)
   *  para que Movimientos abra el modal de transferencia ya prellenado. */
  pagarTarjeta(cuentaInfo: CuentaConInfo): void {
    if (!cuentaInfo.info || cuentaInfo.info.deuda <= 0) return;
    this.pagoTarjeta.solicitar(cuentaInfo.cuenta, cuentaInfo.info.deuda);
    void this.router.navigate(['/presupuesto/movimientos']);
  }
}

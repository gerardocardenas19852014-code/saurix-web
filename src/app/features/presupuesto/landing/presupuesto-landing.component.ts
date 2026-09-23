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
  formatMoneda,
  gastosInusuales,
  iconoTipoCuenta,
  infoTarjeta,
  nivelUso,
} from '../shared/wallet.util';

type ColorIcono = 'siif' | 'personal' | 'generic';

interface EnlacePresupuesto {
  ruta: string;
  icono: string;
  color: ColorIcono;
  titulo: string;
  descripcion: string;
}

const ENLACES: EnlacePresupuesto[] = [
  {
    ruta: 'movimientos',
    icono: '💸',
    color: 'personal',
    titulo: 'Movimientos',
    descripcion: 'Registro de ingresos, gastos y transferencias entre cuentas.',
  },
  {
    ruta: 'recurrentes',
    icono: '🔁',
    color: 'personal',
    titulo: 'Fijos y Proyección',
    descripcion: 'Ingresos y gastos recurrentes: renta, nómina, suscripciones, etc.',
  },
  {
    ruta: 'deudas',
    icono: '🏦',
    color: 'personal',
    titulo: 'Deudas',
    descripcion: 'Préstamos personales, de auto, etc. — con historial real de abonos.',
  },
  {
    ruta: 'metas',
    icono: '🏆',
    color: 'personal',
    titulo: 'Metas de ahorro',
    descripcion: 'Objetivos de ahorro con seguimiento de tus aportes.',
  },
  {
    ruta: 'limites',
    icono: '🎯',
    color: 'personal',
    titulo: 'Límites de gasto',
    descripcion: 'Tope mensual de gasto por categoría o general.',
  },
  {
    ruta: 'reportes',
    icono: '📊',
    color: 'generic',
    titulo: 'Reportes',
    descripcion: 'Ingresos vs. gastos, gasto por categoría y patrimonio neto histórico.',
  },
  {
    ruta: 'calendario',
    icono: '📅',
    color: 'generic',
    titulo: 'Calendario de pagos',
    descripcion: 'Próximos fijos y próximo pago de cada tarjeta, a 60 días.',
  },
];

interface CuentaConInfo {
  cuenta: CuentaPresupuesto;
  saldo: number;
  esTarjeta: boolean;
  info: InfoTarjeta | null;
}

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

  protected readonly enlaces = ENLACES;
  protected readonly formatMoneda = formatMoneda;
  protected readonly colorCategoria = colorCategoria;
  protected readonly iconoTipoCuenta = iconoTipoCuenta;
  protected readonly nivelUso = nivelUso;

  protected readonly cuentas = signal<CuentaPresupuesto[]>([]);
  protected readonly movimientos = signal<MovimientoPresupuesto[]>([]);
  protected readonly categorias = signal<CategoriaPresupuesto[]>([]);

  private enElMesActual(fecha: string): boolean {
    const hoy = new Date();
    const f = new Date(fecha);
    return f.getFullYear() === hoy.getFullYear() && f.getMonth() === hoy.getMonth();
  }

  protected readonly saldoTotal = computed(() =>
    this.movimientos().reduce((s, m) => s + (m.tipo === 'Ingreso' ? m.monto : -m.monto), 0),
  );

  protected readonly ingresosDelMes = computed(() =>
    this.movimientos()
      .filter((m) => m.tipo === 'Ingreso' && !m.transferenciaId && this.enElMesActual(m.fecha))
      .reduce((s, m) => s + m.monto, 0),
  );

  protected readonly gastosDelMes = computed(() =>
    this.movimientos()
      .filter((m) => m.tipo === 'Gasto' && !m.transferenciaId && this.enElMesActual(m.fecha))
      .reduce((s, m) => s + m.monto, 0),
  );

  private saldoDeCuenta(cuentaId: number): number {
    return this.movimientos()
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

  protected readonly deudaTotalTarjetas = computed(() =>
    this.cuentasConInfo().reduce((s, c) => s + (c.info?.deuda ?? 0), 0),
  );

  /** Solo tiene sentido mostrar el total agregado cuando hay más de una tarjeta. */
  protected readonly hayVariasTarjetas = computed(() => this.cuentasConInfo().filter((c) => c.esTarjeta).length > 1);

  protected readonly topCategorias = computed<CategoriaMonto[]>(() => {
    const gastos = this.movimientos().filter((m) => m.tipo === 'Gasto' && !m.transferenciaId && this.enElMesActual(m.fecha));
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
    [...this.movimientos()]
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

  protected readonly inusuales = computed<GastoInusual[]>(() => gastosInusuales(this.movimientos(), this.categorias()));

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

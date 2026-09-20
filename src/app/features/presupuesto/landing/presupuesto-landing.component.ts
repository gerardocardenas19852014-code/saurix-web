import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { DataClientService } from '../../../core/services/data-client.service';
import { CuentaPresupuesto } from '../../catalogos/cuenta-presupuesto/cuenta-presupuesto.model';
import { MovimientoPresupuesto } from '../movimientos/movimiento.model';
import { formatMoneda } from '../shared/wallet.util';

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

/** Resumen (saldo total y gasto del mes) calculado directamente de cuentas + movimientos. */
@Component({
  selector: 'app-presupuesto-landing',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './presupuesto-landing.component.html',
  styleUrl: './presupuesto-landing.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PresupuestoLandingComponent implements OnInit {
  private readonly data = inject(DataClientService);
  private readonly auth = inject(AuthService);

  protected readonly enlaces = ENLACES;
  protected readonly formatMoneda = formatMoneda;

  protected readonly cuentas = signal<CuentaPresupuesto[]>([]);
  protected readonly movimientos = signal<MovimientoPresupuesto[]>([]);

  protected readonly saldoTotal = computed(() =>
    this.movimientos().reduce((s, m) => s + (m.tipo === 'Ingreso' ? m.monto : -m.monto), 0),
  );

  protected readonly gastosDelMes = computed(() => {
    const hoy = new Date();
    return this.movimientos()
      .filter((m) => m.tipo === 'Gasto' && !m.transferenciaId)
      .filter((m) => {
        const f = new Date(m.fecha);
        return f.getFullYear() === hoy.getFullYear() && f.getMonth() === hoy.getMonth();
      })
      .reduce((s, m) => s + m.monto, 0);
  });

  ngOnInit(): void {
    this.data.list<CuentaPresupuesto>('CuentaPresupuesto').subscribe((c) => this.cuentas.set(c));
    this.data
      .list<MovimientoPresupuesto>('MovimientoPresupuesto', { creadoPorUsuarioId: this.auth.usuarioActual()?.id ?? 0 })
      .subscribe((m) => this.movimientos.set(m));
  }
}

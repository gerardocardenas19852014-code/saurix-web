import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AuthService } from '../../../core/services/auth.service';
import { DataClientService } from '../../../core/services/data-client.service';
import { CuentaPresupuesto } from '../cuenta-presupuesto/cuenta-presupuesto.model';
import { MovimientoPresupuesto } from '../movimientos/movimiento.model';
import { MovimientoRecurrentePresupuesto } from '../recurrentes/recurrente.model';
import { formatMoneda, iconoTipoCuenta } from '../shared/wallet.util';

const DIAS_VENTANA = 60;

interface EventoCalendario {
  fecha: Date;
  icono: string;
  titulo: string;
  detalle: string;
  monto: number | null;
  tipo: string; // catálogo "Listas de valores", grupo MovimientoPresupuestoTipo
}

interface DiaCalendario {
  fecha: Date;
  eventos: EventoCalendario[];
}

/**
 * Calendario de pagos: próximos "fijos" (Fijos y Proyección) + próximo pago
 * de cada tarjeta, a 60 días — puramente cálculo/UI en cliente sobre datos
 * ya cargados, sin tablas ni SPs nuevos (tal como lo documenta el prototipo).
 */
@Component({
  selector: 'app-calendario',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './calendario.component.html',
  styleUrl: './calendario.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarioComponent implements OnInit {
  private readonly data = inject(DataClientService);
  private readonly auth = inject(AuthService);

  protected readonly formatMoneda = formatMoneda;
  protected readonly iconoTipoCuenta = iconoTipoCuenta;

  protected readonly cuentas = signal<CuentaPresupuesto[]>([]);
  protected readonly recurrentes = signal<MovimientoRecurrentePresupuesto[]>([]);
  protected readonly movimientos = signal<MovimientoPresupuesto[]>([]);
  protected readonly cargando = signal(false);

  private get usuarioActualId(): number {
    return this.auth.usuarioActual()?.id ?? 0;
  }

  ngOnInit(): void {
    this.cargando.set(true);
    this.data.list<CuentaPresupuesto>('CuentaPresupuesto').subscribe((c) => this.cuentas.set(c));
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

  /** Excluye movimientos proyectados a futuro: la deuda de tarjeta que se
   *  muestra aquí debe ser la real, no una que incluya cargos que todavía no
   *  se han confirmado. */
  private saldoCuenta(cuentaId: number): number {
    return this.movimientos()
      .filter((m) => Number(m.cuentaPresupuestoId) === Number(cuentaId) && !m.proyectado)
      .reduce((s, m) => s + (m.tipo === 'Ingreso' ? m.monto : -m.monto), 0);
  }

  /** Próxima fecha (hoy o después) en la que cae un "día del mes" dado, clampado al último día de cada mes. */
  private proximaFechaMensual(diaDelMes: number, hoy: Date): Date {
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

  /** Próxima fecha (hoy o después) en la que cae un fijo Anual, anclado al mes de su fechaCreacion. */
  private proximaFechaAnual(fijo: MovimientoRecurrentePresupuesto, hoy: Date): Date {
    const mesAncla = fijo.fechaCreacion ? new Date(fijo.fechaCreacion).getMonth() : hoy.getMonth();
    const ultimoDia = new Date(hoy.getFullYear(), mesAncla + 1, 0).getDate();
    let candidata = new Date(hoy.getFullYear(), mesAncla, Math.min(fijo.diaDelMes, ultimoDia));
    candidata.setHours(0, 0, 0, 0);
    const hoySinHora = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    if (candidata < hoySinHora) {
      const ultimoDiaSiguiente = new Date(hoy.getFullYear() + 1, mesAncla + 1, 0).getDate();
      candidata = new Date(hoy.getFullYear() + 1, mesAncla, Math.min(fijo.diaDelMes, ultimoDiaSiguiente));
    }
    return candidata;
  }

  protected readonly eventos = computed<EventoCalendario[]>(() => {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const limite = new Date(hoy.getTime() + DIAS_VENTANA * 86400000);
    const eventos: EventoCalendario[] = [];

    for (const fijo of this.recurrentes()) {
      // Igual que en Fijos y Proyección (recurrentes.component.ts): 'Anual' es
      // la única frecuencia con su propio cálculo (anclada al mes de
      // creación); cualquier otra (Mensual, Quincenal, o una clave nueva del
      // catálogo) usa la cadencia mensual clampada al último día de cada mes.
      const fecha = fijo.frecuencia === 'Anual' ? this.proximaFechaAnual(fijo, hoy) : this.proximaFechaMensual(fijo.diaDelMes, hoy);
      if (fecha <= limite) {
        eventos.push({
          fecha,
          icono: fijo.tipo === 'Ingreso' ? '💰' : '🔁',
          titulo: fijo.descripcion,
          detalle: fijo.frecuencia === 'Anual' ? 'Fijo anual' : `Fijo ${fijo.frecuencia.toLowerCase()}`,
          monto: fijo.monto,
          tipo: fijo.tipo,
        });
      }
    }

    for (const cuenta of this.cuentas()) {
      if (cuenta.tipo !== 'Tarjeta' || !cuenta.diaPago) continue;
      const fecha = this.proximaFechaMensual(cuenta.diaPago, hoy);
      if (fecha > limite) continue;
      const deuda = Math.max(-this.saldoCuenta(cuenta.id), 0);
      const detalle = cuenta.pagoMinimo ? `Pago mínimo: ${this.formatMoneda(cuenta.pagoMinimo)}` : 'Fecha límite de pago';
      eventos.push({
        fecha,
        icono: '💳',
        titulo: `Pago de ${cuenta.nombre}`,
        detalle,
        monto: deuda > 0 ? deuda : null,
        tipo: 'Gasto',
      });
    }

    return eventos.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
  });

  protected readonly diasAgrupados = computed<DiaCalendario[]>(() => {
    const porFecha = new Map<string, DiaCalendario>();
    for (const evento of this.eventos()) {
      const clave = evento.fecha.toISOString().slice(0, 10);
      if (!porFecha.has(clave)) porFecha.set(clave, { fecha: evento.fecha, eventos: [] });
      porFecha.get(clave)!.eventos.push(evento);
    }
    return [...porFecha.values()].sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
  });

  diasRestantes(fecha: Date): string {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const dias = Math.round((fecha.getTime() - hoy.getTime()) / 86400000);
    if (dias === 0) return 'hoy';
    if (dias === 1) return 'mañana';
    return `en ${dias} días`;
  }
}

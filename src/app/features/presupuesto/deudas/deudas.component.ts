import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { forkJoin } from 'rxjs';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { DataClientService } from '../../../core/services/data-client.service';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { CuentaPresupuesto } from '../cuenta-presupuesto/cuenta-presupuesto.model';
import { MovimientoPresupuesto } from '../movimientos/movimiento.model';
import { fechaLocalDeTexto, formatMoneda, opcionesCuentasBuscable } from '../shared/wallet.util';
import { DeudaPresupuesto, DeudaPresupuestoAbono } from './deuda.model';
import { SelectBuscableComponent } from '../../../shared/components/select-buscable/select-buscable.component';

/**
 * Deudas (préstamos). El saldo de cada deuda se calcula 100% a partir de su
 * historial real de abonos (DeudaPresupuestoAbono) — "+ Abonar" agrega un
 * registro al historial (nunca muta saldoActual directamente); saldoActual
 * se guarda igual como caché (para listados rápidos) pero siempre
 * recalculado desde el ledger.
 */
@Component({
  selector: 'app-deudas',
  standalone: true,
  imports: [ReactiveFormsModule, ConfirmDialogComponent, DatePipe, DecimalPipe, SelectBuscableComponent],
  templateUrl: './deudas.component.html',
  styleUrl: './deudas.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeudasComponent implements OnInit, OnDestroy {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);

  protected readonly formatMoneda = formatMoneda;

  protected readonly deudas = signal<DeudaPresupuesto[]>([]);
  protected readonly abonos = signal<DeudaPresupuestoAbono[]>([]);
  protected readonly cuentas = signal<CuentaPresupuesto[]>([]);

  /** Opciones del combo buscable de cuenta en la fila de "+ Abonar". */
  protected readonly opcionesCuentaAbono = computed(() => [
    { valor: 0, etiqueta: 'No registrar como gasto' },
    ...opcionesCuentasBuscable(this.cuentas()),
  ]);
  protected readonly cargando = signal(false);
  protected readonly modalAbierto = signal(false);
  protected readonly enEdicion = signal<DeudaPresupuesto | null>(null);
  protected readonly aEliminar = signal<DeudaPresupuesto | null>(null);
  protected readonly historialAbierto = signal<number | null>(null);

  /** Antes las deudas liquidadas se quedaban mezcladas para siempre con las
   *  activas en la misma lista; ahora se ocultan por default (igual que
   *  "Mostrar inactivas" en los catálogos) y este checkbox las regresa. */
  protected readonly mostrarLiquidadas = signal(false);

  protected readonly deudasActivas = computed(() => this.deudas().filter((d) => !this.liquidada(d)));
  protected readonly cantidadLiquidadas = computed(() => this.deudas().length - this.deudasActivas().length);
  protected readonly deudasVisibles = computed(() => (this.mostrarLiquidadas() ? this.deudas() : this.deudasActivas()));

  /** Resumen arriba de la lista: cuánto debes hoy (solo deudas activas) y
   *  cuánto ya abonaste este mes calendario (a cualquier deuda, activa o no). */
  protected readonly totalAdeudado = computed(() => this.deudasActivas().reduce((s, d) => s + this.saldoDeuda(d), 0));

  protected readonly totalPagadoEsteMes = computed(() => {
    const hoy = new Date();
    // Filtra a abonos de deudas que SIGUEN existiendo — de haber alguno
    // huérfano (abono cuya deuda ya se borró; con datos de antes de que
    // confirmarEliminar empezara a limpiarlos también) no se cuenta aquí.
    const idsDeudasExistentes = new Set(this.deudas().map((d) => Number(d.id)));
    return this.abonos()
      .filter((a) => idsDeudasExistentes.has(Number(a.deudaPresupuestoId)))
      .filter((a) => {
        const f = fechaLocalDeTexto(a.fecha);
        return f.getFullYear() === hoy.getFullYear() && f.getMonth() === hoy.getMonth();
      })
      .reduce((s, a) => s + a.monto, 0);
  });

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    descripcion: ['', Validators.required],
    montoOriginal: [0, [Validators.required, Validators.min(0.01)]],
    fechaInicio: [new Date().toISOString().slice(0, 10), Validators.required],
  });

  private get usuarioActualId(): number {
    return this.auth.usuarioActual()?.id ?? 0;
  }

  ngOnInit(): void {
    // Tarjetas con barra de progreso apiladas — usa el ancho "wide" del
    // layout para aprovechar mejor el espacio (ver html[data-wide='grid']
    // en styles.scss, mismo patrón que Movimientos).
    document.documentElement.setAttribute('data-wide', 'grid');
    this.data.list<CuentaPresupuesto>('CuentaPresupuesto').subscribe((c) => this.cuentas.set(c));
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.data.list<DeudaPresupuesto>('DeudaPresupuesto', { creadoPorUsuarioId: this.usuarioActualId }).subscribe({
      next: (d) => {
        this.deudas.set(d);
        this.cargando.set(false);
        this.data.list<DeudaPresupuestoAbono>('DeudaPresupuestoAbono', { creadoPorUsuarioId: this.usuarioActualId }).subscribe((a) => this.abonos.set(a));
      },
      error: () => this.cargando.set(false),
    });
  }

  /** Nombre de la cuenta de un abono que sí se registró como Gasto real —
   *  para el historial (ver plantilla). '—' si esa cuenta ya no existe. */
  nombreCuenta(cuentaId: number | null | undefined): string {
    if (!cuentaId) return '—';
    return this.cuentas().find((c) => Number(c.id) === Number(cuentaId))?.nombre ?? '—';
  }

  abonosDe(deudaId: number): DeudaPresupuestoAbono[] {
    return this.abonos()
      .filter((a) => Number(a.deudaPresupuestoId) === Number(deudaId))
      .sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  }

  totalAbonado(deudaId: number): number {
    return this.abonosDe(deudaId).reduce((s, a) => s + a.monto, 0);
  }

  /** Saldo real = monto original menos la suma de sus abonos (nunca menor a 0). */
  saldoDeuda(deuda: DeudaPresupuesto): number {
    return Math.max(deuda.montoOriginal - this.totalAbonado(deuda.id), 0);
  }

  pctPagado(deuda: DeudaPresupuesto): number {
    if (deuda.montoOriginal <= 0) return 0;
    const pagado = deuda.montoOriginal - this.saldoDeuda(deuda);
    return Math.min(Math.max((pagado / deuda.montoOriginal) * 100, 0), 100);
  }

  liquidada(deuda: DeudaPresupuesto): boolean {
    return this.saldoDeuda(deuda) <= 0;
  }

  toggleHistorial(deuda: DeudaPresupuesto): void {
    this.historialAbierto.update((id) => (id === deuda.id ? null : deuda.id));
  }

  nuevo(): void {
    this.enEdicion.set(null);
    this.form.reset({ id: 0, descripcion: '', montoOriginal: 0, fechaInicio: new Date().toISOString().slice(0, 10) });
    this.modalAbierto.set(true);
  }

  editar(item: DeudaPresupuesto): void {
    this.enEdicion.set(item);
    this.form.reset({ id: item.id, descripcion: item.descripcion, montoOriginal: item.montoOriginal, fechaInicio: item.fechaInicio?.slice(0, 10) });
    this.modalAbierto.set(true);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const valor = this.form.getRawValue();
    const esEdicion = this.enEdicion() !== null;
    // El saldo siempre se deriva del ledger de abonos, nunca se captura a mano.
    const abonadoPrevio = esEdicion ? this.totalAbonado(valor.id) : 0;
    const payload = {
      ...valor,
      saldoActual: Math.max(valor.montoOriginal - abonadoPrevio, 0),
      creadoPorUsuarioId: this.usuarioActualId,
    };
    const peticion = esEdicion
      ? this.data.modificacion<DeudaPresupuesto>('DeudaPresupuesto', payload)
      : this.data.alta<DeudaPresupuesto>('DeudaPresupuesto', payload);
    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? 'Actualizada.' : 'Creada.');
        this.modalAbierto.set(false);
        this.cargar();
      },
    });
  }

  /** cuentaIdTexto viene del <select> "Desde: <cuenta>" del abono — "0" (o
   *  vacío) significa que este abono NO debe afectar ninguna cuenta (el
   *  comportamiento de siempre: solo un registro en este ledger). Si el
   *  usuario elige una cuenta, además se genera un Gasto real en Movimientos
   *  para que el pago se refleje en el saldo de esa cuenta y en
   *  Reportes/Dashboard, igual que cualquier otro gasto. */
  abonar(deuda: DeudaPresupuesto, montoTexto: string, cuentaIdTexto: number | string | null): void {
    const monto = parseFloat(montoTexto);
    if (!monto || monto <= 0) {
      this.toast.advertencia('Escribe un monto válido para abonar.');
      return;
    }
    const cuentaId = Number(cuentaIdTexto) || 0;

    const registrarAbono = (movimientoPresupuestoId: number | null): void => {
      const abono = {
        deudaPresupuestoId: deuda.id,
        fecha: new Date().toISOString().slice(0, 10),
        monto,
        nota: null,
        cuentaPresupuestoId: cuentaId || null,
        movimientoPresupuestoId,
        creadoPorUsuarioId: this.usuarioActualId,
      };
      this.data.alta<DeudaPresupuestoAbono>('DeudaPresupuestoAbono', abono).subscribe({
        next: () => {
          const nuevoSaldo = Math.max(deuda.saldoActual - monto, 0);
          this.data.modificacion<DeudaPresupuesto>('DeudaPresupuesto', { ...deuda, saldoActual: nuevoSaldo }).subscribe({
            next: () => {
              const sufijoCuenta = cuentaId ? ` desde ${this.nombreCuenta(cuentaId)}` : '';
              this.toast.exito(nuevoSaldo <= 0 ? `🎉 ¡Liquidaste "${deuda.descripcion}"!` : `Se abonaron ${this.formatMoneda(monto)}${sufijoCuenta}.`);
              this.cargar();
            },
          });
        },
      });
    };

    if (!cuentaId) {
      registrarAbono(null);
      return;
    }

    const movimiento: Partial<MovimientoPresupuesto> = {
      fecha: new Date().toISOString().slice(0, 10),
      tipo: 'Gasto',
      cuentaPresupuestoId: cuentaId,
      categoriaPresupuestoId: null,
      monto,
      descripcion: `Abono a "${deuda.descripcion}"`,
      transferenciaId: null,
      origenRecurrenteId: null,
      proyectado: false,
      creadoPorUsuarioId: this.usuarioActualId,
    };
    this.data.alta<MovimientoPresupuesto>('MovimientoPresupuesto', movimiento).subscribe({
      next: (creado) => registrarAbono(creado.id),
      error: () => this.toast.error('No se pudo registrar el gasto en la cuenta. Intenta de nuevo.'),
    });
  }

  eliminarAbono(abono: DeudaPresupuestoAbono, deuda: DeudaPresupuesto): void {
    this.data.baja('DeudaPresupuestoAbono', abono.id).subscribe({
      next: () => {
        // Si este abono había generado un Gasto real en una cuenta, se
        // revierte también (best-effort: si ya no existe, no pasa nada).
        if (abono.movimientoPresupuestoId) {
          this.data.baja('MovimientoPresupuesto', abono.movimientoPresupuestoId).subscribe();
        }
        const nuevoSaldo = Math.min(deuda.saldoActual + abono.monto, deuda.montoOriginal);
        this.data.modificacion<DeudaPresupuesto>('DeudaPresupuesto', { ...deuda, saldoActual: nuevoSaldo }).subscribe({
          next: () => {
            this.toast.exito('Abono eliminado.');
            this.cargar();
          },
        });
      },
    });
  }

  pedirEliminar(item: DeudaPresupuesto): void {
    this.aEliminar.set(item);
  }

  confirmarEliminar(): void {
    const item = this.aEliminar();
    if (!item) return;

    const eliminarDeuda = (): void => {
      this.data.baja('DeudaPresupuesto', item.id).subscribe({
        next: () => {
          this.toast.exito('Eliminada.');
          this.aEliminar.set(null);
          this.cargar();
        },
      });
    };

    // El historial de abonos de esta deuda no tiene sentido sin su padre —
    // se borra junto con ella para no dejar abonos huérfanos (que antes se
    // colaban, por ejemplo, en el total de "Pagado este mes"). Los Gastos
    // reales que algún abono haya generado en una cuenta se CONSERVAN a
    // propósito: ese dinero ya salió de verdad, y borrar el rastreo de la
    // deuda no debe "desaparecerlo" de Movimientos/Reportes/Dashboard.
    const abonosDeEsta = this.abonosDe(item.id);
    if (abonosDeEsta.length === 0) {
      eliminarDeuda();
    } else {
      forkJoin(abonosDeEsta.map((a) => this.data.baja('DeudaPresupuestoAbono', a.id))).subscribe({ next: eliminarDeuda });
    }
  }


  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }
}

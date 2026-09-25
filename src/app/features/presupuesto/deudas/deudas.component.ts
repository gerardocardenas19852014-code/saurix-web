import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { DataClientService } from '../../../core/services/data-client.service';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { formatMoneda } from '../shared/wallet.util';
import { DeudaPresupuesto, DeudaPresupuestoAbono } from './deuda.model';

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
  imports: [ReactiveFormsModule, ConfirmDialogComponent, DatePipe, DecimalPipe],
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
  protected readonly cargando = signal(false);
  protected readonly modalAbierto = signal(false);
  protected readonly enEdicion = signal<DeudaPresupuesto | null>(null);
  protected readonly aEliminar = signal<DeudaPresupuesto | null>(null);
  protected readonly historialAbierto = signal<number | null>(null);

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

  abonar(deuda: DeudaPresupuesto, montoTexto: string): void {
    const monto = parseFloat(montoTexto);
    if (!monto || monto <= 0) {
      this.toast.advertencia('Escribe un monto válido para abonar.');
      return;
    }
    const abono = {
      deudaPresupuestoId: deuda.id,
      fecha: new Date().toISOString().slice(0, 10),
      monto,
      nota: null,
      creadoPorUsuarioId: this.usuarioActualId,
    };
    this.data.alta<DeudaPresupuestoAbono>('DeudaPresupuestoAbono', abono).subscribe({
      next: () => {
        const nuevoSaldo = Math.max(deuda.saldoActual - monto, 0);
        this.data.modificacion<DeudaPresupuesto>('DeudaPresupuesto', { ...deuda, saldoActual: nuevoSaldo }).subscribe({
          next: () => {
            this.toast.exito(nuevoSaldo <= 0 ? `🎉 ¡Liquidaste "${deuda.descripcion}"!` : `Se abonaron ${this.formatMoneda(monto)}.`);
            this.cargar();
          },
        });
      },
    });
  }

  eliminarAbono(abono: DeudaPresupuestoAbono, deuda: DeudaPresupuesto): void {
    this.data.baja('DeudaPresupuestoAbono', abono.id).subscribe({
      next: () => {
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
    this.data.baja('DeudaPresupuesto', item.id).subscribe({
      next: () => {
        this.toast.exito('Eliminada.');
        this.aEliminar.set(null);
        this.cargar();
      },
    });
  }


  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }
}

import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { DataClientService } from '../../../core/services/data-client.service';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { formatMoneda } from '../shared/wallet.util';
import { MetaPresupuesto } from './meta.model';

/** Metas de ahorro — seguimiento manual (el usuario aporta y montoActual sube). */
@Component({
  selector: 'app-metas',
  standalone: true,
  imports: [ReactiveFormsModule, ConfirmDialogComponent, DatePipe, DecimalPipe],
  templateUrl: './metas.component.html',
  styleUrl: './metas.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MetasComponent implements OnInit {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);

  protected readonly formatMoneda = formatMoneda;

  protected readonly metas = signal<MetaPresupuesto[]>([]);
  protected readonly cargando = signal(false);
  protected readonly modalAbierto = signal(false);
  protected readonly enEdicion = signal<MetaPresupuesto | null>(null);
  protected readonly aEliminar = signal<MetaPresupuesto | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    nombre: ['', Validators.required],
    montoObjetivo: [0, [Validators.required, Validators.min(0.01)]],
    montoActual: [0, [Validators.required, Validators.min(0)]],
    fechaLimite: [new Date().toISOString().slice(0, 10), Validators.required],
  });

  private get usuarioActualId(): number {
    return this.auth.usuarioActual()?.id ?? 0;
  }

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.data.list<MetaPresupuesto>('MetaPresupuesto', { creadoPorUsuarioId: this.usuarioActualId }).subscribe({
      next: (m) => {
        this.metas.set(m);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  pctAhorrado(meta: MetaPresupuesto): number {
    if (meta.montoObjetivo <= 0) return 0;
    return Math.min((meta.montoActual / meta.montoObjetivo) * 100, 100);
  }

  cumplida(meta: MetaPresupuesto): boolean {
    return meta.montoActual >= meta.montoObjetivo;
  }

  diasRestantes(meta: MetaPresupuesto): number | null {
    if (!meta.fechaLimite) return null;
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const limite = new Date(meta.fechaLimite + 'T00:00:00');
    return Math.ceil((limite.getTime() - hoy.getTime()) / 86400000);
  }

  nuevo(): void {
    this.enEdicion.set(null);
    this.form.reset({ id: 0, nombre: '', montoObjetivo: 0, montoActual: 0, fechaLimite: new Date().toISOString().slice(0, 10) });
    this.modalAbierto.set(true);
  }

  editar(item: MetaPresupuesto): void {
    this.enEdicion.set(item);
    this.form.reset({ ...item, fechaLimite: item.fechaLimite?.slice(0, 10) });
    this.modalAbierto.set(true);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const valor = this.form.getRawValue();
    const esEdicion = this.enEdicion() !== null;
    const payload = { ...valor, creadoPorUsuarioId: this.usuarioActualId };
    const peticion = esEdicion
      ? this.data.modificacion<MetaPresupuesto>('MetaPresupuesto', payload)
      : this.data.alta<MetaPresupuesto>('MetaPresupuesto', payload);
    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? 'Actualizada.' : 'Creada.');
        this.modalAbierto.set(false);
        this.cargar();
      },
    });
  }

  aportar(meta: MetaPresupuesto, montoTexto: string): void {
    const monto = parseFloat(montoTexto);
    if (!monto || monto <= 0) {
      this.toast.advertencia('Escribe un monto válido para aportar.');
      return;
    }
    const montoActual = meta.montoActual + monto;
    this.data.modificacion<MetaPresupuesto>('MetaPresupuesto', { ...meta, montoActual }).subscribe({
      next: () => {
        this.toast.exito(
          montoActual >= meta.montoObjetivo ? `🎉 ¡Alcanzaste tu meta "${meta.nombre}"!` : `Se agregaron ${this.formatMoneda(monto)}.`,
        );
        this.cargar();
      },
    });
  }

  pedirEliminar(item: MetaPresupuesto): void {
    this.aEliminar.set(item);
  }

  confirmarEliminar(): void {
    const item = this.aEliminar();
    if (!item) return;
    this.data.baja('MetaPresupuesto', item.id).subscribe({
      next: () => {
        this.toast.exito('Eliminada.');
        this.aEliminar.set(null);
        this.cargar();
      },
    });
  }
}

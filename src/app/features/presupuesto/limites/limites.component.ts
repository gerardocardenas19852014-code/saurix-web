import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { DataClientService } from '../../../core/services/data-client.service';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { CategoriaPresupuesto } from '../../catalogos/categoria-presupuesto/categoria-presupuesto.model';
import { MovimientoPresupuesto } from '../movimientos/movimiento.model';
import { formatMoneda, nivelUso } from '../shared/wallet.util';
import { LimitePresupuesto } from './limite.model';

/** Límites de gasto mensual: por categoría, o general (todas) si categoriaPresupuestoId es NULL. */
@Component({
  selector: 'app-limites',
  standalone: true,
  imports: [ReactiveFormsModule, ConfirmDialogComponent, DecimalPipe],
  templateUrl: './limites.component.html',
  styleUrl: './limites.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LimitesComponent implements OnInit {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);

  protected readonly formatMoneda = formatMoneda;

  protected readonly limites = signal<LimitePresupuesto[]>([]);
  protected readonly categorias = signal<CategoriaPresupuesto[]>([]);
  protected readonly movimientos = signal<MovimientoPresupuesto[]>([]);
  protected readonly cargando = signal(false);
  protected readonly modalAbierto = signal(false);
  protected readonly enEdicion = signal<LimitePresupuesto | null>(null);
  protected readonly aEliminar = signal<LimitePresupuesto | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    categoriaPresupuestoId: [0],
    montoLimite: [0, [Validators.required, Validators.min(0.01)]],
  });

  private get usuarioActualId(): number {
    return this.auth.usuarioActual()?.id ?? 0;
  }

  ngOnInit(): void {
    this.data.list<CategoriaPresupuesto>('CategoriaPresupuesto').subscribe((c) => this.categorias.set(c));
    this.data.list<MovimientoPresupuesto>('MovimientoPresupuesto', { creadoPorUsuarioId: this.usuarioActualId }).subscribe((m) => this.movimientos.set(m));
    this.cargar();
  }

  nombreCategoria(id: number | null): string {
    if (!id) return 'General (todas)';
    return this.categorias().find((c) => Number(c.id) === Number(id))?.nombre ?? '—';
  }

  /** Gasto acumulado en el mes en curso para una categoría (o el total, si id es null = límite general). */
  gastoDelMes(categoriaId: number | null): number {
    const hoy = new Date();
    return this.movimientos()
      .filter((m) => m.tipo === 'Gasto' && !m.transferenciaId)
      .filter((m) => {
        const f = new Date(m.fecha);
        return f.getFullYear() === hoy.getFullYear() && f.getMonth() === hoy.getMonth();
      })
      .filter((m) => (categoriaId ? Number(m.categoriaPresupuestoId) === Number(categoriaId) : true))
      .reduce((s, m) => s + m.monto, 0);
  }

  pctUsado(limite: LimitePresupuesto): number {
    if (limite.montoLimite <= 0) return 0;
    return Math.min((this.gastoDelMes(limite.categoriaPresupuestoId) / limite.montoLimite) * 100, 100);
  }

  pctUsadoReal(limite: LimitePresupuesto): number {
    if (limite.montoLimite <= 0) return 0;
    return (this.gastoDelMes(limite.categoriaPresupuestoId) / limite.montoLimite) * 100;
  }

  nivel(limite: LimitePresupuesto): 'ok' | 'warn' | 'over' {
    return nivelUso(this.pctUsadoReal(limite));
  }

  cargar(): void {
    this.cargando.set(true);
    this.data.list<LimitePresupuesto>('LimitePresupuesto', { creadoPorUsuarioId: this.usuarioActualId }).subscribe({
      next: (l) => {
        this.limites.set(l);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  nuevo(): void {
    this.enEdicion.set(null);
    this.form.reset({ id: 0, categoriaPresupuestoId: 0, montoLimite: 0 });
    this.modalAbierto.set(true);
  }

  editar(item: LimitePresupuesto): void {
    this.enEdicion.set(item);
    this.form.reset({ id: item.id, categoriaPresupuestoId: item.categoriaPresupuestoId ? Number(item.categoriaPresupuestoId) : 0, montoLimite: item.montoLimite });
    this.modalAbierto.set(true);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const valor = this.form.getRawValue();
    const payload = {
      ...valor,
      categoriaPresupuestoId: valor.categoriaPresupuestoId ? Number(valor.categoriaPresupuestoId) : null,
      creadoPorUsuarioId: this.usuarioActualId,
    };
    const esEdicion = this.enEdicion() !== null;
    const peticion = esEdicion
      ? this.data.modificacion<LimitePresupuesto>('LimitePresupuesto', payload)
      : this.data.alta<LimitePresupuesto>('LimitePresupuesto', payload);
    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? 'Actualizado.' : 'Creado.');
        this.modalAbierto.set(false);
        this.cargar();
      },
    });
  }

  pedirEliminar(item: LimitePresupuesto): void {
    this.aEliminar.set(item);
  }

  confirmarEliminar(): void {
    const item = this.aEliminar();
    if (!item) return;
    this.data.baja('LimitePresupuesto', item.id).subscribe({
      next: () => {
        this.toast.exito('Eliminado.');
        this.aEliminar.set(null);
        this.cargar();
      },
    });
  }
}

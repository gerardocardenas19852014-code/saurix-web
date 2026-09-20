import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DataClientService } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { CuentaPresupuesto } from './cuenta-presupuesto.model';

@Component({
  selector: 'app-cuentas-presupuesto',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent],
  templateUrl: './cuentas-presupuesto.component.html',
  styleUrl: './cuentas-presupuesto.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CuentasPresupuestoComponent implements OnInit {
  private readonly data = inject(DataClientService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly cuentas = signal<CuentaPresupuesto[]>([]);
  protected readonly cargando = signal(false);
  protected readonly busqueda = signal('');

  protected readonly modalAbierto = signal(false);
  protected readonly cuentaEnEdicion = signal<CuentaPresupuesto | null>(null);
  protected readonly cuentaAEliminar = signal<CuentaPresupuesto | null>(null);

  protected readonly columnas: ColumnaTabla<CuentaPresupuesto>[] = [
    { campo: 'nombre', etiqueta: 'Nombre' },
    { campo: 'tipo', etiqueta: 'Tipo' },
  ];

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    nombre: ['', Validators.required],
    tipo: ['Efectivo' as CuentaPresupuesto['tipo'], Validators.required],
    limiteCredito: [0],
    diaCorte: [0],
    diaPago: [0],
    pagoMinimo: [0],
    pagoSinIntereses: [0],
  });

  get esTarjeta(): boolean {
    return this.form.controls.tipo.value === 'Tarjeta';
  }

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.data.list<CuentaPresupuesto>('CuentaPresupuesto', { nombre: this.busqueda() || undefined }).subscribe({
      next: (cuentas) => {
        this.cuentas.set(cuentas);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  nueva(): void {
    this.cuentaEnEdicion.set(null);
    this.form.reset({ id: 0, nombre: '', tipo: 'Efectivo', limiteCredito: 0, diaCorte: 0, diaPago: 0, pagoMinimo: 0, pagoSinIntereses: 0 });
    this.modalAbierto.set(true);
  }

  editar(cuenta: CuentaPresupuesto): void {
    this.cuentaEnEdicion.set(cuenta);
    this.form.reset({
      id: cuenta.id,
      nombre: cuenta.nombre,
      tipo: cuenta.tipo,
      limiteCredito: cuenta.limiteCredito ?? 0,
      diaCorte: cuenta.diaCorte ?? 0,
      diaPago: cuenta.diaPago ?? 0,
      pagoMinimo: cuenta.pagoMinimo ?? 0,
      pagoSinIntereses: cuenta.pagoSinIntereses ?? 0,
    });
    this.modalAbierto.set(true);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const valor = this.form.getRawValue();
    const esTarjeta = valor.tipo === 'Tarjeta';
    const enEdicion = this.cuentaEnEdicion();
    const payload = {
      ...valor,
      limiteCredito: esTarjeta ? valor.limiteCredito : null,
      diaCorte: esTarjeta ? valor.diaCorte : null,
      diaPago: esTarjeta ? valor.diaPago : null,
      pagoMinimo: esTarjeta ? valor.pagoMinimo : null,
      pagoSinIntereses: esTarjeta ? valor.pagoSinIntereses : null,
      activo: enEdicion?.activo ?? true,
    };

    const esEdicion = enEdicion !== null;
    const peticion = esEdicion
      ? this.data.modificacion<CuentaPresupuesto>('CuentaPresupuesto', payload)
      : this.data.alta<CuentaPresupuesto>('CuentaPresupuesto', payload);

    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? 'Cuenta actualizada.' : 'Cuenta creada.');
        this.modalAbierto.set(false);
        this.cargar();
      },
    });
  }

  pedirEliminar(cuenta: CuentaPresupuesto): void {
    this.cuentaAEliminar.set(cuenta);
  }

  confirmarEliminar(): void {
    const cuenta = this.cuentaAEliminar();
    if (!cuenta) return;

    this.data.baja('CuentaPresupuesto', cuenta.id).subscribe({
      next: () => {
        this.toast.exito('Cuenta eliminada.');
        this.cuentaAEliminar.set(null);
        this.cargar();
      },
    });
  }
}

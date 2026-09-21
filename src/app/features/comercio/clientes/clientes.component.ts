import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DataClientService } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { Cliente } from './cliente.model';

@Component({
  selector: 'app-clientes',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent],
  templateUrl: './clientes.component.html',
  styleUrl: './clientes.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClientesComponent implements OnInit {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly clientes = signal<Cliente[]>([]);
  protected readonly cargando = signal(false);
  protected readonly busqueda = signal('');

  protected readonly modalAbierto = signal(false);
  protected readonly clienteEnEdicion = signal<Cliente | null>(null);
  protected readonly clienteAEliminar = signal<Cliente | null>(null);

  protected readonly columnas: ColumnaTabla<Cliente>[] = [
    { campo: 'nombre', etiqueta: 'Nombre' },
    { campo: 'telefono', etiqueta: 'Teléfono' },
    { campo: 'email', etiqueta: 'Email' },
  ];

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    nombre: ['', Validators.required],
    telefono: [''],
    email: ['', Validators.email],
    direccion: [''],
  });

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.data.list<Cliente>('Cliente', { nombre: this.busqueda() || undefined }).subscribe({
      next: (clientes) => {
        this.clientes.set(clientes);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  nuevo(): void {
    this.clienteEnEdicion.set(null);
    this.form.reset({ id: 0, nombre: '', telefono: '', email: '', direccion: '' });
    this.modalAbierto.set(true);
  }

  editar(cliente: Cliente): void {
    this.clienteEnEdicion.set(cliente);
    this.form.reset({
      id: cliente.id,
      nombre: cliente.nombre,
      telefono: cliente.telefono ?? '',
      email: cliente.email ?? '',
      direccion: cliente.direccion ?? '',
    });
    this.modalAbierto.set(true);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const valor = this.form.getRawValue();
    const payload = {
      id: valor.id,
      nombre: valor.nombre,
      telefono: valor.telefono || null,
      email: valor.email || null,
      direccion: valor.direccion || null,
      activo: true,
    };

    const esEdicion = this.clienteEnEdicion() !== null;
    const peticion = esEdicion
      ? this.data.modificacion<Cliente>('Cliente', payload)
      : this.data.alta<Cliente>('Cliente', payload);

    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? 'Cliente actualizado.' : 'Cliente creado.');
        this.modalAbierto.set(false);
        this.cargar();
      },
    });
  }

  pedirEliminar(cliente: Cliente): void {
    this.clienteAEliminar.set(cliente);
  }

  confirmarEliminar(): void {
    const cliente = this.clienteAEliminar();
    if (!cliente) return;

    this.data.baja('Cliente', cliente.id).subscribe({
      next: () => {
        this.toast.exito('Cliente eliminado.');
        this.clienteAEliminar.set(null);
        this.cargar();
      },
    });
  }
}

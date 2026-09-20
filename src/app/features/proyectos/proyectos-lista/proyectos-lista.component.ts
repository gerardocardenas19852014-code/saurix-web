import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { DataClientService } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { Proyecto } from './proyecto.model';

@Component({
  selector: 'app-proyectos-lista',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent],
  templateUrl: './proyectos-lista.component.html',
  styleUrl: './proyectos-lista.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProyectosListaComponent implements OnInit {
  private readonly data = inject(DataClientService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly proyectos = signal<Proyecto[]>([]);
  protected readonly cargando = signal(false);
  protected readonly busqueda = signal('');

  protected readonly modalAbierto = signal(false);
  protected readonly proyectoEnEdicion = signal<Proyecto | null>(null);
  protected readonly proyectoAEliminar = signal<Proyecto | null>(null);

  protected readonly columnas: ColumnaTabla<Proyecto>[] = [
    { campo: 'clave', etiqueta: 'Clave' },
    { campo: 'nombre', etiqueta: 'Nombre' },
  ];

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    nombre: ['', Validators.required],
    clave: ['', [Validators.required, Validators.maxLength(6)]],
    codigoHex: ['#4f8cff', Validators.required],
  });

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.data.list<Proyecto>('Proyecto', { nombre: this.busqueda() || undefined }).subscribe({
      next: (proyectos) => {
        this.proyectos.set(proyectos);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  nuevo(): void {
    this.proyectoEnEdicion.set(null);
    this.form.reset({ id: 0, nombre: '', clave: '', codigoHex: '#4f8cff' });
    this.modalAbierto.set(true);
  }

  editar(proyecto: Proyecto): void {
    this.proyectoEnEdicion.set(proyecto);
    this.form.reset({
      id: proyecto.id,
      nombre: proyecto.nombre,
      clave: proyecto.clave,
      codigoHex: proyecto.codigoHex,
    });
    this.modalAbierto.set(true);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const valor = this.form.getRawValue();
    const payload = { ...valor, clave: valor.clave.toUpperCase() };
    const esEdicion = this.proyectoEnEdicion() !== null;
    const peticion = esEdicion
      ? this.data.modificacion<Proyecto>('Proyecto', payload)
      : this.data.alta<Proyecto>('Proyecto', payload);

    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? 'Proyecto actualizado.' : 'Proyecto creado.');
        this.modalAbierto.set(false);
        this.cargar();
      },
    });
  }

  pedirEliminar(proyecto: Proyecto): void {
    this.proyectoAEliminar.set(proyecto);
  }

  confirmarEliminar(): void {
    const proyecto = this.proyectoAEliminar();
    if (!proyecto) return;

    this.data.baja('Proyecto', proyecto.id).subscribe({
      next: () => {
        this.toast.exito('Proyecto eliminado.');
        this.proyectoAEliminar.set(null);
        this.cargar();
      },
    });
  }
}

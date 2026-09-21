import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { forkJoin } from 'rxjs';
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
  protected readonly toast = inject(ToastService);
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

    // Ticket.numeroTicket se arma con Proyecto.clave como prefijo (folioSugerido() en
    // KanbanComponent) — dos proyectos con la misma clave pueden terminar generando el
    // mismo folio de ticket sin que nadie lo note.
    const claveDuplicada = this.proyectos().some(
      (p) => p.clave.toUpperCase() === payload.clave && Number(p.id) !== Number(payload.id),
    );
    if (claveDuplicada) {
      this.toast.advertencia(`Ya existe un proyecto con la clave "${payload.clave}".`);
      return;
    }

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
    // IndexedDB no valida integridad referencial: si se borra un Proyecto con
    // columnas o tickets propios, esos registros quedan huérfanos (el proyecto
    // ya no aparece en ningún selector, así que ni siquiera se podrían volver
    // a ver). Se bloquea el borrado en vez de intentar cascadear un árbol tan
    // grande (tickets → actividades/historial/comentarios/etc.) sin que el
    // usuario lo pida explícitamente ticket por ticket.
    forkJoin([
      this.data.list<{ id: number }>('Ticket', { proyectoId: proyecto.id }),
      this.data.list<{ id: number }>('TableroColumna', { proyectoId: proyecto.id }),
    ]).subscribe(([tickets, columnas]) => {
      if (tickets.length > 0) {
        this.toast.advertencia(
          `No se puede eliminar: el proyecto tiene ${tickets.length} ticket${tickets.length === 1 ? '' : 's'}. Elimínalos primero.`,
        );
        return;
      }
      if (columnas.length > 0) {
        this.toast.advertencia(
          `No se puede eliminar: el proyecto tiene ${columnas.length} columna${columnas.length === 1 ? '' : 's'} configurada${columnas.length === 1 ? '' : 's'} en su tablero. Elimínalas primero en Gestor de Estados.`,
        );
        return;
      }
      this.proyectoAEliminar.set(proyecto);
    });
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

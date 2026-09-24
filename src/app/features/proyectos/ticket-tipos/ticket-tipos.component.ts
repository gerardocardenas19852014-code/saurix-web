import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { DataClientService } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { TicketTipo } from './ticket-tipo.model';

@Component({
  selector: 'app-ticket-tipos',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent],
  templateUrl: './ticket-tipos.component.html',
  styleUrl: './ticket-tipos.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TicketTiposComponent implements OnInit {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly tipos = signal<TicketTipo[]>([]);
  protected readonly cargando = signal(false);
  protected readonly busqueda = signal('');
  /** false por defecto: los tipos desactivados se ocultan de la lista (y de los
   *  combos de selección al crear/editar un ticket) salvo que se marque esta
   *  casilla — alternativa al borrado duro (que ya se bloquea si algún ticket lo usa). */
  protected readonly mostrarInactivos = signal(false);
  protected readonly tiposFiltrados = computed(() =>
    this.tipos().filter((t) => this.mostrarInactivos() || t.activo !== false),
  );

  protected readonly modalAbierto = signal(false);
  protected readonly tipoEnEdicion = signal<TicketTipo | null>(null);
  protected readonly tipoAEliminar = signal<TicketTipo | null>(null);

  protected readonly columnas: ColumnaTabla<TicketTipo>[] = [
    { campo: 'clave', etiqueta: 'Clave' },
    { campo: 'nombre', etiqueta: 'Nombre' },
    { campo: 'icono', etiqueta: 'Icono' },
    {
      campo: 'activo',
      etiqueta: 'Activo',
      formatear: (fila) => (fila.activo !== false ? 'Sí' : 'No'),
      claseValor: (fila) => (fila.activo !== false ? 'grid-badge-success' : 'grid-badge-muted'),
    },
  ];

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    nombre: ['', Validators.required],
    clave: ['', Validators.required],
    icono: [''],
    activo: [true],
  });

  /** Emojis sugeridos para no dejar la elección del ícono a adivinar un nombre o código. */
  protected readonly iconosSugeridos: string[] = [
    '🐛', '✨', '🔧', '📋', '❓', '⚠️', '🚀', '🔔', '✅', '🧩', '📌', '🛠️',
  ];

  elegirIcono(icono: string): void {
    this.form.controls.icono.setValue(icono);
  }

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.data.list<TicketTipo>('TicketTipo', { nombre: this.busqueda() || undefined }).subscribe({
      next: (tipos) => {
        this.tipos.set(tipos);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  nuevo(): void {
    this.tipoEnEdicion.set(null);
    this.form.reset({ id: 0, nombre: '', clave: '', icono: '', activo: true });
    this.modalAbierto.set(true);
  }

  editar(tipo: TicketTipo): void {
    this.tipoEnEdicion.set(tipo);
    this.form.reset({
      id: tipo.id,
      nombre: tipo.nombre,
      clave: tipo.clave,
      icono: tipo.icono ?? '',
      activo: tipo.activo !== false,
    });
    this.modalAbierto.set(true);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const valor = this.form.getRawValue();
    const payload = { ...valor, icono: valor.icono || null };
    const esEdicion = this.tipoEnEdicion() !== null;
    const peticion = esEdicion
      ? this.data.modificacion<TicketTipo>('TicketTipo', payload)
      : this.data.alta<TicketTipo>('TicketTipo', payload);

    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? 'Tipo actualizado.' : 'Tipo creado.');
        this.modalAbierto.set(false);
        this.cargar();
      },
    });
  }

  pedirEliminar(tipo: TicketTipo): void {
    // Si se borra un Tipo que algún ticket todavía usa, ese ticket se queda con un
    // ticketTipoId que ya no existe en ningún catálogo — nombreTipo() no lo encuentra
    // y el ticket pierde su tipo silenciosamente en todas las vistas (tablero, dashboard, CSV).
    this.data.list<{ id: number }>('Ticket', { ticketTipoId: tipo.id }).subscribe((tickets) => {
      if (tickets.length > 0) {
        this.toast.advertencia(
          `No se puede eliminar: ${tickets.length} ticket${tickets.length === 1 ? '' : 's'} usa${tickets.length === 1 ? '' : 'n'} este tipo.`,
        );
        return;
      }
      this.tipoAEliminar.set(tipo);
    });
  }

  confirmarEliminar(): void {
    const tipo = this.tipoAEliminar();
    if (!tipo) return;

    this.data.baja('TicketTipo', tipo.id).subscribe({
      next: () => {
        this.toast.exito('Tipo eliminado.');
        this.tipoAEliminar.set(null);
        this.cargar();
      },
    });
  }
}

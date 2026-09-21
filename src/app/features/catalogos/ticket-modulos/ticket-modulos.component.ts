import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { DataClientService } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { TicketModulo } from '../../proyectos/ticket-modulos/ticket-modulo.model';

/**
 * Catálogo "Módulo" (Gestión de Proyectos): mismo patrón exacto que
 * TicketTiposComponent (ver ticket-tipos.component.ts) — se mantiene como
 * catálogo aparte, no como grupo de "Listas de valores", porque alimenta un
 * combobox propio en el detalle del ticket (ver kanban.component.ts).
 */
@Component({
  selector: 'app-ticket-modulos',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent],
  templateUrl: './ticket-modulos.component.html',
  styleUrl: './ticket-modulos.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TicketModulosComponent implements OnInit {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly modulos = signal<TicketModulo[]>([]);
  protected readonly cargando = signal(false);
  protected readonly busqueda = signal('');
  /** false por defecto: los módulos desactivados se ocultan de la lista (y de los
   *  combos de selección al crear/editar un ticket) salvo que se marque esta
   *  casilla — alternativa al borrado duro (que ya se bloquea si algún ticket lo usa). */
  protected readonly mostrarInactivos = signal(false);
  protected readonly modulosFiltrados = computed(() =>
    this.modulos().filter((m) => this.mostrarInactivos() || m.activo !== false),
  );

  protected readonly modalAbierto = signal(false);
  protected readonly moduloEnEdicion = signal<TicketModulo | null>(null);
  protected readonly moduloAEliminar = signal<TicketModulo | null>(null);

  protected readonly columnas: ColumnaTabla<TicketModulo>[] = [
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

  /** Emojis sugeridos pensando en áreas/módulos típicos de un sistema. */
  protected readonly iconosSugeridos: string[] = [
    '💻', '🖥️', '🗄️', '☁️', '📊', '🔐', '🧩', '📱', '🌐', '⚙️', '🔌', '🧾',
  ];

  elegirIcono(icono: string): void {
    this.form.controls.icono.setValue(icono);
  }

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.data.list<TicketModulo>('TicketModulo', { nombre: this.busqueda() || undefined }).subscribe({
      next: (modulos) => {
        this.modulos.set(modulos);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  nuevo(): void {
    this.moduloEnEdicion.set(null);
    this.form.reset({ id: 0, nombre: '', clave: '', icono: '', activo: true });
    this.modalAbierto.set(true);
  }

  editar(modulo: TicketModulo): void {
    this.moduloEnEdicion.set(modulo);
    this.form.reset({
      id: modulo.id,
      nombre: modulo.nombre,
      clave: modulo.clave,
      icono: modulo.icono ?? '',
      activo: modulo.activo !== false,
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
    const esEdicion = this.moduloEnEdicion() !== null;
    const peticion = esEdicion
      ? this.data.modificacion<TicketModulo>('TicketModulo', payload)
      : this.data.alta<TicketModulo>('TicketModulo', payload);

    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? 'Módulo actualizado.' : 'Módulo creado.');
        this.modalAbierto.set(false);
        this.cargar();
      },
    });
  }

  pedirEliminar(modulo: TicketModulo): void {
    // Igual que TicketTipo: si se borra un Módulo que algún ticket todavía usa,
    // ese ticket se queda con un ticketModuloId huérfano y pierde su módulo
    // silenciosamente en todas las vistas.
    this.data.list<{ id: number }>('Ticket', { ticketModuloId: modulo.id }).subscribe((tickets) => {
      if (tickets.length > 0) {
        this.toast.advertencia(
          `No se puede eliminar: ${tickets.length} ticket${tickets.length === 1 ? '' : 's'} usa${tickets.length === 1 ? '' : 'n'} este módulo.`,
        );
        return;
      }
      this.moduloAEliminar.set(modulo);
    });
  }

  confirmarEliminar(): void {
    const modulo = this.moduloAEliminar();
    if (!modulo) return;

    this.data.baja('TicketModulo', modulo.id).subscribe({
      next: () => {
        this.toast.exito('Módulo eliminado.');
        this.moduloAEliminar.set(null);
        this.cargar();
      },
    });
  }
}

import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DataClientService } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { ClienteFormModalComponent } from './cliente-form-modal.component';
import { ClienteService } from './cliente.service';
import { Cliente } from './cliente.model';

/** Catálogo de clientes de Ventas — mismo patrón de catálogo CRUD que
 *  ProveedoresComponent, salvo que el formulario vive aparte
 *  (ClienteFormModalComponent, ver ese archivo) porque Cobro también lo usa.
 *  El contacto "Público en General" (esGenerico) se siembra solo la primera
 *  vez que se entra aquí (o a Cobro) y no se puede eliminar. */
@Component({
  selector: 'app-clientes',
  standalone: true,
  imports: [DataTableComponent, ConfirmDialogComponent, ClienteFormModalComponent],
  templateUrl: './clientes.component.html',
  styleUrl: './clientes.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClientesComponent implements OnInit, OnDestroy {
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);
  private readonly clienteService = inject(ClienteService);

  protected readonly clientes = signal<Cliente[]>([]);
  protected readonly cargando = signal(false);
  protected readonly busqueda = signal('');
  protected readonly mostrarInactivos = signal(false);
  protected readonly clientesFiltrados = computed(() => {
    const texto = this.busqueda().trim().toLowerCase();
    return this.clientes()
      .filter((c) => this.mostrarInactivos() || c.activo !== false)
      .filter((c) => !texto || c.nombre.toLowerCase().includes(texto) || c.rfc.toLowerCase().includes(texto));
  });

  protected readonly modalAbierto = signal(false);
  protected readonly clienteEnEdicion = signal<Cliente | null>(null);
  protected readonly clienteAEliminar = signal<Cliente | null>(null);

  protected readonly columnas: ColumnaTabla<Cliente>[] = [
    { campo: 'nombre', etiqueta: 'Nombre / Razón social' },
    { campo: 'rfc', etiqueta: 'RFC' },
    { campo: 'correo', etiqueta: 'Correo', formatear: (fila) => fila.correo ?? '—' },
    { campo: 'telefono', etiqueta: 'Teléfono', formatear: (fila) => fila.telefono ?? '—' },
    {
      campo: 'esGenerico',
      etiqueta: 'Tipo',
      formatear: (fila) => (fila.esGenerico ? 'Genérico' : 'Cliente'),
      claseValor: (fila) => (fila.esGenerico ? 'grid-badge-warning' : 'grid-badge-muted'),
    },
    {
      campo: 'activo',
      etiqueta: 'Activo',
      formatear: (fila) => (fila.activo !== false ? 'Sí' : 'No'),
      claseValor: (fila) => (fila.activo !== false ? 'grid-badge-success' : 'grid-badge-muted'),
    },
  ];

  async ngOnInit(): Promise<void> {
    document.documentElement.setAttribute('data-wide', 'grid');
    await this.clienteService.obtenerOCrearGenerico(); // asegura que el genérico ya exista
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.data.list<Cliente>('Cliente').subscribe({
      next: (clientes) => {
        this.clientes.set(clientes);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  nuevo(): void {
    this.clienteEnEdicion.set(null);
    this.modalAbierto.set(true);
  }

  editar(cliente: Cliente): void {
    this.clienteEnEdicion.set(cliente);
    this.modalAbierto.set(true);
  }

  alGuardar(): void {
    this.modalAbierto.set(false);
    this.cargar();
  }

  pedirEliminar(cliente: Cliente): void {
    if (cliente.esGenerico) {
      this.toast.advertencia('El contacto "Público en General" no se puede eliminar.');
      return;
    }
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

import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { DataClientService } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { UnidadMedida } from './unidad-medida.model';

/** Catálogo "Unidad de medida" (Inventario) — mismo patrón exacto que
 *  TicketTiposComponent de Gestión de Proyectos (ver ticket-tipos.component.ts). */
@Component({
  selector: 'app-unidades-medida',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent],
  templateUrl: './unidades-medida.component.html',
  styleUrl: './unidades-medida.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UnidadesMedidaComponent implements OnInit, OnDestroy {
  // Pantalla a ancho completo (html[data-wide='grid'] en styles.scss).
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);
  private readonly fb = inject(FormBuilder);

  protected readonly unidades = signal<UnidadMedida[]>([]);
  protected readonly cargando = signal(false);
  protected readonly busqueda = signal('');
  protected readonly mostrarInactivos = signal(false);
  protected readonly unidadesFiltradas = computed(() =>
    this.unidades().filter((u) => this.mostrarInactivos() || u.activo !== false),
  );

  protected readonly modalAbierto = signal(false);
  protected readonly unidadEnEdicion = signal<UnidadMedida | null>(null);
  protected readonly unidadAEliminar = signal<UnidadMedida | null>(null);

  protected readonly columnas: ColumnaTabla<UnidadMedida>[] = [
    { campo: 'clave', etiqueta: 'Clave' },
    { campo: 'nombre', etiqueta: 'Nombre' },
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
    activo: [true],
  });

  ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid'); // ancho completo
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.data.list<UnidadMedida>('UnidadMedida', { nombre: this.busqueda() || undefined }).subscribe({
      next: (unidades) => {
        this.unidades.set(unidades);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  nuevo(): void {
    this.unidadEnEdicion.set(null);
    this.form.reset({ id: 0, nombre: '', clave: '', activo: true });
    this.modalAbierto.set(true);
  }

  editar(unidad: UnidadMedida): void {
    this.unidadEnEdicion.set(unidad);
    this.form.reset({
      id: unidad.id,
      nombre: unidad.nombre,
      clave: unidad.clave,
      activo: unidad.activo !== false,
    });
    this.modalAbierto.set(true);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const valor = this.form.getRawValue();
    const esEdicion = this.unidadEnEdicion() !== null;
    const peticion = esEdicion
      ? this.data.modificacion<UnidadMedida>('UnidadMedida', valor)
      : this.data.alta<UnidadMedida>('UnidadMedida', valor);

    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? 'Unidad actualizada.' : 'Unidad creada.');
        this.modalAbierto.set(false);
        this.cargar();
      },
    });
  }

  pedirEliminar(unidad: UnidadMedida): void {
    // Si se borra una Unidad que algún producto todavía usa, ese producto se
    // queda con un unidadMedidaId huérfano y pierde su unidad silenciosamente
    // en todas las vistas (lista, importación, etc.).
    this.data.list<{ id: number }>('Producto', { unidadMedidaId: unidad.id }).subscribe((productos) => {
      if (productos.length > 0) {
        this.toast.advertencia(
          `No se puede eliminar: ${productos.length} producto${productos.length === 1 ? '' : 's'} usa${productos.length === 1 ? '' : 'n'} esta unidad.`,
        );
        return;
      }
      this.unidadAEliminar.set(unidad);
    });
  }

  confirmarEliminar(): void {
    const unidad = this.unidadAEliminar();
    if (!unidad) return;

    this.data.baja('UnidadMedida', unidad.id).subscribe({
      next: () => {
        this.toast.exito('Unidad eliminada.');
        this.unidadAEliminar.set(null);
        this.cargar();
      },
    });
  }
}

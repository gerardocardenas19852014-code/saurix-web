import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { DataClientService } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { CategoriaProducto } from './categoria-producto.model';

/** Catálogo "Categoría de producto" (Inventario) — mismo patrón exacto que
 *  TicketTiposComponent de Gestión de Proyectos (ver ticket-tipos.component.ts). */
@Component({
  selector: 'app-categorias-producto',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent],
  templateUrl: './categorias-producto.component.html',
  styleUrl: './categorias-producto.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategoriasProductoComponent implements OnInit, OnDestroy {
  // Pantalla a ancho completo (html[data-wide='grid'] en styles.scss).
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly categorias = signal<CategoriaProducto[]>([]);
  protected readonly cargando = signal(false);
  protected readonly busqueda = signal('');
  protected readonly mostrarInactivos = signal(false);
  protected readonly categoriasFiltradas = computed(() =>
    this.categorias().filter((c) => this.mostrarInactivos() || c.activo !== false),
  );

  protected readonly modalAbierto = signal(false);
  protected readonly categoriaEnEdicion = signal<CategoriaProducto | null>(null);
  protected readonly categoriaAEliminar = signal<CategoriaProducto | null>(null);

  protected readonly columnas: ColumnaTabla<CategoriaProducto>[] = [
    { campo: 'clave', etiqueta: 'Clave' },
    { campo: 'nombre', etiqueta: 'Nombre' },
    { campo: 'descripcion', etiqueta: 'Descripción', formatear: (fila) => fila.descripcion ?? '—' },
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
    descripcion: [''],
    activo: [true],
  });

  ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid'); // ancho completo
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.data.list<CategoriaProducto>('CategoriaProducto', { nombre: this.busqueda() || undefined }).subscribe({
      next: (categorias) => {
        this.categorias.set(categorias);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  nuevo(): void {
    this.categoriaEnEdicion.set(null);
    this.form.reset({ id: 0, nombre: '', clave: '', descripcion: '', activo: true });
    this.modalAbierto.set(true);
  }

  editar(categoria: CategoriaProducto): void {
    this.categoriaEnEdicion.set(categoria);
    this.form.reset({
      id: categoria.id,
      nombre: categoria.nombre,
      clave: categoria.clave,
      descripcion: categoria.descripcion ?? '',
      activo: categoria.activo !== false,
    });
    this.modalAbierto.set(true);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const valor = this.form.getRawValue();
    const payload = { ...valor, descripcion: valor.descripcion || null };
    const esEdicion = this.categoriaEnEdicion() !== null;
    const peticion = esEdicion
      ? this.data.modificacion<CategoriaProducto>('CategoriaProducto', payload)
      : this.data.alta<CategoriaProducto>('CategoriaProducto', payload);

    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? 'Categoría actualizada.' : 'Categoría creada.');
        this.modalAbierto.set(false);
        this.cargar();
      },
    });
  }

  pedirEliminar(categoria: CategoriaProducto): void {
    // Si se borra una Categoría que algún producto todavía usa, ese producto se
    // queda con un categoriaProductoId huérfano y pierde su categoría
    // silenciosamente en todas las vistas (lista, importación, etc.).
    this.data.list<{ id: number }>('Producto', { categoriaProductoId: categoria.id }).subscribe((productos) => {
      if (productos.length > 0) {
        this.toast.advertencia(
          `No se puede eliminar: ${productos.length} producto${productos.length === 1 ? '' : 's'} usa${productos.length === 1 ? '' : 'n'} esta categoría.`,
        );
        return;
      }
      this.categoriaAEliminar.set(categoria);
    });
  }

  confirmarEliminar(): void {
    const categoria = this.categoriaAEliminar();
    if (!categoria) return;

    this.data.baja('CategoriaProducto', categoria.id).subscribe({
      next: () => {
        this.toast.exito('Categoría eliminada.');
        this.categoriaAEliminar.set(null);
        this.cargar();
      },
    });
  }
}

import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DataClientService } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { CategoriaProductoOpcion, Producto } from './producto.model';

@Component({
  selector: 'app-productos',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent],
  templateUrl: './productos.component.html',
  styleUrl: './productos.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductosComponent implements OnInit {
  private readonly data = inject(DataClientService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly productos = signal<Producto[]>([]);
  protected readonly categorias = signal<CategoriaProductoOpcion[]>([]);
  protected readonly cargando = signal(false);
  protected readonly busqueda = signal('');

  protected readonly modalAbierto = signal(false);
  protected readonly productoEnEdicion = signal<Producto | null>(null);
  protected readonly productoAEliminar = signal<Producto | null>(null);

  protected readonly columnas: ColumnaTabla<Producto>[] = [
    { campo: 'nombre', etiqueta: 'Nombre' },
    {
      campo: 'categoriaProductoId',
      etiqueta: 'Categoría',
      formatear: (p) => this.nombreCategoria(p.categoriaProductoId),
    },
    { campo: 'precioUnitario', etiqueta: 'Precio', formatear: (p) => `$${p.precioUnitario.toFixed(2)}` },
    {
      campo: 'existencia',
      etiqueta: 'Existencia',
      formatear: (p) => (p.existencia === null ? 'Servicio' : String(p.existencia)),
    },
  ];

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    categoriaProductoId: [0, Validators.required],
    nombre: ['', Validators.required],
    descripcion: [''],
    precioUnitario: [0, Validators.required],
    esServicio: [false],
    existencia: [0],
  });

  get esServicio(): boolean {
    return this.form.controls.esServicio.value;
  }

  ngOnInit(): void {
    this.cargarCategorias();
    this.cargar();
  }

  nombreCategoria(id: number): string {
    return this.categorias().find((c) => c.id === id)?.nombre ?? '—';
  }

  private cargarCategorias(): void {
    this.data.list<CategoriaProductoOpcion>('CategoriaProducto').subscribe({
      next: (categorias) => this.categorias.set(categorias),
    });
  }

  cargar(): void {
    this.cargando.set(true);
    this.data.list<Producto>('Producto', { nombre: this.busqueda() || undefined }).subscribe({
      next: (productos) => {
        this.productos.set(productos);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  nueva(): void {
    this.productoEnEdicion.set(null);
    this.form.reset({ id: 0, categoriaProductoId: 0, nombre: '', descripcion: '', precioUnitario: 0, esServicio: false, existencia: 0 });
    this.modalAbierto.set(true);
  }

  editar(producto: Producto): void {
    this.productoEnEdicion.set(producto);
    this.form.reset({
      id: producto.id,
      categoriaProductoId: producto.categoriaProductoId,
      nombre: producto.nombre,
      descripcion: producto.descripcion ?? '',
      precioUnitario: producto.precioUnitario,
      esServicio: producto.existencia === null,
      existencia: producto.existencia ?? 0,
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
      categoriaProductoId: valor.categoriaProductoId,
      nombre: valor.nombre,
      descripcion: valor.descripcion || null,
      precioUnitario: valor.precioUnitario,
      existencia: valor.esServicio ? null : valor.existencia,
      activo: true,
    };

    const esEdicion = this.productoEnEdicion() !== null;
    const peticion = esEdicion
      ? this.data.modificacion<Producto>('Producto', payload)
      : this.data.alta<Producto>('Producto', payload);

    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? 'Producto actualizado.' : 'Producto creado.');
        this.modalAbierto.set(false);
        this.cargar();
      },
    });
  }

  pedirEliminar(producto: Producto): void {
    this.productoAEliminar.set(producto);
  }

  confirmarEliminar(): void {
    const producto = this.productoAEliminar();
    if (!producto) return;

    this.data.baja('Producto', producto.id).subscribe({
      next: () => {
        this.toast.exito('Producto eliminado.');
        this.productoAEliminar.set(null);
        this.cargar();
      },
    });
  }
}

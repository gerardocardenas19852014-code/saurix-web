import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DataClientService } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { CategoriaPresupuesto } from './categoria-presupuesto.model';

/**
 * Categorías de Presupuesto: catálogo compartido con subcategorías a
 * 2 niveles (CategoriaPresupuestoPadreId, regla aplicada por la app,
 * no por la BD). GetList regresa todo en una sola lista (no exige
 * padre, a diferencia de la jerarquía geográfica/documental) — aquí
 * solo se restringe en el <select> que una subcategoría no pueda
 * elegirse como padre de otra.
 */
@Component({
  selector: 'app-categorias-presupuesto',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent],
  templateUrl: './categorias-presupuesto.component.html',
  styleUrl: './categorias-presupuesto.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategoriasPresupuestoComponent implements OnInit {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly categorias = signal<CategoriaPresupuesto[]>([]);
  protected readonly cargando = signal(false);
  protected readonly busqueda = signal('');

  protected readonly categoriasRaiz = computed(() => this.categorias().filter((c) => !c.categoriaPresupuestoPadreId));

  protected readonly modalAbierto = signal(false);
  protected readonly categoriaEnEdicion = signal<CategoriaPresupuesto | null>(null);
  protected readonly categoriaAEliminar = signal<CategoriaPresupuesto | null>(null);

  protected readonly columnas: ColumnaTabla<CategoriaPresupuesto>[] = [
    { campo: 'nombre', etiqueta: 'Nombre' },
    {
      campo: 'categoriaPresupuestoPadreId',
      etiqueta: 'Categoría padre',
      formatear: (fila) => this.nombrePadre(fila.categoriaPresupuestoPadreId),
    },
  ];

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    nombre: ['', Validators.required],
    categoriaPresupuestoPadreId: [0],
  });

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.data.list<CategoriaPresupuesto>('CategoriaPresupuesto', { nombre: this.busqueda() || undefined }).subscribe({
      next: (categorias) => {
        this.categorias.set(categorias);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  nombrePadre(id: number | null): string {
    if (!id) return '—';
    return this.categorias().find((c) => c.id === id)?.nombre ?? '—';
  }

  nueva(): void {
    this.categoriaEnEdicion.set(null);
    this.form.reset({ id: 0, nombre: '', categoriaPresupuestoPadreId: 0 });
    this.modalAbierto.set(true);
  }

  editar(categoria: CategoriaPresupuesto): void {
    this.categoriaEnEdicion.set(categoria);
    this.form.reset({
      id: categoria.id,
      nombre: categoria.nombre,
      categoriaPresupuestoPadreId: categoria.categoriaPresupuestoPadreId ?? 0,
    });
    this.modalAbierto.set(true);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const valor = this.form.getRawValue();
    const enEdicion = this.categoriaEnEdicion();
    const payload = {
      ...valor,
      categoriaPresupuestoPadreId: valor.categoriaPresupuestoPadreId || null,
      activo: enEdicion?.activo ?? true,
    };
    const esEdicion = enEdicion !== null;
    const peticion = esEdicion
      ? this.data.modificacion<CategoriaPresupuesto>('CategoriaPresupuesto', payload)
      : this.data.alta<CategoriaPresupuesto>('CategoriaPresupuesto', payload);

    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? 'Categoría actualizada.' : 'Categoría creada.');
        this.modalAbierto.set(false);
        this.cargar();
      },
    });
  }

  pedirEliminar(categoria: CategoriaPresupuesto): void {
    this.categoriaAEliminar.set(categoria);
  }

  confirmarEliminar(): void {
    const categoria = this.categoriaAEliminar();
    if (!categoria) return;

    this.data.baja('CategoriaPresupuesto', categoria.id).subscribe({
      next: () => {
        this.toast.exito('Categoría eliminada.');
        this.categoriaAEliminar.set(null);
        this.cargar();
      },
    });
  }
}

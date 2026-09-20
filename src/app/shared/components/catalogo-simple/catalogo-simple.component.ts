import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DataClientService } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../data-table/data-table.component';
import { ConfirmDialogComponent } from '../confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../services/toast.service';
import { CatalogoSimpleConfig, CatalogoSimpleItem } from './catalogo-simple.model';

/**
 * Ventana genérica para catálogos "planos" (solo id + Nombre + Activo),
 * como Color, TipoCuentaColectiva, TipoLocalidad, TipoSistema, Categoria
 * o Seccion. En vez de duplicar modelo/servicio/componente por cada
 * entidad, cada catálogo se registra como UNA línea de ruta con su
 * `entidad` y títulos vía `data` (ver catalogos.routes.ts) y esta
 * misma ventana resuelve alta/edición/baja/listado a través de
 * `DataClientService` (hoy: IndexedDB; a futuro: los mismos endpoints
 * /api/{entidad}/{Accion} de PlataformaSaurix).
 *
 * Un catálogo con columnas o relaciones adicionales (la jerarquía
 * geográfica, etc.) no debe usar este componente — se construye su
 * propia ventana, como se hizo con Usuarios.
 */
@Component({
  selector: 'app-catalogo-simple',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent],
  templateUrl: './catalogo-simple.component.html',
  styleUrl: './catalogo-simple.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatalogoSimpleComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly data = inject(DataClientService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected config!: CatalogoSimpleConfig;

  protected readonly items = signal<CatalogoSimpleItem[]>([]);
  protected readonly cargando = signal(false);
  protected readonly busqueda = signal('');

  protected readonly modalAbierto = signal(false);
  protected readonly itemEnEdicion = signal<CatalogoSimpleItem | null>(null);
  protected readonly itemAEliminar = signal<CatalogoSimpleItem | null>(null);

  protected readonly columnas: ColumnaTabla<CatalogoSimpleItem>[] = [
    { campo: 'nombre', etiqueta: 'Nombre' },
    { campo: 'activo', etiqueta: 'Activo', formatear: (fila) => (fila.activo ? 'Sí' : 'No') },
  ];

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    nombre: ['', Validators.required],
  });

  ngOnInit(): void {
    this.config = this.route.snapshot.data['config'] as CatalogoSimpleConfig;
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.data.list<CatalogoSimpleItem>(this.config.entidad, { nombre: this.busqueda() || undefined }).subscribe({
      next: (items) => {
        this.items.set(items);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  nuevo(): void {
    this.itemEnEdicion.set(null);
    this.form.reset({ id: 0, nombre: '' });
    this.modalAbierto.set(true);
  }

  editar(item: CatalogoSimpleItem): void {
    this.itemEnEdicion.set(item);
    this.form.reset({ id: item.id, nombre: item.nombre });
    this.modalAbierto.set(true);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const valor = this.form.getRawValue();
    const enEdicion = this.itemEnEdicion();
    const esEdicion = enEdicion !== null;
    const peticion = esEdicion
      ? this.data.modificacion<CatalogoSimpleItem>(this.config.entidad, { ...valor, activo: enEdicion.activo })
      : this.data.alta<CatalogoSimpleItem>(this.config.entidad, { ...valor, activo: true });

    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? `${this.config.tituloSingular} actualizado.` : `${this.config.tituloSingular} creado.`);
        this.modalAbierto.set(false);
        this.cargar();
      },
    });
  }

  pedirEliminar(item: CatalogoSimpleItem): void {
    this.itemAEliminar.set(item);
  }

  confirmarEliminar(): void {
    const item = this.itemAEliminar();
    if (!item) return;

    this.data.baja(this.config.entidad, item.id).subscribe({
      next: () => {
        this.toast.exito(`${this.config.tituloSingular} eliminado.`);
        this.itemAEliminar.set(null);
        this.cargar();
      },
    });
  }
}

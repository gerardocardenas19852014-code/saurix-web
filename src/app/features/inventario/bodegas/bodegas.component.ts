import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { DataClientService } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { Bodega } from './bodega.model';

/** Catálogo "Bodega" (Inventario) — mismo patrón exacto que TicketTiposComponent
 *  de Gestión de Proyectos (ver ticket-tipos.component.ts). */
@Component({
  selector: 'app-bodegas',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent],
  templateUrl: './bodegas.component.html',
  styleUrl: './bodegas.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BodegasComponent implements OnInit, OnDestroy {
  // Pantalla a ancho completo (html[data-wide='grid'] en styles.scss).
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);
  private readonly fb = inject(FormBuilder);

  protected readonly bodegas = signal<Bodega[]>([]);
  protected readonly cargando = signal(false);
  protected readonly busqueda = signal('');
  protected readonly mostrarInactivos = signal(false);
  protected readonly bodegasFiltradas = computed(() =>
    this.bodegas().filter((b) => this.mostrarInactivos() || b.activo !== false),
  );

  protected readonly modalAbierto = signal(false);
  protected readonly bodegaEnEdicion = signal<Bodega | null>(null);
  protected readonly bodegaAEliminar = signal<Bodega | null>(null);

  protected readonly columnas: ColumnaTabla<Bodega>[] = [
    { campo: 'clave', etiqueta: 'Clave' },
    { campo: 'nombre', etiqueta: 'Nombre' },
    { campo: 'direccion', etiqueta: 'Dirección', formatear: (fila) => fila.direccion ?? '—' },
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
    direccion: [''],
    activo: [true],
  });

  ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid'); // ancho completo
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.data.list<Bodega>('Bodega', { nombre: this.busqueda() || undefined }).subscribe({
      next: (bodegas) => {
        this.bodegas.set(bodegas);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  nuevo(): void {
    this.bodegaEnEdicion.set(null);
    this.form.reset({ id: 0, nombre: '', clave: '', direccion: '', activo: true });
    this.modalAbierto.set(true);
  }

  editar(bodega: Bodega): void {
    this.bodegaEnEdicion.set(bodega);
    this.form.reset({
      id: bodega.id,
      nombre: bodega.nombre,
      clave: bodega.clave,
      direccion: bodega.direccion ?? '',
      activo: bodega.activo !== false,
    });
    this.modalAbierto.set(true);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const valor = this.form.getRawValue();
    const payload = { ...valor, direccion: valor.direccion || null };
    const esEdicion = this.bodegaEnEdicion() !== null;
    const peticion = esEdicion
      ? this.data.modificacion<Bodega>('Bodega', payload)
      : this.data.alta<Bodega>('Bodega', payload);

    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? 'Bodega actualizada.' : 'Bodega creada.');
        this.modalAbierto.set(false);
        this.cargar();
      },
    });
  }

  pedirEliminar(bodega: Bodega): void {
    this.bodegaAEliminar.set(bodega);
  }

  confirmarEliminar(): void {
    const bodega = this.bodegaAEliminar();
    if (!bodega) return;

    this.data.baja('Bodega', bodega.id).subscribe({
      next: () => {
        this.toast.exito('Bodega eliminada.');
        this.bodegaAEliminar.set(null);
        this.cargar();
      },
    });
  }
}

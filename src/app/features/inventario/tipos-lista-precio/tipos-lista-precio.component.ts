import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { DataClientService } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { TipoListaPrecio } from './tipo-lista-precio.model';

/** Catálogo "Tipo de lista de precio" (Inventario) — mismo patrón exacto que
 *  TicketTiposComponent de Gestión de Proyectos (ver ticket-tipos.component.ts).
 *  El botón extra "Ver precios" de cada renglón navega a la pantalla de
 *  Listas de Precios (ver lista-precio-detalle.component.ts), donde se le
 *  asigna el precio especial de esa lista a cada producto. */
@Component({
  selector: 'app-tipos-lista-precio',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent],
  templateUrl: './tipos-lista-precio.component.html',
  styleUrl: './tipos-lista-precio.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TiposListaPrecioComponent implements OnInit, OnDestroy {
  // Pantalla a ancho completo (html[data-wide='grid'] en styles.scss).
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);

  protected readonly tipos = signal<TipoListaPrecio[]>([]);
  protected readonly cargando = signal(false);
  protected readonly busqueda = signal('');
  protected readonly mostrarInactivos = signal(false);
  protected readonly tiposFiltrados = computed(() =>
    this.tipos().filter((t) => this.mostrarInactivos() || t.activo !== false),
  );

  protected readonly modalAbierto = signal(false);
  protected readonly tipoEnEdicion = signal<TipoListaPrecio | null>(null);
  protected readonly tipoAEliminar = signal<TipoListaPrecio | null>(null);

  protected readonly columnas: ColumnaTabla<TipoListaPrecio>[] = [
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
    this.data.list<TipoListaPrecio>('TipoListaPrecio', { nombre: this.busqueda() || undefined }).subscribe({
      next: (tipos) => {
        this.tipos.set(tipos);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  nuevo(): void {
    this.tipoEnEdicion.set(null);
    this.form.reset({ id: 0, nombre: '', clave: '', descripcion: '', activo: true });
    this.modalAbierto.set(true);
  }

  editar(tipo: TipoListaPrecio): void {
    this.tipoEnEdicion.set(tipo);
    this.form.reset({
      id: tipo.id,
      nombre: tipo.nombre,
      clave: tipo.clave,
      descripcion: tipo.descripcion ?? '',
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
    const payload = { ...valor, descripcion: valor.descripcion || null };
    const esEdicion = this.tipoEnEdicion() !== null;
    const peticion = esEdicion
      ? this.data.modificacion<TipoListaPrecio>('TipoListaPrecio', payload)
      : this.data.alta<TipoListaPrecio>('TipoListaPrecio', payload);

    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? 'Tipo actualizado.' : 'Tipo creado.');
        this.modalAbierto.set(false);
        this.cargar();
      },
    });
  }

  verPrecios(tipo: TipoListaPrecio): void {
    this.router.navigate(['/inventario/listas-precio', tipo.id]);
  }

  pedirEliminar(tipo: TipoListaPrecio): void {
    this.tipoAEliminar.set(tipo);
  }

  confirmarEliminar(): void {
    const tipo = this.tipoAEliminar();
    if (!tipo) return;

    this.data.baja('TipoListaPrecio', tipo.id).subscribe({
      next: () => {
        this.toast.exito('Tipo eliminado.');
        this.tipoAEliminar.set(null);
        this.cargar();
      },
    });
  }
}

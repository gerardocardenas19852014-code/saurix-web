import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { DataClientService } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { RegimenFiscal, REGIMENES_FISCALES_SEMILLA } from './regimen-fiscal.model';

/** Catálogo "Regímenes fiscales" (Ventas / Administración) — mismo patrón
 *  exacto que TiposListaPrecioComponent (ver tipos-lista-precio.component.ts
 *  en Inventario). La primera vez que se entra, si la tabla está vacía, se
 *  siembra con REGIMENES_FISCALES_SEMILLA para no partir de un catálogo en
 *  blanco; de ahí en adelante es 100% editable desde aquí (antes era un
 *  arreglo fijo en código, ver cliente.model.ts). */
@Component({
  selector: 'app-regimenes-fiscales',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent],
  templateUrl: './regimenes-fiscales.component.html',
  styleUrl: './regimenes-fiscales.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RegimenesFiscalesComponent implements OnInit, OnDestroy {
  // Pantalla a ancho completo (html[data-wide='grid'] en styles.scss).
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);
  private readonly fb = inject(FormBuilder);

  protected readonly regimenes = signal<RegimenFiscal[]>([]);
  protected readonly cargando = signal(false);
  protected readonly busqueda = signal('');
  protected readonly mostrarInactivos = signal(false);
  protected readonly regimenesFiltrados = computed(() =>
    this.regimenes().filter((r) => this.mostrarInactivos() || r.activo !== false),
  );

  protected readonly modalAbierto = signal(false);
  protected readonly regimenEnEdicion = signal<RegimenFiscal | null>(null);
  protected readonly regimenAEliminar = signal<RegimenFiscal | null>(null);

  protected readonly columnas: ColumnaTabla<RegimenFiscal>[] = [
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
    clave: ['', Validators.required],
    nombre: ['', Validators.required],
    activo: [true],
  });

  ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid'); // ancho completo
    this.cargar();
  }

  private cargar(): void {
    this.cargando.set(true);
    this.data.list<RegimenFiscal>('RegimenFiscal', { nombre: this.busqueda() || undefined }).subscribe({
      next: (regimenes) => {
        if (regimenes.length === 0 && !this.busqueda()) {
          this.sembrar();
          return;
        }
        this.regimenes.set(regimenes);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  /** Alta automática de la semilla, solo la primera vez (tabla vacía) —
   *  después de sembrar, vuelve a cargar para traer los registros con su id. */
  private sembrar(): void {
    const altas = REGIMENES_FISCALES_SEMILLA.map((r) =>
      this.data.alta<RegimenFiscal>('RegimenFiscal', { clave: r.clave, nombre: r.nombre, activo: true }),
    );
    let pendientes = altas.length;
    altas.forEach((peticion) =>
      peticion.subscribe({
        next: () => {
          pendientes -= 1;
          if (pendientes === 0) this.cargar();
        },
        error: () => {
          pendientes -= 1;
          if (pendientes === 0) this.cargar();
        },
      }),
    );
  }

  recargar(): void {
    this.cargar();
  }

  nuevo(): void {
    this.regimenEnEdicion.set(null);
    this.form.reset({ id: 0, clave: '', nombre: '', activo: true });
    this.modalAbierto.set(true);
  }

  editar(regimen: RegimenFiscal): void {
    this.regimenEnEdicion.set(regimen);
    this.form.reset({ id: regimen.id, clave: regimen.clave, nombre: regimen.nombre, activo: regimen.activo !== false });
    this.modalAbierto.set(true);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const valor = this.form.getRawValue();
    const esEdicion = this.regimenEnEdicion() !== null;
    const peticion = esEdicion
      ? this.data.modificacion<RegimenFiscal>('RegimenFiscal', valor)
      : this.data.alta<RegimenFiscal>('RegimenFiscal', valor);

    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? 'Régimen actualizado.' : 'Régimen creado.');
        this.modalAbierto.set(false);
        this.cargar();
      },
    });
  }

  pedirEliminar(regimen: RegimenFiscal): void {
    this.regimenAEliminar.set(regimen);
  }

  confirmarEliminar(): void {
    const regimen = this.regimenAEliminar();
    if (!regimen) return;

    this.data.baja('RegimenFiscal', regimen.id).subscribe({
      next: () => {
        this.toast.exito('Régimen eliminado.');
        this.regimenAEliminar.set(null);
        this.cargar();
      },
    });
  }
}

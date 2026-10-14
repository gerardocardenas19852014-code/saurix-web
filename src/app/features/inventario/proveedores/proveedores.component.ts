import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { DataClientService } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { Proveedor } from './proveedor.model';

/** Catálogo "Proveedor" (Inventario) — mismo patrón exacto que BodegasComponent
 *  (ver bodegas.component.ts). */
@Component({
  selector: 'app-proveedores',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent],
  templateUrl: './proveedores.component.html',
  styleUrl: './proveedores.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProveedoresComponent implements OnInit, OnDestroy {
  // Pantalla a ancho completo (html[data-wide='grid'] en styles.scss).
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);
  private readonly fb = inject(FormBuilder);

  protected readonly proveedores = signal<Proveedor[]>([]);
  protected readonly cargando = signal(false);
  protected readonly busqueda = signal('');
  protected readonly mostrarInactivos = signal(false);
  protected readonly proveedoresFiltrados = computed(() =>
    this.proveedores().filter((p) => this.mostrarInactivos() || p.activo !== false),
  );

  protected readonly modalAbierto = signal(false);
  protected readonly proveedorEnEdicion = signal<Proveedor | null>(null);
  protected readonly proveedorAEliminar = signal<Proveedor | null>(null);

  protected readonly columnas: ColumnaTabla<Proveedor>[] = [
    { campo: 'nombre', etiqueta: 'Nombre' },
    { campo: 'contacto', etiqueta: 'Contacto', formatear: (fila) => fila.contacto ?? '—' },
    { campo: 'telefono', etiqueta: 'Teléfono', formatear: (fila) => fila.telefono ?? '—' },
    { campo: 'correo', etiqueta: 'Correo', formatear: (fila) => fila.correo ?? '—' },
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
    contacto: [''],
    telefono: [''],
    correo: ['', Validators.email],
    activo: [true],
  });

  ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid'); // ancho completo
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.data.list<Proveedor>('Proveedor', { nombre: this.busqueda() || undefined }).subscribe({
      next: (proveedores) => {
        this.proveedores.set(proveedores);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  nuevo(): void {
    this.proveedorEnEdicion.set(null);
    this.form.reset({ id: 0, nombre: '', contacto: '', telefono: '', correo: '', activo: true });
    this.modalAbierto.set(true);
  }

  editar(proveedor: Proveedor): void {
    this.proveedorEnEdicion.set(proveedor);
    this.form.reset({
      id: proveedor.id,
      nombre: proveedor.nombre,
      contacto: proveedor.contacto ?? '',
      telefono: proveedor.telefono ?? '',
      correo: proveedor.correo ?? '',
      activo: proveedor.activo !== false,
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
      ...valor,
      contacto: valor.contacto || null,
      telefono: valor.telefono || null,
      correo: valor.correo || null,
    };
    const esEdicion = this.proveedorEnEdicion() !== null;
    const peticion = esEdicion
      ? this.data.modificacion<Proveedor>('Proveedor', payload)
      : this.data.alta<Proveedor>('Proveedor', payload);

    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? 'Proveedor actualizado.' : 'Proveedor creado.');
        this.modalAbierto.set(false);
        this.cargar();
      },
    });
  }

  pedirEliminar(proveedor: Proveedor): void {
    this.proveedorAEliminar.set(proveedor);
  }

  confirmarEliminar(): void {
    const proveedor = this.proveedorAEliminar();
    if (!proveedor) return;

    this.data.baja('Proveedor', proveedor.id).subscribe({
      next: () => {
        this.toast.exito('Proveedor eliminado.');
        this.proveedorAEliminar.set(null);
        this.cargar();
      },
    });
  }
}

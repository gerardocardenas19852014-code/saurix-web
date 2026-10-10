import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DataClientService } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { ValorLista } from '../../../shared/valor-lista/valor-lista.model';
import { obtenerOSembrarValorLista } from '../familia.util';
import { ContactoFamiliar, GRUPO_CATEGORIA_CONTACTO, SEMILLA_CATEGORIA_CONTACTO } from '../contacto-familiar.model';

const ENTIDAD = 'ContactoFamiliar';

/**
 * Directorio familiar general — contactos que NO pertenecen a un miembro en
 * particular (médico de cabecera, escuela, veterinario, aseguradora…), a
 * diferencia del directorio de contactos de emergencia que vive dentro de
 * cada ficha (ver miembros.component.ts → pestaña Contacto y seguro).
 * Mismo patrón de lista+búsqueda+modal que Tareas del hogar, pero con
 * app-data-table en vez de una lista a mano, por ser más campos por fila.
 *
 * La categoría es un catálogo ValorLista propio (grupo GRUPO_CATEGORIA_CONTACTO,
 * ver categoria-contacto.component.ts bajo Familia → Catálogos), igual que
 * Parentesco/Tipo de sangre/etc. — se siembra solo la primera vez que se usa
 * (obtenerOSembrarValorLista), así el filtro/combo nunca aparece vacío.
 */
@Component({
  selector: 'app-directorio-familiar',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent],
  templateUrl: './directorio-familiar.component.html',
  styleUrl: './directorio-familiar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DirectorioFamiliarComponent implements OnInit, OnDestroy {
  // Pantalla a ancho completo (html[data-wide='grid'] en styles.scss) — es
  // siempre una tabla, sin vista angosta alterna (mismo criterio que
  // Tareas del hogar/Trámites), así que no hace falta un effect().
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  private readonly data = inject(DataClientService);
  private readonly fb = inject(FormBuilder);
  protected readonly toast = inject(ToastService);

  protected readonly categorias = signal<ValorLista[]>([]);
  protected readonly contactos = signal<ContactoFamiliar[]>([]);
  protected readonly cargando = signal(false);
  protected readonly filtroTexto = signal('');
  protected readonly filtroCategoria = signal('');

  protected readonly contactosFiltrados = computed(() => {
    const texto = this.filtroTexto().trim().toLowerCase();
    const categoria = this.filtroCategoria();
    return this.contactos()
      .filter((c) => c.activo !== false)
      .filter((c) => !categoria || c.categoria === categoria)
      .filter(
        (c) =>
          !texto ||
          c.nombre.toLowerCase().includes(texto) ||
          c.telefono.toLowerCase().includes(texto) ||
          c.notas.toLowerCase().includes(texto),
      )
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es-MX'));
  });

  protected etiquetaCategoria(clave: string): string {
    return this.categorias().find((c) => c.clave === clave)?.etiqueta ?? clave ?? '—';
  }

  protected readonly columnas: ColumnaTabla<ContactoFamiliar>[] = [
    { campo: 'nombre', etiqueta: 'Nombre' },
    { campo: 'categoria', etiqueta: 'Categoría', formatear: (f) => this.etiquetaCategoria(f.categoria), claseValor: () => 'grid-badge-muted' },
    { campo: 'telefono', etiqueta: 'Teléfono', formatear: (f) => f.telefono || '—' },
    { campo: 'correo', etiqueta: 'Correo', formatear: (f) => f.correo || '—' },
    { campo: 'notas', etiqueta: 'Notas', formatear: (f) => f.notas || '—', titulo: (f) => f.notas, multilinea: true },
  ];

  ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid');
    obtenerOSembrarValorLista(this.data, GRUPO_CATEGORIA_CONTACTO, SEMILLA_CATEGORIA_CONTACTO).subscribe((v) =>
      this.categorias.set(v.filter((r) => r.activo !== false).sort((a, b) => a.orden - b.orden)),
    );
    this.cargar();
  }

  private cargar(): void {
    this.cargando.set(true);
    this.data.list<ContactoFamiliar>(ENTIDAD).subscribe({
      next: (c) => {
        this.contactos.set(c);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  // ── Nuevo / editar contacto ───────────────────────────────────────────
  protected readonly modalAbierto = signal(false);
  protected readonly enEdicion = signal<ContactoFamiliar | null>(null);
  protected readonly aEliminar = signal<ContactoFamiliar | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    nombre: ['', Validators.required],
    categoria: [''],
    telefono: [''],
    correo: [''],
    direccion: [''],
    notas: [''],
    activo: [true],
  });

  nuevoContacto(): void {
    this.enEdicion.set(null);
    this.form.reset({ id: 0, nombre: '', categoria: this.categorias()[0]?.clave ?? '', telefono: '', correo: '', direccion: '', notas: '', activo: true });
    this.modalAbierto.set(true);
  }

  editarContacto(c: ContactoFamiliar): void {
    this.enEdicion.set(c);
    this.form.reset({ ...c });
    this.modalAbierto.set(true);
  }

  cerrarModal(): void {
    this.toast.info('Cambios descartados.');
    this.modalAbierto.set(false);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toast.error('Captura el nombre del contacto.');
      return;
    }
    const valor = this.form.getRawValue();
    const esEdicion = this.enEdicion() !== null;
    const peticion = esEdicion
      ? this.data.modificacion<ContactoFamiliar>(ENTIDAD, valor)
      : this.data.alta<ContactoFamiliar>(ENTIDAD, valor);

    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? 'Contacto actualizado.' : 'Contacto agregado.');
        this.modalAbierto.set(false);
        this.cargar();
      },
      error: () => this.toast.error('No se pudo guardar. Intenta de nuevo.'),
    });
  }

  pedirEliminar(c: ContactoFamiliar): void {
    this.aEliminar.set(c);
  }

  confirmarEliminar(): void {
    const c = this.aEliminar();
    if (!c) return;
    this.data.baja(ENTIDAD, c.id).subscribe({
      next: () => {
        this.toast.exito('Contacto eliminado.');
        this.aEliminar.set(null);
        this.cargar();
      },
      error: () => this.toast.error('No se pudo eliminar. Intenta de nuevo.'),
    });
  }
}

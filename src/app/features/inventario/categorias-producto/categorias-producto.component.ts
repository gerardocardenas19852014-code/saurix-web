import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { DataClientService, FiltroBusqueda, FILTRO_BUSQUEDA } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { CategoriaProducto } from './categoria-producto.model';

/** Columnas de texto sobre las que busca la caja de búsqueda (clave o
 *  nombre — Mandato 83, Sección 2) — mismo mecanismo FiltroBusqueda que ya
 *  usa Usuarios (ver data-client.service.ts), resuelto server-side vía
 *  .or() en SupabaseDataClientService. */
const COLUMNAS_BUSQUEDA: (keyof CategoriaProducto & string)[] = ['clave', 'nombre'];

/**
 * Mandato 83 (estándar de catálogos administrativos): esta pantalla deja de
 * descargar el catálogo completo (`list()`) y filtrar/paginar en memoria —
 * ahora usa `listarPagina()` (paginación real en servidor, infraestructura
 * que ya existía y ya usa Usuarios) y separa el filtro "en edición" (lo que
 * se está escribiendo/seleccionando) del filtro "aplicado" (lo que de
 * verdad se consultó): la búsqueda solo se dispara al presionar Buscar o
 * Enter, nunca en cada tecla. El tamaño de página respeta exactamente la
 * preferencia del usuario (PreferenciasGridService) — no se le pone un
 * mínimo propio. Pensada para copiarse tal cual al resto de catálogos
 * administrativos una vez aprobada aquí.
 */
@Component({
  selector: 'app-categorias-producto',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent],
  templateUrl: './categorias-producto.component.html',
  styleUrl: './categorias-producto.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategoriasProductoComponent implements OnInit, OnDestroy {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);
  private readonly fb = inject(FormBuilder);

  // ── Listado paginado en servidor ───────────────────────────────────────
  protected readonly categoriasPagina = signal<CategoriaProducto[]>([]);
  protected readonly totalFiltrado = signal(0);
  protected readonly paginaActual = signal(1);
  protected readonly cargando = signal(false);

  /** Filtro "en edición" — lo que el usuario está escribiendo/marcando
   *  todavía, sin aplicar (Mandato 83: nunca dispara una consulta por sí
   *  solo). */
  protected readonly busquedaEnEdicion = signal('');
  protected readonly mostrarInactivasEnEdicion = signal(false);
  /** Filtro realmente consultado al servidor — solo cambia al presionar
   *  Buscar/Enter; la paginación siempre lee de aquí. Limpiar filtros NO
   *  lo toca (ver limpiarFiltros()): solo limpia los campos "en edición" —
   *  el listado sigue mostrando lo último realmente buscado hasta que se
   *  presione Buscar otra vez (ajuste de diseño, Mandato 83). */
  private busquedaAplicada = '';
  private mostrarInactivasAplicado = false;

  /** Contador de secuencia anti-respuestas-tardías (mismo patrón que
   *  usuarios-list.component.ts): si ya se disparó una búsqueda/página más
   *  nueva, la respuesta de una petición anterior se ignora aunque llegue
   *  después. */
  private secuencia = 0;

  // ── Modal Nuevo/Editar ──────────────────────────────────────────────────
  protected readonly modalAbierto = signal(false);
  protected readonly categoriaEnEdicion = signal<CategoriaProducto | null>(null);
  protected readonly guardando = signal(false);
  /** Aviso de "cambios sin guardar" propio de este componente — cubre el
   *  botón Cancelar, que el mecanismo global de ShellComponent NO
   *  intercepta a propósito (ese mecanismo solo cubre clic-afuera y Escape,
   *  ver el comentario en shell.component.ts). El clic afuera y Escape con
   *  cambios pendientes ya quedan protegidos por ese mecanismo global junto
   *  con el aviso compartido "Cambios sin guardar"; aquí solo se completa,
   *  con el mismo criterio y el mismo texto, el único camino que ese
   *  mecanismo deja fuera. */
  protected readonly avisoCierreVisible = signal(false);

  private valoresOriginales = '';
  private elementoDisparador: HTMLElement | null = null;

  protected readonly categoriaAEliminar = signal<CategoriaProducto | null>(null);

  private readonly primerCampo = viewChild<ElementRef<HTMLInputElement>>('primerCampo');

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

  constructor() {
    // Autofocus en el primer campo (Nombre) apenas el modal aparece en el
    // DOM (Mandato 83: navegación por teclado) — el viewChild solo existe
    // una vez que el @if del template lo monta, por eso se espera un
    // microtask antes de enfocar.
    effect(() => {
      if (!this.modalAbierto()) return;
      queueMicrotask(() => this.primerCampo()?.nativeElement.focus());
    });
  }

  ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid');
    this.cargar();
  }

  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  // ── Búsqueda y paginación ───────────────────────────────────────────────

  private filtroActual(): Record<string, unknown> {
    const filtro: Record<string, unknown> = {};
    const texto = this.busquedaAplicada.trim();
    if (texto) {
      filtro[FILTRO_BUSQUEDA] = { columnas: COLUMNAS_BUSQUEDA, texto } satisfies FiltroBusqueda;
    }
    // Desmarcado (false) = solo activas; marcado (true) = activas e
    // inactivas (sin filtro de activo) — checkbox "Mostrar inactivas"
    // (ajuste de diseño del Mandato 83, reemplaza al selector
    // activas/inactivas/todas anterior).
    if (!this.mostrarInactivasAplicado) filtro['activo'] = true;
    return filtro;
  }

  /** Carga SOLO la página actual con el filtro ya aplicado — nunca el
   *  catálogo completo (Mandato 83, Sección 3). */
  private cargar(): void {
    this.cargando.set(true);
    const miSecuencia = ++this.secuencia;
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActual() - 1) * tamanio;

    this.data.listarPagina<CategoriaProducto>('CategoriaProducto', this.filtroActual(), desde, tamanio).subscribe({
      next: ({ filas, total }) => {
        if (miSecuencia !== this.secuencia) return; // respuesta vieja, se descarta
        this.categoriasPagina.set(filas);
        this.totalFiltrado.set(total);
        this.cargando.set(false);
      },
      error: () => {
        if (miSecuencia !== this.secuencia) return;
        this.cargando.set(false);
      },
    });
  }

  private reiniciarYCargar(): void {
    this.paginaActual.set(1);
    this.cargar();
  }

  /** Dispara la búsqueda real — solo se llama al presionar "Buscar" o Enter
   *  dentro del formulario de búsqueda (nunca en cada tecla, Mandato 83
   *  Sección 2). "Congela" el filtro en edición como filtro aplicado. */
  protected buscar(): void {
    this.busquedaAplicada = this.busquedaEnEdicion();
    this.mostrarInactivasAplicado = this.mostrarInactivasEnEdicion();
    this.reiniciarYCargar();
  }

  /** Solo restablece los campos "en edición" — a propósito NO dispara
   *  ninguna consulta (ajuste de diseño del Mandato 83): el listado sigue
   *  mostrando lo último realmente buscado hasta que se presione Buscar de
   *  nuevo, ya con los campos limpios. */
  protected limpiarFiltros(): void {
    this.busquedaEnEdicion.set('');
    this.mostrarInactivasEnEdicion.set(false);
  }

  protected onPaginaCambio(pagina: number): void {
    this.paginaActual.set(pagina);
    this.cargar();
  }

  // ── Alta / edición ──────────────────────────────────────────────────────

  nuevo(): void {
    this.elementoDisparador = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.categoriaEnEdicion.set(null);
    this.form.reset({ id: 0, nombre: '', clave: '', descripcion: '', activo: true });
    this.valoresOriginales = JSON.stringify(this.form.getRawValue());
    this.modalAbierto.set(true);
  }

  editar(categoria: CategoriaProducto): void {
    this.elementoDisparador = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.categoriaEnEdicion.set(categoria);
    this.form.reset({
      id: categoria.id,
      nombre: categoria.nombre,
      clave: categoria.clave,
      descripcion: categoria.descripcion ?? '',
      activo: categoria.activo !== false,
    });
    this.valoresOriginales = JSON.stringify(this.form.getRawValue());
    this.modalAbierto.set(true);
  }

  private hayCambiosSinGuardar(): boolean {
    return JSON.stringify(this.form.getRawValue()) !== this.valoresOriginales;
  }

  /** Único punto de cierre real del modal — restaura el foco al elemento
   *  que lo abrió (Mandato 83: navegación por teclado). */
  private cerrarModal(): void {
    this.modalAbierto.set(false);
    const elemento = this.elementoDisparador;
    this.elementoDisparador = null;
    if (elemento) queueMicrotask(() => elemento.focus());
  }

  /**
   * Clic en el fondo del modal: el Mandato 83 exige que el clic afuera
   * NUNCA cierre el modal por sí solo — por eso aquí se ignora cualquier
   * clic real del usuario (`isTrusted`). Lo único que llega a ejecutar un
   * cierre es un clic SINTÉTICO ya decidido en otro lado: Escape sin
   * cambios pendientes, o la confirmación del aviso global "Cambios sin
   * guardar" que ShellComponent ya muestra para clic-afuera/Escape CON
   * cambios pendientes (mismo mecanismo que ya usan el resto de modales de
   * Saurix — ver shell.component.ts) — en ambos casos la decisión de
   * cerrar ya se tomó antes de llegar aquí.
   */
  protected onClicFondoModal(evento: MouseEvent): void {
    if (evento.isTrusted) return;
    this.cerrarModal();
  }

  /** Botón Cancelar: a diferencia del clic-afuera/Escape, ShellComponent
   *  deliberadamente NO protege este camino (ver su propio comentario) —
   *  por eso aquí se repite el mismo criterio de forma local: sin cambios
   *  reales, cierra directo y sin mensaje; con cambios, pide confirmación
   *  antes de descartarlos. */
  protected cancelar(): void {
    if (!this.hayCambiosSinGuardar()) {
      this.cerrarModal();
      return;
    }
    this.avisoCierreVisible.set(true);
  }

  protected confirmarCierreSinGuardar(): void {
    this.avisoCierreVisible.set(false);
    this.cerrarModal();
  }

  protected cancelarCierreSinGuardar(): void {
    this.avisoCierreVisible.set(false);
  }

  /** Trampa de foco: mientras el modal está abierto, Tab/Shift+Tab nunca
   *  debe sacar el foco hacia el resto de la página (Mandato 83). */
  protected onTabDentroDelModal(evento: Event): void {
    if (!(evento instanceof KeyboardEvent) || evento.key !== 'Tab') return;
    const contenedor = evento.currentTarget as HTMLElement | null;
    if (!contenedor) return;
    const enfocables = Array.from(
      contenedor.querySelectorAll<HTMLElement>(
        'input, textarea, select, button, [href], [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.hasAttribute('disabled'));
    if (enfocables.length === 0) return;

    const primero = enfocables[0];
    const ultimo = enfocables[enfocables.length - 1];
    const activo = document.activeElement;

    if (evento.shiftKey && activo === primero) {
      evento.preventDefault();
      ultimo.focus();
    } else if (!evento.shiftKey && activo === ultimo) {
      evento.preventDefault();
      primero.focus();
    }
  }

  /**
   * Atajos de teclado del Mandato 83 — Alt+N/B/L para la barra (solo con el
   * modal cerrado, son acciones del listado) y Ctrl+Enter para guardar
   * (solo con el modal abierto). Escape ya queda cubierto sin código
   * adicional por el mecanismo existente (ver onClicFondoModal() y el
   * comentario ahí: Escape sin cambios cierra directo, con cambios muestra
   * el aviso "Cambios sin guardar"). @HostListener('keydown') se registra
   * en el elemento raíz de ESTE componente — por eso solo "escucha" cuando
   * esta ventana está montada (Angular lo retira solo al salir de la
   * ruta), sin un listener global en document ni afectar otras pantallas.
   * No se investigó ningún atajo reservado del navegador en conflicto con
   * Alt+N/Alt+B/Alt+L o Ctrl+Enter (a diferencia de Ctrl+N/Ctrl+B/Ctrl+L,
   * que sí están reservados por Chrome/Edge — por eso el Mandato pidió Alt,
   * no Ctrl, para esos tres).
   */
  @HostListener('keydown', ['$event'])
  protected onAtajoTeclado(evento: KeyboardEvent): void {
    if (evento.altKey && !evento.ctrlKey && !evento.metaKey && !this.modalAbierto()) {
      const tecla = evento.key.toLowerCase();
      if (tecla === 'n') {
        evento.preventDefault();
        this.nuevo();
        return;
      }
      if (tecla === 'b') {
        evento.preventDefault();
        this.buscar();
        return;
      }
      if (tecla === 'l') {
        evento.preventDefault();
        this.limpiarFiltros();
        return;
      }
    }

    if (evento.ctrlKey && evento.key === 'Enter' && this.modalAbierto()) {
      if (this.form.invalid || this.guardando()) return;
      evento.preventDefault();
      this.guardar();
    }
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    if (this.guardando()) return; // evita doble envío (doble click/doble Enter)

    const valor = this.form.getRawValue();
    const payload = {
      ...valor,
      nombre: valor.nombre.trim(),
      clave: valor.clave.trim(),
      descripcion: valor.descripcion.trim() || null,
    };
    const esEdicion = this.categoriaEnEdicion() !== null;
    this.guardando.set(true);
    const peticion = esEdicion
      ? this.data.modificacion<CategoriaProducto>('CategoriaProducto', payload)
      : this.data.alta<CategoriaProducto>('CategoriaProducto', payload);

    peticion.subscribe({
      next: () => {
        this.guardando.set(false);
        this.toast.exito(esEdicion ? 'Categoría actualizada.' : 'Categoría creada.');
        this.cerrarModal();
        this.cargar();
      },
      // El error ya se muestra vía el toast genérico de DataClientService
      // (incluye "Ya existe un registro con esos datos." para clave
      // duplicada — ver supabase-data-client.service.ts) — aquí solo se
      // reactiva el botón y se conservan los datos capturados, sin cerrar
      // el modal (Mandato 83, Sección 4).
      error: () => this.guardando.set(false),
    });
  }

  // ── Eliminación ───────────────────────────────────────────────────────

  pedirEliminar(categoria: CategoriaProducto): void {
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
        // Si era la última fila de una página distinta de la primera, se
        // retrocede una página antes de recargar (mismo criterio que
        // Usuarios) — nunca se deja la grid mostrando una página vacía.
        if (this.categoriasPagina().length === 1 && this.paginaActual() > 1) {
          this.paginaActual.update((p) => p - 1);
        }
        this.cargar();
      },
    });
  }
}

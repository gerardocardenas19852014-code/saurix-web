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
import { forkJoin } from 'rxjs';
import { DataClientService, FiltroBusqueda, FILTRO_BUSQUEDA } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { UnidadMedida } from './unidad-medida.model';

/** Columnas de texto sobre las que busca la caja de búsqueda — mismo
 *  mecanismo FiltroBusqueda que Categorías de producto (Mandato 83/84). */
const COLUMNAS_BUSQUEDA: (keyof UnidadMedida & string)[] = ['clave', 'nombre'];

/**
 * Mandato 84 (homologación SAURIX-CAT-001): catálogo "Unidad de medida"
 * llevado al mismo estándar que Categorías de producto — paginación real
 * en servidor (listarPagina()), filtro en-edición/aplicado con Buscar/
 * Enter, modal protegido (clic afuera nunca cierra, Cancelar/Escape
 * protegen cambios sin guardar, foco gestionado), atajos de teclado, y un
 * chequeo de dependencias AMPLIADO antes de eliminar: a diferencia de la
 * versión anterior (que solo miraba Producto.unidadMedidaId), ahora también
 * cubre Producto.unidadCompraId y OrdenCompraItem.unidadId — las tres
 * columnas que de verdad referencian esta unidad (ver auditoría del
 * Mandato 84). Las tres relaciones son FK con ON DELETE NO ACTION en la
 * base de datos (confirmado contra producción): Postgres ya rechaza por sí
 * solo cualquier DELETE mientras existan filas dependientes, así que el
 * chequeo de aquí es una mejora de experiencia (mensaje claro antes de
 * intentarlo) y no la única línea de defensa — si de todas formas quedara
 * una fila dependiente nueva entre el chequeo y el guardado (condición de
 * carrera), la base de datos rechaza el DELETE igual y el mensaje genérico
 * de conToast() ("No se puede completar: hay registros relacionados con
 * este.") se muestra solo, sin pérdida de datos posible.
 */
@Component({
  selector: 'app-unidades-medida',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent],
  templateUrl: './unidades-medida.component.html',
  styleUrl: './unidades-medida.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UnidadesMedidaComponent implements OnInit, OnDestroy {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);
  private readonly fb = inject(FormBuilder);

  // ── Listado paginado en servidor ───────────────────────────────────────
  protected readonly unidadesPagina = signal<UnidadMedida[]>([]);
  protected readonly totalFiltrado = signal(0);
  protected readonly paginaActual = signal(1);
  protected readonly cargando = signal(false);
  /** false hasta que el usuario presione "Buscar" por primera vez -- nunca
   *  arranca en true: ya no se consulta nada al abrir la pantalla (ver
   *  ngOnInit() más abajo, Mandato 84 "corrección de carga automática
   *  inicial"). Antes de eso la cuadrícula no debe mostrar la tabla vacía
   *  sino una invitación a buscar. */
  protected readonly haBuscado = signal(false);

  protected readonly busquedaEnEdicion = signal('');
  protected readonly mostrarInactivasEnEdicion = signal(false);
  private busquedaAplicada = '';
  private mostrarInactivasAplicado = false;

  private secuencia = 0;

  // ── Modal Nuevo/Editar ──────────────────────────────────────────────────
  protected readonly modalAbierto = signal(false);
  protected readonly unidadEnEdicion = signal<UnidadMedida | null>(null);
  protected readonly guardando = signal(false);
  protected readonly avisoCierreVisible = signal(false);

  private valoresOriginales = '';
  private elementoDisparador: HTMLElement | null = null;

  protected readonly unidadAEliminar = signal<UnidadMedida | null>(null);

  private readonly primerCampo = viewChild<ElementRef<HTMLInputElement>>('primerCampo');

  protected readonly columnas: ColumnaTabla<UnidadMedida>[] = [
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
    nombre: ['', Validators.required],
    clave: ['', Validators.required],
    activo: [true],
  });

  constructor() {
    effect(() => {
      if (!this.modalAbierto()) return;
      queueMicrotask(() => this.primerCampo()?.nativeElement.focus());
    });
  }

  ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid');
    // Mandato 84: no se consulta nada al abrir la pantalla. La cuadrícula
    // arranca vacía con la invitación a buscar (ver plantilla) hasta que el
    // usuario presione "Buscar" o Enter -- ver buscar() más abajo.
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
    if (!this.mostrarInactivasAplicado) filtro['activo'] = true;
    return filtro;
  }

  private cargar(): void {
    this.cargando.set(true);
    const miSecuencia = ++this.secuencia;
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActual() - 1) * tamanio;

    this.data.listarPagina<UnidadMedida>('UnidadMedida', this.filtroActual(), desde, tamanio).subscribe({
      next: ({ filas, total }) => {
        if (miSecuencia !== this.secuencia) return;
        this.unidadesPagina.set(filas);
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

  protected buscar(): void {
    this.haBuscado.set(true);
    this.busquedaAplicada = this.busquedaEnEdicion();
    this.mostrarInactivasAplicado = this.mostrarInactivasEnEdicion();
    this.reiniciarYCargar();
  }

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
    this.unidadEnEdicion.set(null);
    this.form.reset({ id: 0, nombre: '', clave: '', activo: true });
    this.valoresOriginales = JSON.stringify(this.form.getRawValue());
    this.modalAbierto.set(true);
  }

  editar(unidad: UnidadMedida): void {
    this.elementoDisparador = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.unidadEnEdicion.set(unidad);
    this.form.reset({
      id: unidad.id,
      nombre: unidad.nombre,
      clave: unidad.clave,
      activo: unidad.activo !== false,
    });
    this.valoresOriginales = JSON.stringify(this.form.getRawValue());
    this.modalAbierto.set(true);
  }

  private hayCambiosSinGuardar(): boolean {
    return JSON.stringify(this.form.getRawValue()) !== this.valoresOriginales;
  }

  private cerrarModal(): void {
    this.modalAbierto.set(false);
    const elemento = this.elementoDisparador;
    this.elementoDisparador = null;
    if (elemento) queueMicrotask(() => elemento.focus());
  }

  protected onClicFondoModal(evento: MouseEvent): void {
    if (evento.isTrusted) return;
    this.cerrarModal();
  }

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
    if (this.guardando()) return;

    const valor = this.form.getRawValue();
    const payload = {
      ...valor,
      nombre: valor.nombre.trim(),
      clave: valor.clave.trim(),
    };
    const esEdicion = this.unidadEnEdicion() !== null;
    this.guardando.set(true);
    const peticion = esEdicion
      ? this.data.modificacion<UnidadMedida>('UnidadMedida', payload)
      : this.data.alta<UnidadMedida>('UnidadMedida', payload);

    peticion.subscribe({
      next: () => {
        this.guardando.set(false);
        this.toast.exito(esEdicion ? 'Unidad actualizada.' : 'Unidad creada.');
        this.cerrarModal();
        // Mandato 84, punto 7: no recargar el listado si todavía no se ha
        // ejecutado ninguna búsqueda (evita una carga masiva implícita).
        if (this.haBuscado()) this.cargar();
      },
      error: () => this.guardando.set(false),
    });
  }

  // ── Eliminación ───────────────────────────────────────────────────────

  /**
   * Chequeo de dependencias AMPLIADO (Mandato 84): la versión anterior solo
   * miraba Producto.unidadMedidaId — aquí se agregan Producto.unidadCompraId
   * (unidad de compra alterna, con su factor_conversion_compra asociado) y
   * OrdenCompraItem.unidadId (snapshot histórico de líneas de orden de
   * compra). Las tres son NO ACTION en la base de datos: aunque este
   * chequeo llegara a quedar desactualizado por una fila insertada justo
   * después (condición de carrera), Postgres rechaza igual el DELETE y el
   * usuario ve el mismo mensaje claro vía el mapeo genérico de errores
   * (23503) de SupabaseDataClientService — nunca hay pérdida de datos
   * silenciosa.
   */
  pedirEliminar(unidad: UnidadMedida): void {
    forkJoin({
      comoUnidadPrincipal: this.data.listarPagina<{ id: number }>('Producto', { unidadMedidaId: unidad.id }, 0, 1),
      comoUnidadDeCompra: this.data.listarPagina<{ id: number }>('Producto', { unidadCompraId: unidad.id }, 0, 1),
      enLineasDeOrdenCompra: this.data.listarPagina<{ id: number }>('OrdenCompraItem', { unidadId: unidad.id }, 0, 1),
    }).subscribe(({ comoUnidadPrincipal, comoUnidadDeCompra, enLineasDeOrdenCompra }) => {
      const partes: string[] = [];
      if (comoUnidadPrincipal.total > 0) {
        partes.push(
          `${comoUnidadPrincipal.total} producto${comoUnidadPrincipal.total === 1 ? '' : 's'} (unidad principal)`,
        );
      }
      if (comoUnidadDeCompra.total > 0) {
        partes.push(
          `${comoUnidadDeCompra.total} producto${comoUnidadDeCompra.total === 1 ? '' : 's'} (unidad de compra)`,
        );
      }
      if (enLineasDeOrdenCompra.total > 0) {
        partes.push(
          `${enLineasDeOrdenCompra.total} línea${enLineasDeOrdenCompra.total === 1 ? '' : 's'} de orden de compra`,
        );
      }
      if (partes.length > 0) {
        this.toast.advertencia(`No se puede eliminar: la usan ${partes.join(', ')}.`);
        return;
      }
      this.unidadAEliminar.set(unidad);
    });
  }

  confirmarEliminar(): void {
    const unidad = this.unidadAEliminar();
    if (!unidad) return;
    this.data.baja('UnidadMedida', unidad.id).subscribe({
      next: () => {
        this.toast.exito('Unidad eliminada.');
        this.unidadAEliminar.set(null);
        if (this.unidadesPagina().length === 1 && this.paginaActual() > 1) {
          this.paginaActual.update((p) => p - 1);
        }
        if (this.haBuscado()) this.cargar();
      },
    });
  }
}

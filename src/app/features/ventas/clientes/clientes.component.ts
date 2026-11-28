import { ChangeDetectionStrategy, Component, HostListener, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DataClientService, FiltroBusqueda, FILTRO_BUSQUEDA } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { exportarCsv } from '../../../shared/utils/csv.util';
import { ClienteFormModalComponent } from './cliente-form-modal.component';
import { ClienteService } from './cliente.service';
import { Cliente } from './cliente.model';

const ENTIDAD = 'Cliente';
/** Columnas sobre las que busca la caja de texto (server-side, OR + ilike
 *  vía FILTRO_BUSQUEDA): nombre/razón social y RFC — lo que pide el
 *  estándar — más correo y teléfono, que la pantalla ya buscaba antes de
 *  esta homologación y se conservan para no quitarle nada al usuario. */
const COLUMNAS_BUSQUEDA: (keyof Cliente & string)[] = ['nombre', 'rfc', 'correo', 'telefono'];
/** Mismo tamaño de lote que el resto de exportaciones homologadas
 *  (tipo-sistema-list, usuarios-list) — exportar trae TODO lo que cumple el
 *  filtro aplicado en lotes, nunca solo la página visible ni una sola
 *  petición gigante. */
const TAMANO_LOTE_EXPORTAR = 1000;
/** Clave de PreferenciasGridService para los anchos de columna de ESTA
 *  pantalla (mismo mecanismo que la Lista de tickets). */
const ID_GRID = 'ventas-clientes';

/** Catálogo de clientes de Ventas. El formulario vive aparte
 *  (ClienteFormModalComponent) porque Cobro también lo usa — por eso esta
 *  homologación NO lo toca: validación de RFC, campos fiscales, protección
 *  del cliente genérico dentro del formulario y alta rápida desde Cobro
 *  quedan exactamente igual.
 *
 * Mandato 90.3 / Adicional 3 — homologación a SAURIX-CAT-001 v1.1 (misma
 * mecánica que Categorías de producto + búsqueda manual de los catálogos
 * v1.1 de Inventario/WikiDocs):
 * - Búsqueda manual: el grid arranca vacío con la invitación a buscar
 *   (`haBuscado`); antes, ngOnInit() cargaba la página 1 de inmediato. Solo
 *   "Buscar"/Enter consulta. Escribir, marcar "Mostrar inactivos" o
 *   "Limpiar filtros" nunca consultan.
 * - Filtros en edición (`busquedaEnEdicion`/`mostrarInactivosEnEdicion`)
 *   separados de los aplicados (`busquedaAplicada`/`mostrarInactivosAplicado`):
 *   paginación, orden, exportación y el refresco tras alta/edición/baja
 *   usan SIEMPRE los aplicados.
 * - Se elimina la paginación superior propia (Anterior/Siguiente encima de
 *   la tabla) y se usa la paginación estándar de <app-data-table> en modo
 *   servidor (pie debajo del grid), con orden server-side por columna.
 * - Guardia de secuencia contra respuestas tardías (dos búsquedas seguidas
 *   nunca pintan la vieja encima de la nueva).
 * - Exportación CSV con los filtros/orden aplicados y anchos de columna
 *   redimensionables persistidos (PreferenciasGridService).
 *
 * La única llamada al entrar es obtenerOCrearGenerico() (una consulta
 * filtrada por esGenerico=true, más un alta solo si aún no existe) — no es
 * una consulta del grid, garantiza que "Público en General" exista. */
@Component({
  selector: 'app-clientes',
  standalone: true,
  imports: [DataTableComponent, ConfirmDialogComponent, ClienteFormModalComponent],
  templateUrl: './clientes.component.html',
  styleUrl: './clientes.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClientesComponent implements OnInit, OnDestroy {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);
  private readonly clienteService = inject(ClienteService);

  // ── Listado paginado en servidor ─────────────────────────────────────────
  /** Solo la página actual, ya filtrada/ordenada/recortada por el servidor. */
  protected readonly clientesPagina = signal<Cliente[]>([]);
  /** Total real (count del servidor) que cumple el filtro aplicado. */
  protected readonly totalFiltrado = signal(0);
  protected readonly paginaActual = signal(1);
  protected readonly cargando = signal(false);
  /** false hasta la primera búsqueda — nunca se consulta el grid al entrar. */
  protected readonly haBuscado = signal(false);
  protected readonly exportando = signal(false);

  protected readonly columnaOrden = signal<keyof Cliente & string>('nombre');
  protected readonly direccionOrden = signal<'asc' | 'desc'>('asc');

  /** Filtros EN EDICIÓN — lo que el usuario escribe/marca; nunca consultan. */
  protected readonly busquedaEnEdicion = signal('');
  protected readonly mostrarInactivosEnEdicion = signal(false);
  /** Filtros APLICADOS — lo que de verdad se consultó con "Buscar". */
  private busquedaAplicada = '';
  private mostrarInactivosAplicado = false;

  /** Guardia de secuencia anti-respuestas-tardías. */
  private secuencia = 0;

  /** Anchos de columna personalizados (redimensionado manual). */
  protected readonly anchosColumnas = signal<Record<string, number>>(this.preferenciasGrid.leerAnchosColumnas(ID_GRID));

  protected readonly modalAbierto = signal(false);
  protected readonly clienteEnEdicion = signal<Cliente | null>(null);
  protected readonly clienteAEliminar = signal<Cliente | null>(null);

  protected readonly columnas: ColumnaTabla<Cliente>[] = [
    { campo: 'nombre', etiqueta: 'Nombre / Razón social', anchoMinimo: 160 },
    { campo: 'rfc', etiqueta: 'RFC', anchoMinimo: 110 },
    { campo: 'correo', etiqueta: 'Correo', formatear: (fila) => fila.correo ?? '—', anchoMinimo: 120 },
    { campo: 'telefono', etiqueta: 'Teléfono', formatear: (fila) => fila.telefono ?? '—', anchoMinimo: 100 },
    {
      campo: 'esGenerico',
      etiqueta: 'Tipo',
      formatear: (fila) => (fila.esGenerico ? 'Genérico' : 'Cliente'),
      claseValor: (fila) => (fila.esGenerico ? 'grid-badge-warning' : 'grid-badge-muted'),
      anchoMinimo: 90,
    },
    {
      campo: 'activo',
      etiqueta: 'Activo',
      formatear: (fila) => (fila.activo !== false ? 'Sí' : 'No'),
      claseValor: (fila) => (fila.activo !== false ? 'grid-badge-success' : 'grid-badge-muted'),
      anchoMinimo: 80,
    },
  ];

  async ngOnInit(): Promise<void> {
    document.documentElement.setAttribute('data-wide', 'grid');
    // Asegura que "Público en General" exista (no es una consulta del
    // grid). Ya NO se llama a cargar() aquí: el grid arranca vacío.
    await this.clienteService.obtenerOCrearGenerico();
  }

  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  // ── Búsqueda, orden y paginación ─────────────────────────────────────────

  /** Filtro construido SOLO con los valores aplicados. `activo` solo se
   *  manda cuando NO se quieren inactivos (omitirlo trae ambos). */
  private filtroActual(): Record<string, unknown> {
    const filtro: Record<string, unknown> = {};
    const texto = this.busquedaAplicada.trim();
    if (texto) {
      filtro[FILTRO_BUSQUEDA] = { columnas: COLUMNAS_BUSQUEDA, texto } satisfies FiltroBusqueda;
    }
    if (!this.mostrarInactivosAplicado) filtro['activo'] = true;
    return filtro;
  }

  private ordenActual(): { columna: keyof Cliente & string; direccion: 'asc' | 'desc' } {
    return { columna: this.columnaOrden(), direccion: this.direccionOrden() };
  }

  /** Trae SOLO la página actual que cumple el filtro aplicado (con count
   *  real) — nunca la tabla completa. */
  private cargar(): void {
    this.cargando.set(true);
    const miSecuencia = ++this.secuencia;
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActual() - 1) * tamanio;

    this.data.listarPagina<Cliente>(ENTIDAD, this.filtroActual(), desde, tamanio, this.ordenActual()).subscribe({
      next: ({ filas, total }) => {
        if (miSecuencia !== this.secuencia) return;
        // Si la página quedó vacía (p.ej. se eliminó el último cliente de la
        // última página), retrocede a la última página real en vez de dejar
        // la tabla en blanco — comportamiento previo, se conserva.
        if (filas.length === 0 && this.paginaActual() > 1 && total > 0) {
          this.paginaActual.set(Math.max(1, Math.ceil(total / tamanio)));
          this.cargar();
          return;
        }
        this.clientesPagina.set(filas);
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

  /** Único disparador de una búsqueda nueva ("🔍 Buscar" o Enter): congela
   *  los filtros en edición como aplicados y vuelve a la página 1. */
  protected buscar(): void {
    this.haBuscado.set(true);
    this.busquedaAplicada = this.busquedaEnEdicion();
    this.mostrarInactivosAplicado = this.mostrarInactivosEnEdicion();
    this.reiniciarYCargar();
  }

  /** Solo restablece los campos "en edición" — no dispara ninguna consulta. */
  protected limpiarFiltros(): void {
    this.busquedaEnEdicion.set('');
    this.mostrarInactivosEnEdicion.set(false);
  }

  protected onPaginaCambio(pagina: number): void {
    this.paginaActual.set(pagina);
    this.cargar();
  }

  protected onOrdenCambio(evento: { campo: keyof Cliente & string; direccion: 'asc' | 'desc' }): void {
    this.columnaOrden.set(evento.campo);
    this.direccionOrden.set(evento.direccion);
    this.reiniciarYCargar();
  }

  protected onAnchoColumnaCambio(evento: { clave: string; ancho: number }): void {
    this.preferenciasGrid.guardarAnchoColumna(ID_GRID, evento.clave, evento.ancho);
    this.anchosColumnas.update((actuales) => ({ ...actuales, [evento.clave]: evento.ancho }));
  }

  // ── Exportar CSV ─────────────────────────────────────────────────────────

  /** Exporta TODO lo que cumple el filtro y orden APLICADOS (no solo la
   *  página visible), en lotes. Deshabilitado hasta la primera búsqueda y
   *  mientras otra exportación esté en curso (evita solicitudes duplicadas). */
  async exportarCsvArchivo(): Promise<void> {
    if (!this.haBuscado() || this.exportando()) return;
    this.exportando.set(true);
    try {
      const filtro = this.filtroActual();
      const orden = this.ordenActual();
      const todas: Cliente[] = [];
      let desde = 0;
      let total = Infinity;
      while (desde < total) {
        const { filas, total: totalReal } = await firstValueFrom(
          this.data.listarPagina<Cliente>(ENTIDAD, filtro, desde, TAMANO_LOTE_EXPORTAR, orden),
        );
        if (filas.length === 0) break;
        todas.push(...filas);
        total = totalReal;
        desde += TAMANO_LOTE_EXPORTAR;
      }

      exportarCsv(
        'clientes.csv',
        [
          { clave: 'nombre', etiqueta: 'Nombre / Razón social' },
          { clave: 'rfc', etiqueta: 'RFC' },
          { clave: 'correo', etiqueta: 'Correo' },
          { clave: 'telefono', etiqueta: 'Teléfono' },
          { clave: 'tipo', etiqueta: 'Tipo' },
          { clave: 'activo', etiqueta: 'Activo' },
        ],
        todas.map((f) => ({
          nombre: f.nombre,
          rfc: f.rfc ?? '',
          correo: f.correo ?? '',
          telefono: f.telefono ?? '',
          tipo: f.esGenerico ? 'Genérico' : 'Cliente',
          activo: f.activo !== false ? 'Sí' : 'No',
        })),
      );
      this.toast.exito(`Se descargó clientes.csv (${todas.length} registro${todas.length === 1 ? '' : 's'}).`);
    } finally {
      this.exportando.set(false);
    }
  }

  // ── Alta / edición / baja (sin cambios de comportamiento) ───────────────

  nuevo(): void {
    this.clienteEnEdicion.set(null);
    this.modalAbierto.set(true);
  }

  editar(cliente: Cliente): void {
    this.clienteEnEdicion.set(cliente);
    this.modalAbierto.set(true);
  }

  alGuardar(): void {
    this.modalAbierto.set(false);
    // Refresca la página actual con los filtros APLICADOS (nunca con lo que
    // esté escrito sin buscar). Si aún no se había buscado, el grid sigue
    // vacío: el alta no dispara una búsqueda que el usuario no pidió.
    if (this.haBuscado()) this.cargar();
  }

  pedirEliminar(cliente: Cliente): void {
    if (cliente.esGenerico) {
      this.toast.advertencia('El contacto "Público en General" no se puede eliminar.');
      return;
    }
    this.clienteAEliminar.set(cliente);
  }

  confirmarEliminar(): void {
    const cliente = this.clienteAEliminar();
    if (!cliente) return;

    this.data.baja(ENTIDAD, cliente.id).subscribe({
      next: () => {
        this.toast.exito('Cliente eliminado.');
        this.clienteAEliminar.set(null);
        if (this.haBuscado()) this.cargar();
      },
    });
  }

  // ── Atajos de teclado (mismo esquema que Categorías de producto) ────────
  /** Alt+N = Nuevo, Alt+B = Buscar, Alt+L = Limpiar filtros — solo con el
   *  formulario y el diálogo de confirmación cerrados. Escucha en el
   *  elemento raíz de este componente (no en document). */
  @HostListener('keydown', ['$event'])
  protected onAtajoTeclado(evento: KeyboardEvent): void {
    if (!evento.altKey || evento.ctrlKey || evento.metaKey) return;
    if (this.modalAbierto() || this.clienteAEliminar() !== null) return;
    const tecla = evento.key.toLowerCase();
    if (tecla === 'n') {
      evento.preventDefault();
      this.nuevo();
    } else if (tecla === 'b') {
      evento.preventDefault();
      this.buscar();
    } else if (tecla === 'l') {
      evento.preventDefault();
      this.limpiarFiltros();
    }
  }
}

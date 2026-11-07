import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { DataClientService } from '../../../core/services/data-client.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { SelectBuscableComponent, OpcionBuscable } from '../../../shared/components/select-buscable/select-buscable.component';
import { ToastService } from '../../../shared/services/toast.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { exportarCsv, parsearCsv } from '../../../shared/utils/csv.util';
import { Producto } from './producto.model';
import { CategoriaProducto } from '../categorias-producto/categoria-producto.model';
import { UnidadMedida } from '../unidades-medida/unidad-medida.model';
import { Proveedor } from '../proveedores/proveedor.model';
import { formatMoneda, existenciaTotal } from './producto.util';
import { ExistenciaBodega } from '../movimientos-bodega/existencia-bodega.model';
import { EscaneoCodigoComponent } from '../../../shared/components/escaneo-codigo/escaneo-codigo.component';
import { ImprimirEtiquetasComponent } from './imprimir-etiquetas/imprimir-etiquetas.component';

/** Una fila ya parseada del CSV de importación masiva. La validación real
 *  (única implementación -- ya no se duplica en Angular, ver auditoría en
 *  claude/productos-importacion-masiva-auditoria-2026-11.md) la hace el
 *  servidor en inventario.fn_importar_productos_masivo — ver
 *  archivoSeleccionado()/validarEnServidor() más abajo. `error` bloquea la
 *  importación completa (política "detener todo" -- decisión del usuario,
 *  4-nov-2026); `advertencia` es informativo y nunca bloquea nada
 *  (sección B del mandato). */
interface FilaImportacion {
  numero: number; // número de renglón del archivo (para ubicarlo si hay error) — 1 = encabezado
  nombre: string;
  codigo: string;
  categoriaTexto: string;
  unidadTexto: string;
  costoTexto: string;
  precioTexto: string;
  existenciaTexto: string;
  activoTexto: string;
  descripcionTexto: string;
  nivelMinimoTexto: string;
  nivelMaximoTexto: string;
  proveedorTexto: string;
  unidadCompraTexto: string;
  factorConversionCompraTexto: string;
  manejaLotesTexto: string;
  destacadoTexto: string;
  error: string | null;
  advertencia: string | null;
}

/** Forma exacta de lo que regresa inventario.fn_importar_productos_masivo
 *  (tanto en modo validación como al importar de verdad). */
interface ResultadoImportacion {
  operacionId: string;
  duplicada: boolean;
  ok: boolean;
  totalFilas: number;
  productosCreados: number;
  errores: { numero: number; mensaje: string }[];
  advertencias: { numero: number; mensaje: string }[];
}

// Las primeras 8 columnas son las originales (no se reordenan, para no
// romper plantillas ya descargadas); las nuevas se agregan al final.
const ENCABEZADOS_CSV = [
  'nombre', 'codigo', 'categoria', 'unidad', 'costo', 'precio', 'existencia', 'activo',
  'descripcion', 'nivel_minimo', 'nivel_maximo', 'proveedor', 'unidad_compra', 'factor_conversion_compra', 'maneja_lotes', 'destacado',
] as const;

/** Las 4 pestañas del modal "Nuevo producto"/"Editar producto" (rediseño
 *  UI/UX, nov-2026) -- un único FormGroup para las 4, nunca se pierde
 *  información al cambiar de pestaña (ver pestanaActiva más abajo). */
type PestanaProducto = 'general' | 'inventario' | 'precios' | 'tienda';

@Component({
  selector: 'app-productos',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, SelectBuscableComponent, EscaneoCodigoComponent, ImprimirEtiquetasComponent],
  templateUrl: './productos.component.html',
  styleUrl: './productos.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductosComponent implements OnInit, OnDestroy {
  // Pantalla a ancho completo (html[data-wide='grid'] en styles.scss).
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  private readonly data = inject(DataClientService);
  private readonly router = inject(Router);
  protected readonly toast = inject(ToastService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);
  private readonly fb = inject(FormBuilder);

  /** Tope de resultados para la búsqueda rápida del modal "Imprimir
   *  etiquetas" (ver buscarProductosEtiquetas()) — ese modal busca aparte
   *  contra el servidor (no contra la página actual de la tabla), así que
   *  necesita su propio límite acotado. */

  protected readonly productos = signal<Producto[]>([]);
  /** Total real de productos que cumplen el filtro actual (sin recortar a
   *  la página) — ver cargar(). Con esto se calcula totalPaginas y se sabe
   *  si "Siguiente" tiene a dónde ir, sin tener que traer el catálogo
   *  completo solo para contarlo. */
  protected readonly totalProductos = signal(0);
  protected readonly categorias = signal<CategoriaProducto[]>([]);
  protected readonly unidades = signal<UnidadMedida[]>([]);
  protected readonly proveedores = signal<Proveedor[]>([]);
  protected readonly existenciasBodega = signal<ExistenciaBodega[]>([]);
  protected readonly cargando = signal(false);
  protected readonly busqueda = signal('');
  /** Búsqueda por código/SKU — igual que busqueda (nombre), va server-side
   *  (coincidencia parcial, ver DataClientService.list()) en vez de
   *  filtrar en memoria, para que funcione aunque el producto buscado no
   *  esté en la página actualmente cargada. */
  protected readonly busquedaCodigo = signal('');
  /** 0 = sin filtrar por categoría (campo en blanco — ver
   *  opcionesCategoriaFiltro, que ya no incluye una opción "Todas" propia;
   *  el combo la limpia con su botón "✕" en vez de tener que elegirla). */
  protected readonly filtroCategoriaId = signal(0);
  protected readonly mostrarInactivos = signal(false);
  /** true solo después de que el usuario hace click en "Buscar" (o Enter en
   *  un campo de texto) al menos una vez — ver cambiarFiltro(). Antes de eso
   *  no se pide nada al servidor ni se muestra la tabla/paginador: con un
   *  catálogo de cientos de miles de productos, cargar la página 1 "porque
   *  sí" al abrir la pantalla ya no tiene sentido si de todas formas el
   *  usuario va a filtrar antes de mirar resultados. */
  protected readonly busquedaRealizada = signal(false);

  /** Página actual (1-based) de la paginación REAL contra el servidor — ver
   *  cargar(). A diferencia de [tamanoPagina] en <app-data-table> (que solo
   *  pagina en memoria lo que ya se trajo), esto controla qué página se le
   *  PIDE al servidor: nunca se trae más de una página a la vez, así que
   *  "Siguiente" dispara una petición nueva en vez de solo cambiar qué
   *  renglones ya cargados se muestran. */
  protected readonly paginaActual = signal(1);
  protected readonly totalPaginas = computed(() =>
    Math.max(1, Math.ceil(this.totalProductos() / Math.max(1, this.preferenciasGrid.tamanoPagina()))),
  );

  protected readonly opcionesCategoria = computed<OpcionBuscable[]>(() =>
    this.categorias()
      .filter((c) => c.activo !== false)
      .map((c) => ({ valor: c.id, etiqueta: c.nombre })),
  );
  /** Igual que opcionesCategoria — para el filtro de búsqueda del listado
   *  (opcional), a diferencia del dropdown del formulario de alta/edición
   *  donde elegir categoría es obligatorio. Sin una opción "Todas las
   *  categorías" artificial: sin selección (campo en blanco) YA significa
   *  "todas"; el combo usa [permiteLimpiar]="true" para volver a ese
   *  estado con su botón "✕". */
  protected readonly opcionesCategoriaFiltro = this.opcionesCategoria;
  protected readonly opcionesUnidad = computed<OpcionBuscable[]>(() =>
    this.unidades()
      .filter((u) => u.activo !== false)
      .map((u) => ({ valor: u.id, etiqueta: u.nombre })),
  );
  /** Mismo catálogo que opcionesUnidad, con "Sin unidad de compra alterna"
   *  (valor 0) al inicio — igual que opcionesProveedor con "Sin proveedor":
   *  tener una unidad de compra distinta a la base es opcional. */
  protected readonly opcionesUnidadCompra = computed<OpcionBuscable[]>(() => [
    { valor: 0, etiqueta: 'Sin unidad de compra alterna' },
    ...this.unidades()
      .filter((u) => u.activo !== false)
      .map((u) => ({ valor: u.id, etiqueta: u.nombre })),
  ]);
  /** Incluye la opción "Sin proveedor" (valor 0) porque, a diferencia de
   *  Categoría/Unidad, asignar proveedor es opcional (ver Producto.proveedorId). */
  protected readonly opcionesProveedor = computed<OpcionBuscable[]>(() => [
    { valor: 0, etiqueta: 'Sin proveedor' },
    ...this.proveedores()
      .filter((p) => p.activo !== false)
      .map((p) => ({ valor: p.id, etiqueta: p.nombre })),
  ]);

  private nombreCategoria(id: number): string {
    return this.categorias().find((c) => c.id === id)?.nombre ?? '—';
  }
  private nombreUnidad(id: number): string {
    return this.unidades().find((u) => u.id === id)?.nombre ?? '—';
  }
  protected nombreProveedor(id: number | null): string {
    if (!id) return '—';
    return this.proveedores().find((p) => p.id === id)?.nombre ?? '—';
  }

  /** Existencia actual del producto en edición, solo para MOSTRARLA en el
   *  modal (PENDIENTE 2.1, 2026-11) -- el formulario ya no tiene ningún
   *  control para capturarla o cambiarla; 0 para un producto nuevo (todavía
   *  no existe productoEnEdicion()). Misma función existenciaTotal() que ya
   *  usa la columna "Existencia" del listado, para que nunca se desincronicen. */
  protected existenciaActualEnEdicion(): number {
    const producto = this.productoEnEdicion();
    return producto ? existenciaTotal(producto, this.existenciasBodega()) : 0;
  }

  protected readonly modalAbierto = signal(false);
  protected readonly productoEnEdicion = signal<Producto | null>(null);
  protected readonly productoAEliminar = signal<Producto | null>(null);
  /** Foto del producto en edición (base64, ya redimensionada) — aparte del
   *  formulario reactivo por lo mismo que fotoActual en miembros.component.ts:
   *  más simple de resetear/precargar que meterla como FormControl. */
  protected readonly fotoActual = signal<string>('');
  /** true mientras el visor de foto a tamaño completo está abierto (ver
   *  guardar()/quitarFoto() no la tocan; solo se cierra al abrir/cerrar el
   *  modal o con el botón ✕ del visor). */
  protected readonly fotoAmpliada = signal(false);

  /** Pestaña visible del modal de alta/edición -- arranca siempre en
   *  "general" (ver nuevo()/editar()). Cambiar de pestaña solo oculta/
   *  muestra secciones del MISMO form (ver .html); nunca crea, destruye ni
   *  resetea ningún FormControl, así que no se pierde nada al navegar. */
  protected readonly pestanaActiva = signal<PestanaProducto>('general');

  /** El contenido de las 4 pestañas comparte UN SOLO contenedor con scroll
   *  (.producto-modal-contenido, ver productos.component.scss) -- sin esta
   *  referencia, cambiar de pestaña después de haber bajado el scroll en
   *  la anterior dejaba la nueva pestaña abierta en esa misma posición,
   *  mostrando sus primeros campos recortados arriba del todo (bug
   *  confirmado en la auditoría Fase 2, "Prompt maestro" nov-2026). Ver
   *  cambiarPestana()/irAPestanaConError() más abajo. */
  @ViewChild('contenidoModalProducto') private contenidoModalRef?: ElementRef<HTMLElement>;

  /** Único punto que cambia de pestaña en el modal -- además de mover el
   *  signal, regresa el contenedor de contenido a su posición superior
   *  (ver el comentario de contenidoModalRef arriba). Nunca crea, destruye
   *  ni resetea ningún FormControl: el form sigue siendo uno solo para las
   *  4 pestañas, así que no se pierde ningún valor capturado. */
  protected cambiarPestana(pestana: PestanaProducto): void {
    this.pestanaActiva.set(pestana);
    this.contenidoModalRef?.nativeElement.scrollTo({ top: 0 });
  }

  /** A qué pestaña pertenece cada control -- en el mismo orden en que se
   *  muestran las pestañas (general, inventario, precios, tienda), para
   *  que, si guardar() falla por validación, se cambie a la primera
   *  pestaña con un campo inválido (ver irAPestanaConError()). */
  private readonly ORDEN_CONTROLES_POR_PESTANA: { control: string; pestana: PestanaProducto }[] = [
    { control: 'nombre', pestana: 'general' },
    { control: 'codigo', pestana: 'general' },
    { control: 'categoriaProductoId', pestana: 'general' },
    { control: 'unidadMedidaId', pestana: 'general' },
    { control: 'proveedorId', pestana: 'general' },
    { control: 'descripcion', pestana: 'general' },
    { control: 'esServicio', pestana: 'inventario' },
    { control: 'nivelMinimo', pestana: 'inventario' },
    { control: 'nivelMaximo', pestana: 'inventario' },
    { control: 'manejaLotes', pestana: 'inventario' },
    { control: 'costo', pestana: 'precios' },
    { control: 'precioUnitario', pestana: 'precios' },
    { control: 'unidadCompraId', pestana: 'precios' },
    { control: 'factorConversionCompra', pestana: 'precios' },
    { control: 'destacado', pestana: 'tienda' },
    { control: 'activo', pestana: 'tienda' },
  ];

  private readonly ETIQUETA_PESTANA: Record<PestanaProducto, string> = {
    general: 'General',
    inventario: 'Inventario',
    precios: 'Precios',
    tienda: 'Tienda',
  };

  /** Cambia a la primera pestaña (en el orden de arriba) que tenga un
   *  control inválido y avisa cuál es -- se llama justo después de
   *  form.markAllAsTouched() en guardar(), así que el campo ya se ve
   *  resaltado en rojo (.edit-form input.ng-invalid.ng-touched, ver
   *  styles.scss) en cuanto esa pestaña se muestra. */
  private irAPestanaConError(): void {
    const primero = this.ORDEN_CONTROLES_POR_PESTANA.find(({ control }) => this.form.get(control)?.invalid);
    if (!primero) return;
    this.cambiarPestana(primero.pestana);
    this.toast.advertencia(`Falta un campo obligatorio en la pestaña "${this.ETIQUETA_PESTANA[primero.pestana]}".`);
  }

  protected readonly columnas: ColumnaTabla<Producto>[] = [
    { campo: 'codigo', etiqueta: 'Código', formatear: (fila) => fila.codigo ?? '—' },
    { campo: 'nombre', etiqueta: 'Nombre' },
    { campo: 'categoriaProductoId', etiqueta: 'Categoría', formatear: (fila) => this.nombreCategoria(fila.categoriaProductoId) },
    { campo: 'unidadMedidaId', etiqueta: 'Unidad', formatear: (fila) => this.nombreUnidad(fila.unidadMedidaId) },
    {
      campo: 'existencia',
      claveColumna: 'tipo',
      etiqueta: 'Tipo',
      formatear: (fila) => (fila.existencia === null ? 'Servicio' : 'Producto'),
      claseValor: (fila) => (fila.existencia === null ? 'grid-badge-muted' : 'grid-badge-warning'),
    },
    { campo: 'costo', etiqueta: 'Costo', formatear: (fila) => formatMoneda(fila.costo) },
    { campo: 'precioUnitario', etiqueta: 'Precio', formatear: (fila) => formatMoneda(fila.precioUnitario) },
    {
      campo: 'existencia',
      etiqueta: 'Existencia',
      formatear: (fila) => (fila.existencia === null ? '—' : String(existenciaTotal(fila, this.existenciasBodega()))),
    },
    { campo: 'proveedorId', etiqueta: 'Proveedor', formatear: (fila) => this.nombreProveedor(fila.proveedorId) },
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
    codigo: [''],
    categoriaProductoId: [0, [Validators.required, Validators.min(1)]],
    unidadMedidaId: [0, [Validators.required, Validators.min(1)]],
    descripcion: [''],
    costo: [0, [Validators.required, Validators.min(0)]],
    precioUnitario: [0, [Validators.required, Validators.min(0)]],
    /** No se manda tal cual al backend — decide si `existencia` sale como
     *  null (servicio) o como el número del control `existencia` de abajo
     *  (ver guardar()). */
    esServicio: [false],
    /** Opcional — null = sin mínimo definido (ver producto.model.ts). Igual
     *  que `existencia`, se oculta y se fuerza a null cuando es servicio
     *  (ver guardar()). */
    nivelMinimo: [null as number | null, [Validators.min(0)]],
    /** Opuesto a nivelMinimo — ver producto.model.ts. Mismo criterio: se
     *  oculta y se fuerza a null cuando es servicio (ver guardar()). */
    nivelMaximo: [null as number | null, [Validators.min(0)]],
    /** Opt-in — ver producto.model.ts. Igual que nivelMinimo/nivelMaximo,
     *  se oculta y se fuerza a false cuando es servicio (ver guardar()). */
    manejaLotes: [false],
    /** 0 = "Sin proveedor" (ver opcionesProveedor arriba) — se convierte a
     *  null en guardar() antes de mandarlo, igual que codigo/descripcion. */
    proveedorId: [0],
    /** 0 = "Sin unidad de compra alterna" (ver opcionesUnidadCompra arriba)
     *  — igual que proveedorId, se convierte a null en guardar(). Ver
     *  Producto.unidadCompraId/factorConversionCompra. */
    unidadCompraId: [0],
    /** Solo tiene sentido cuando unidadCompraId != 0 — se valida a mano en
     *  guardar() (no con Validators, porque depende de otro control) y se
     *  fuerza a null si unidadCompraId vuelve a "Sin unidad de compra alterna". */
    factorConversionCompra: [null as number | null, [Validators.min(0.0001)]],
    /** Resalta el producto en la sección "⭐ Destacados" del catálogo
     *  público (/tienda/:clave) — puramente de presentación. */
    destacado: [false],
    activo: [true],
  });

  ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid'); // ancho completo
    this.cargarCatalogos();
    // Ya no se llama this.cargar() aquí — la tabla arranca vacía hasta que
    // el usuario haga click en "Buscar" (ver busquedaRealizada/cambiarFiltro()).
  }

  // Sin `error` en estos 4 catálogos, un fallo de red/permiso se volvía un
  // "Uncaught (in promise)" en vez de degradarse a "sin datos todavía"
  // (conToast() ya muestra su propio toast y vuelve a lanzar el error) —
  // mismo bug ya corregido en cliente-form-modal.component.ts.
  private cargarCatalogos(): void {
    this.data.list<CategoriaProducto>('CategoriaProducto').subscribe({
      next: (c) => this.categorias.set(c),
      error: () => {},
    });
    this.data.list<UnidadMedida>('UnidadMedida').subscribe({
      next: (u) => this.unidades.set(u),
      error: () => {},
    });
    this.data.list<ExistenciaBodega>('ExistenciaBodega').subscribe({
      next: (e) => this.existenciasBodega.set(e),
      error: () => {},
    });
    this.data.list<Proveedor>('Proveedor').subscribe({
      next: (p) => this.proveedores.set(p),
      error: () => {},
    });
  }

  /** Filtro actual para Producto: nombre/código son parciales (ilike),
   *  categoriaProductoId exacto, activo solo se manda cuando NO se quieren
   *  inactivos (mandarlo en false excluiría los activos, que es lo
   *  opuesto de "Mostrar inactivos" — omitirlo trae ambos). */
  private filtroActual(): Record<string, unknown> {
    const filtro: Record<string, unknown> = {
      nombre: this.busqueda().trim() || undefined,
      codigo: this.busquedaCodigo().trim() || undefined,
    };
    if (this.filtroCategoriaId()) filtro['categoriaProductoId'] = this.filtroCategoriaId();
    if (!this.mostrarInactivos()) filtro['activo'] = true;
    return filtro;
  }

  /** Trae SOLO la página actual (paginaActual, tamaño = preferencia del
   *  usuario) del catálogo que cumple el filtro actual — nunca el catálogo
   *  completo. Antes se traían hasta 500 productos de un jalón aunque solo
   *  se fueran a mostrar 10/25/50 a la vez (según [tamanoPagina] de
   *  <app-data-table>, que de cualquier forma solo pagina EN MEMORIA lo ya
   *  traído); con un catálogo de cientos de miles de productos (p.ej. una
   *  prueba de rendimiento) eso seguía siendo una petición enorme y lenta
   *  para mostrar una sola pantalla. Ahora "Siguiente"/"Anterior" piden al
   *  servidor la página que haga falta, bajo demanda (ver
   *  irAPaginaSiguiente/irAPaginaAnterior), igual que ya hace Kanban con
   *  Ticket (ver cargarMasTickets() en kanban.component.ts, aunque ahí es
   *  "cargar más" acumulando en vez de reemplazar página por página). */
  cargar(): void {
    this.cargando.set(true);
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActual() - 1) * tamanio;
    this.data.listarPagina<Producto>('Producto', this.filtroActual(), desde, tamanio).subscribe({
      next: ({ filas, total }) => {
        this.totalProductos.set(total);
        // Si la página en la que estábamos quedó vacía (p.ej. se acaba de
        // eliminar el último producto de la última página, o un filtro
        // nuevo tiene menos páginas que la posición actual), retrocede a la
        // última página real en vez de dejar la tabla en blanco.
        if (filas.length === 0 && this.paginaActual() > 1 && total > 0) {
          this.paginaActual.set(Math.max(1, Math.ceil(total / tamanio)));
          this.cargar();
          return;
        }
        this.productos.set(filas);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  /** Cualquier cambio de filtro (nombre, código, categoría, mostrar
   *  inactivos) vuelve a la página 1 — quedarse en, digamos, la página 4 de
   *  un filtro nuevo casi siempre cae fuera de rango o muestra resultados
   *  que no tienen relación con lo que se acaba de buscar. */
  protected cambiarFiltro(): void {
    this.busquedaRealizada.set(true);
    this.paginaActual.set(1);
    this.cargar();
  }

  protected irAPaginaAnterior(): void {
    if (this.paginaActual() <= 1) return;
    this.paginaActual.update((p) => p - 1);
    this.cargar();
  }

  protected irAPaginaSiguiente(): void {
    if (this.paginaActual() >= this.totalPaginas()) return;
    this.paginaActual.update((p) => p + 1);
    this.cargar();
  }

  nuevo(): void {
    if (this.categorias().length === 0 || this.unidades().length === 0) {
      this.toast.advertencia('Antes crea al menos una Categoría de producto y una Unidad de medida (Inventario → Catálogos).');
      return;
    }
    this.productoEnEdicion.set(null);
    this.fotoActual.set('');
    this.fotoAmpliada.set(false);
    this.pestanaActiva.set('general');
    this.form.reset({
      id: 0,
      nombre: '',
      codigo: '',
      categoriaProductoId: 0,
      unidadMedidaId: 0,
      descripcion: '',
      costo: 0,
      precioUnitario: 0,
      esServicio: false,
      nivelMinimo: null,
      nivelMaximo: null,
      manejaLotes: false,
      proveedorId: 0,
      unidadCompraId: 0,
      factorConversionCompra: null,
      destacado: false,
      activo: true,
    });
    this.modalAbierto.set(true);
  }

  editar(producto: Producto): void {
    this.productoEnEdicion.set(producto);
    this.fotoActual.set(producto.foto ?? '');
    this.fotoAmpliada.set(false);
    this.pestanaActiva.set('general');
    this.form.reset({
      id: producto.id,
      nombre: producto.nombre,
      codigo: producto.codigo ?? '',
      categoriaProductoId: producto.categoriaProductoId,
      unidadMedidaId: producto.unidadMedidaId,
      descripcion: producto.descripcion ?? '',
      costo: producto.costo,
      precioUnitario: producto.precioUnitario,
      esServicio: producto.existencia === null,
      nivelMinimo: producto.nivelMinimo ?? null,
      nivelMaximo: producto.nivelMaximo ?? null,
      manejaLotes: producto.manejaLotes ?? false,
      proveedorId: producto.proveedorId ?? 0,
      unidadCompraId: producto.unidadCompraId ?? 0,
      factorConversionCompra: producto.factorConversionCompra ?? null,
      destacado: producto.destacado ?? false,
      activo: producto.activo !== false,
    });
    this.modalAbierto.set(true);
  }

  /** Pone en el campo "Código / SKU" lo que se acaba de capturar con la
   *  cámara (homologación nov-2026: antes existía un segundo cuadro de
   *  texto solo para escanear, aparte de "Código / SKU" -- ver
   *  app-escaneo-codigo [soloBoton]="true" en el template, que ahora solo
   *  aporta el botón 📷 y escribe directo en este mismo campo). Un lector
   *  USB/Bluetooth no pasa por aquí -- teclea directo en el <input> de
   *  "Código / SKU" como cualquier campo de texto, sin necesitar este
   *  método. Avisa (sin bloquear) si ya hay OTRO producto activo con ese
   *  mismo código, ya que el código también se usa para buscar por
   *  escaneo en Movimientos entre bodegas/Conteo físico/Órdenes de compra
   *  y un duplicado haría que ese escaneo encuentre el producto
   *  equivocado. */
  asignarCodigoEscaneado(codigo: string): void {
    this.form.patchValue({ codigo });
    const codigoLimpio = codigo.trim();
    if (!codigoLimpio) return;
    // Antes se buscaba el duplicado solo entre los productos ya cargados en
    // memoria (this.productos()) — con la paginación real de cargar(), esta
    // pantalla normalmente solo tiene cargada UNA página a la vez, así que
    // ese chequeo ya no cubre el catálogo completo. Se pregunta directo al
    // servidor por ese código exacto en su lugar (aviso best-effort, igual
    // que antes: no bloquea guardar si hay un duplicado real).
    const idActual = this.productoEnEdicion()?.id ?? 0;
    this.data.listarPagina<Producto>('Producto', { codigo: codigoLimpio, activo: true }, 0, 5).subscribe({
      next: ({ filas }) => {
        const duplicado = filas.find(
          (p) => p.id !== idActual && (p.codigo ?? '').trim().toLowerCase() === codigoLimpio.toLowerCase(),
        );
        if (duplicado) {
          this.toast.advertencia(`Ojo: "${duplicado.nombre}" ya tiene este mismo código.`);
        }
      },
      error: () => {},
    });
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.irAPestanaConError();
      return;
    }
    // unidadCompraId != 0 ("Sin unidad de compra alterna") exige un factor
    // > 0 — no se valida con Validators porque depende de otro control.
    if (this.form.controls.unidadCompraId.value !== 0 && !this.form.controls.factorConversionCompra.value) {
      this.cambiarPestana('precios');
      this.toast.advertencia('Captura a cuántas unidades base equivale la unidad de compra (factor de conversión).');
      return;
    }

    const valor = this.form.getRawValue();
    const { esServicio, nivelMinimo, nivelMaximo, manejaLotes, ...resto } = valor;
    // PENDIENTE 2.1 ("Correcciones y mejoras pendientes", 2026-11): la
    // existencia ya no se captura en este formulario, en NINGÚN caso --
    // un producto nuevo siempre inicia en 0, uno existente conserva
    // exactamente la que ya tenía (nunca se lee de un control del form).
    const existenciaActual = this.productoEnEdicion()?.existencia ?? 0;
    const payload = {
      ...resto,
      codigo: resto.codigo || null,
      descripcion: resto.descripcion || null,
      existencia: esServicio ? null : existenciaActual,
      nivelMinimo: esServicio ? null : nivelMinimo,
      nivelMaximo: esServicio ? null : nivelMaximo,
      manejaLotes: esServicio ? false : manejaLotes,
      proveedorId: resto.proveedorId || null,
      unidadCompraId: resto.unidadCompraId || null,
      factorConversionCompra: resto.unidadCompraId ? resto.factorConversionCompra : null,
      foto: this.fotoActual(),
    };
    const esEdicion = this.productoEnEdicion() !== null;
    const peticion = esEdicion
      ? this.data.modificacion<Producto>('Producto', payload)
      : this.data.alta<Producto>('Producto', payload);

    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? 'Producto actualizado.' : 'Producto creado.');
        this.modalAbierto.set(false);
        if (this.busquedaRealizada()) this.cargar();
      },
      // conToast() ya muestra su propio toast de error y vuelve a lanzar —
      // sin este handler, un guardado fallido quedaba como "Uncaught (in
      // promise)" en vez de solo dejar el modal abierto para reintentar.
      error: () => {},
    });
  }

  /** Navega a la pantalla de nivel mínimo por bodega de este producto (ver
   *  nivel-minimo-bodega.component.ts) — mismo patrón que verProductos() en
   *  proveedores.component.ts. */
  verNivelMinimoBodega(producto: Producto): void {
    this.router.navigate(['/inventario/productos', producto.id, 'nivel-minimo']);
  }

  /** Navega a la pantalla de opciones/variantes con costo de este producto
   *  (ver opciones-producto.component.ts) — mismo patrón de ruta que
   *  verNivelMinimoBodega() arriba. Solo importan si la empresa usa
   *  /tienda (tienda pública). */
  verOpciones(producto: Producto): void {
    this.router.navigate(['/inventario/productos', producto.id, 'opciones']);
  }

  /** app-data-table espera una FUNCIÓN para el texto del segundo botón
   *  extra (accionExtra2EtiquetaFn), no un string fijo — mismo patrón que
   *  etiquetaEntrar() en empresas.component.ts. Antes se pasaba
   *  accionExtra2Etiqueta="Opciones" (un string suelto que ese input no
   *  existe), así que el botón nunca aparecía y tsc no lo marcaba porque
   *  es un atributo HTML normal, no un binding de Angular.
   *  Icono en vez de texto (⚙️) — accionExtra2 ya se dibuja cuadrado/
   *  compacto por defecto (grid-action-icon, ver data-table.component.html),
   *  mismo criterio visual que accionExtraTitulo abajo. El texto completo
   *  sigue disponible como tooltip vía accionExtra2Titulo. */
  protected readonly etiquetaOpciones = (): string => '⚙️';

  pedirEliminar(producto: Producto): void {
    this.productoAEliminar.set(producto);
  }

  confirmarEliminar(): void {
    const producto = this.productoAEliminar();
    if (!producto) return;

    this.data.baja('Producto', producto.id).subscribe({
      next: () => {
        this.toast.exito('Producto eliminado.');
        this.productoAEliminar.set(null);
        if (this.busquedaRealizada()) this.cargar();
      },
      // Igual que en guardar(): sin esto, una baja fallida (p.ej. producto
      // referenciado en otra tabla) quedaba como "Uncaught (in promise)".
      error: () => {},
    });
  }

  // ── Importación masiva ──────────────────────────────────────────────

  protected readonly modalImportarAbierto = signal(false);
  protected readonly filasImportacion = signal<FilaImportacion[]>([]);
  protected readonly validando = signal(false); // valida en el servidor justo después de leer el archivo (preview).
  protected readonly importando = signal(false); // llamada final al confirmar -- una sola, ya no un ciclo por renglón.
  protected readonly resumenImportacion = signal<{ creados: number } | null>(null);

  private readonly sb = inject(SupabaseService).cliente;
  /** Generado una sola vez por archivo elegido (ver archivoSeleccionado) y
   *  reutilizado en cada reintento de confirmarImportacion -- mismo patrón
   *  que operacionId en movimiento-masivo.component.ts: nunca se regenera
   *  en un reintento, así un doble clic, un reintento de red o dos
   *  pestañas mandando el mismo archivo nunca vuelven a crear productos
   *  por segunda vez (lo detiene la propia función en el servidor). */
  private operacionId: string | null = null;

  protected readonly filasConError = computed(() => this.filasImportacion().filter((f) => f.error !== null));
  protected readonly filasConAdvertencia = computed(() => this.filasImportacion().filter((f) => f.error === null && f.advertencia !== null));
  protected readonly filasListas = computed(() => this.filasImportacion().filter((f) => f.error === null && f.advertencia === null));

  /** Plantilla descargable: mismos encabezados que espera importarArchivo(),
   *  con dos renglones de ejemplo (un producto físico y un servicio) usando
   *  claves reales si ya hay catálogos capturados, o un ejemplo genérico si
   *  todavía no hay ninguno. */
  descargarPlantilla(): void {
    const claveCategoria = this.categorias()[0]?.clave ?? 'GENERAL';
    const claveUnidad = this.unidades()[0]?.clave ?? 'PZA';
    const nombreProveedor = this.proveedores()[0]?.nombre ?? '';
    const filas = [
      {
        nombre: 'Ejemplo producto físico',
        codigo: 'SKU-001',
        categoria: claveCategoria,
        unidad: claveUnidad,
        costo: '50.00',
        precio: '89.90',
        existencia: '10',
        activo: 'si',
        descripcion: 'Descripción opcional del producto',
        nivel_minimo: '5',
        nivel_maximo: '50',
        proveedor: nombreProveedor,
        unidad_compra: claveUnidad,
        factor_conversion_compra: '1',
        maneja_lotes: 'no',
        destacado: 'no',
      },
      {
        nombre: 'Ejemplo servicio',
        codigo: '',
        categoria: claveCategoria,
        unidad: claveUnidad,
        costo: '0',
        precio: '350.00',
        existencia: '',
        activo: 'si',
        descripcion: '',
        nivel_minimo: '',
        nivel_maximo: '',
        proveedor: '',
        unidad_compra: '',
        factor_conversion_compra: '',
        maneja_lotes: '',
        destacado: 'si',
      },
    ];
    exportarCsv(
      'plantilla-productos.csv',
      ENCABEZADOS_CSV.map((clave) => ({ clave, etiqueta: clave })),
      filas,
    );
    this.toast.info(
      '"categoria" y "unidad" deben coincidir con la Clave de esos catálogos; "proveedor" coincide por Nombre (no tiene Clave). ' +
        '"existencia" vacío = servicio (en servicios se ignoran nivel_minimo/nivel_maximo/maneja_lotes). ' +
        'Si capturas "unidad_compra" debes capturar también "factor_conversion_compra". "maneja_lotes" y "destacado" aceptan sí/no, igual que "activo".',
    );
  }

  /** Convierte un renglón crudo del CSV (puro texto, sin validar nada
   *  todavía) en una FilaImportacion -- la validación real la hace
   *  validarEnServidor() llamando a la función en Postgres. */
  private aFilaImportacion(campos: string[], numeroRenglon: number): FilaImportacion {
    const [
      nombre = '',
      codigo = '',
      categoriaTexto = '',
      unidadTexto = '',
      costoTexto = '',
      precioTexto = '',
      existenciaTexto = '',
      activoTexto = '',
      descripcionTexto = '',
      nivelMinimoTexto = '',
      nivelMaximoTexto = '',
      proveedorTexto = '',
      unidadCompraTexto = '',
      factorConversionCompraTexto = '',
      manejaLotesTexto = '',
      destacadoTexto = '',
    ] = campos;

    return {
      numero: numeroRenglon,
      nombre: nombre.trim(),
      codigo: codigo.trim(),
      categoriaTexto: categoriaTexto.trim(),
      unidadTexto: unidadTexto.trim(),
      costoTexto: costoTexto.trim(),
      precioTexto: precioTexto.trim(),
      existenciaTexto: existenciaTexto.trim(),
      activoTexto: activoTexto.trim(),
      descripcionTexto: descripcionTexto.trim(),
      nivelMinimoTexto: nivelMinimoTexto.trim(),
      nivelMaximoTexto: nivelMaximoTexto.trim(),
      proveedorTexto: proveedorTexto.trim(),
      unidadCompraTexto: unidadCompraTexto.trim(),
      factorConversionCompraTexto: factorConversionCompraTexto.trim(),
      manejaLotesTexto: manejaLotesTexto.trim(),
      destacadoTexto: destacadoTexto.trim(),
      error: null,
      advertencia: null,
    };
  }

  /** Payload en snake_case -- exactamente las llaves que espera
   *  inventario.fn_importar_productos_masivo (p_filas). */
  private aPayloadServidor(fila: FilaImportacion): Record<string, unknown> {
    return {
      numero: fila.numero,
      nombre: fila.nombre,
      codigo: fila.codigo,
      categoria: fila.categoriaTexto,
      unidad: fila.unidadTexto,
      costo: fila.costoTexto,
      precio: fila.precioTexto,
      existencia: fila.existenciaTexto,
      activo: fila.activoTexto,
      descripcion: fila.descripcionTexto,
      nivel_minimo: fila.nivelMinimoTexto,
      nivel_maximo: fila.nivelMaximoTexto,
      proveedor: fila.proveedorTexto,
      unidad_compra: fila.unidadCompraTexto,
      factor_conversion_compra: fila.factorConversionCompraTexto,
      maneja_lotes: fila.manejaLotesTexto,
      destacado: fila.destacadoTexto,
    };
  }

  private async llamarRpcImportar(soloValidar: boolean): Promise<ResultadoImportacion> {
    const { data, error } = await this.sb.schema('inventario').rpc('fn_importar_productos_masivo', {
      p_filas: this.filasImportacion().map((f) => this.aPayloadServidor(f)),
      p_operacion_id: this.operacionId,
      p_solo_validar: soloValidar,
    });
    if (error) throw error;
    return data as ResultadoImportacion;
  }

  /** Aplica sobre las filas ya mostradas los errores/advertencias que
   *  regresó el servidor, emparejando por número de renglón. */
  private aplicarResultadoValidacion(resultado: ResultadoImportacion): void {
    const erroresPorNumero = new Map(resultado.errores.map((e) => [e.numero, e.mensaje]));
    const advertenciasPorNumero = new Map<number, string[]>();
    for (const advertencia of resultado.advertencias) {
      const lista = advertenciasPorNumero.get(advertencia.numero) ?? [];
      lista.push(advertencia.mensaje);
      advertenciasPorNumero.set(advertencia.numero, lista);
    }
    this.filasImportacion.update((filas) =>
      filas.map((fila) => ({
        ...fila,
        error: erroresPorNumero.get(fila.numero) ?? null,
        advertencia: advertenciasPorNumero.get(fila.numero)?.join(' ') ?? null,
      })),
    );
  }

  /** Valida TODO el archivo en el servidor (p_solo_validar: true -- nunca
   *  inserta nada) justo después de leerlo, para la vista previa. Es la
   *  única validación real: ya no existe una copia en Angular (antes sí,
   *  100% en el navegador -- ver la auditoría). */
  private async validarEnServidor(): Promise<void> {
    this.validando.set(true);
    try {
      const resultado = await this.llamarRpcImportar(true);
      this.aplicarResultadoValidacion(resultado);
    } catch (error) {
      this.toast.error((error as Error)?.message ?? 'No se pudo validar el archivo en el servidor.');
    } finally {
      this.validando.set(false);
    }
  }

  async archivoSeleccionado(evento: Event): Promise<void> {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = ''; // permite volver a elegir el mismo archivo después
    if (!archivo) return;

    const texto = await archivo.text();
    const filas = parsearCsv(texto);
    if (filas.length === 0) {
      this.toast.advertencia('El archivo está vacío.');
      return;
    }

    // La primera fila se asume encabezado — no se valida su contenido, solo se descarta.
    const renglones = filas.slice(1);
    if (renglones.length === 0) {
      this.toast.advertencia('El archivo no trae renglones de datos, solo el encabezado.');
      return;
    }
    // Mismo tope que valida inventario.fn_importar_productos_masivo (sección F del mandato).
    if (renglones.length > 5000) {
      this.toast.error(`El archivo trae ${renglones.length} renglones -- el máximo por importación es 5,000. Divídelo en partes.`);
      return;
    }

    this.resumenImportacion.set(null);
    this.operacionId = crypto.randomUUID(); // archivo nuevo = operación nueva.
    this.filasImportacion.set(renglones.map((campos, indice) => this.aFilaImportacion(campos, indice + 2)));
    this.modalImportarAbierto.set(true);
    await this.validarEnServidor();
  }

  cancelarImportacion(): void {
    this.modalImportarAbierto.set(false);
    this.filasImportacion.set([]);
    this.resumenImportacion.set(null);
    this.operacionId = null;
  }

  /** Una sola llamada al servidor -- ya no un ciclo de altas una por una
   *  (sección F del mandato). El mismo operacionId se reutiliza en cada
   *  reintento (nunca se regenera aquí), así que un reintento tras un
   *  error de red es idempotente: si la primera llamada sí había llegado
   *  a completarse en Postgres, esta regresa "duplicada" en vez de crear
   *  todo por segunda vez (secciones G/H del mandato). "Todo o nada
   *  SIEMPRE" (decisión del usuario, 4-nov-2026) es automático: la
   *  función nunca inserta nada si queda algún error de validación. */
  async confirmarImportacion(): Promise<void> {
    if (this.importando()) return; // doble clic/Enter repetido -- necesario pero no suficiente (ver operacionId).
    if (this.filasConError().length > 0) return; // defensivo -- el botón ya está deshabilitado en este caso.
    if (!this.operacionId) return;

    this.importando.set(true);
    try {
      const resultado = await this.llamarRpcImportar(false);
      if (resultado.duplicada) {
        this.resumenImportacion.set({ creados: resultado.productosCreados });
        this.toast.info(
          `Esta importación ya se había hecho (${resultado.productosCreados} producto${resultado.productosCreados === 1 ? '' : 's'}) -- no se repitió.`,
        );
      } else if (!resultado.ok) {
        // El servidor encontró algo que el navegador no vio en la vista
        // previa (p.ej. otro usuario acaba de dar de alta el mismo código
        // entre la vista previa y este clic) -- se muestra igual que un
        // error de validación; no se creó nada.
        this.aplicarResultadoValidacion(resultado);
        this.toast.error('El archivo todavía tiene errores -- revisa los renglones marcados. No se creó ningún producto.');
      } else {
        this.resumenImportacion.set({ creados: resultado.productosCreados });
        this.toast.exito(`${resultado.productosCreados} producto${resultado.productosCreados === 1 ? '' : 's'} creado${resultado.productosCreados === 1 ? '' : 's'}.`);
        if (this.busquedaRealizada()) this.cargar();
      }
    } catch (error) {
      // Nunca se muestra éxito si Postgres no confirmó -- el operacionId NO
      // se regenera aquí a propósito: un reintento manda la MISMA
      // operación, nunca una nueva (ver comentario en operacionId arriba).
      this.toast.error((error as Error)?.message ?? 'No se pudo completar la importación.');
    } finally {
      this.importando.set(false);
    }
  }

  // ── Foto del producto ────────────────────────────────────────────────
  /** Igual que redimensionarFoto() en miembros.component.ts (FileReader →
   *  <canvas> → JPEG comprimido), para no guardar fotos de cámara de varios
   *  MB tal cual en IndexedDB. */
  private redimensionarFoto(archivo: File): Promise<string> {
    const MAX_LADO = 480;
    return new Promise((resolve, reject) => {
      const lector = new FileReader();
      lector.onload = () => {
        const imagen = new Image();
        imagen.onload = () => {
          let { width, height } = imagen;
          if (width > height && width > MAX_LADO) {
            height = Math.round((height * MAX_LADO) / width);
            width = MAX_LADO;
          } else if (height >= width && height > MAX_LADO) {
            width = Math.round((width * MAX_LADO) / height);
            height = MAX_LADO;
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const contexto = canvas.getContext('2d');
          if (!contexto) {
            reject(new Error('Sin contexto de canvas.'));
            return;
          }
          contexto.drawImage(imagen, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        imagen.onerror = () => reject(new Error('No se pudo leer la imagen.'));
        imagen.src = lector.result as string;
      };
      lector.onerror = () => reject(new Error('No se pudo leer el archivo.'));
      lector.readAsDataURL(archivo);
    });
  }

  onFotoSeleccionada(evento: Event): void {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.[0];
    if (!archivo) return;

    if (!archivo.type.startsWith('image/')) {
      this.toast.advertencia('Elige un archivo de imagen (JPG, PNG, etc.).');
      input.value = '';
      return;
    }
    if (archivo.size > 8 * 1024 * 1024) {
      this.toast.advertencia('La imagen no puede pesar más de 8 MB.');
      input.value = '';
      return;
    }

    this.redimensionarFoto(archivo)
      .then((dataUrl) => this.fotoActual.set(dataUrl))
      .catch(() => this.toast.error('No se pudo procesar la imagen. Intenta con otra.'))
      .finally(() => {
        input.value = '';
      });
  }

  quitarFoto(input: HTMLInputElement): void {
    this.fotoActual.set('');
    this.fotoAmpliada.set(false);
    input.value = '';
  }

  // ── Imprimir etiquetas con código de barras ──
  // Toda la lógica (búsqueda server-side, selección masiva, copias,
  // impresión) vive en ImprimirEtiquetasComponent (homologación integral,
  // nov-2026) -- este componente solo controla si el modal está abierto,
  // igual que ya hace con MovimientoMasivoComponent en Movimientos entre
  // bodegas.
  protected readonly modalEtiquetasAbierto = signal(false);

  abrirModalEtiquetas(): void {
    this.modalEtiquetasAbierto.set(true);
  }
}

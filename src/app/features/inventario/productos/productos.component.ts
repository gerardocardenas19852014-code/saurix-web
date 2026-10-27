import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
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
import { formatMoneda, existenciaTotal, tieneBodegaAsignada } from './producto.util';
import { ExistenciaBodega } from '../movimientos-bodega/existencia-bodega.model';
import { EscaneoCodigoComponent } from '../../../shared/components/escaneo-codigo/escaneo-codigo.component';
import JsBarcode from 'jsbarcode';

/** Una fila ya parseada del CSV de importación masiva, con su validación
 *  resuelta — ver importarArchivo()/validarFila() más abajo. `payload` solo
 *  viene lleno cuando `error` es null (fila lista para mandar a Alta). */
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
  error: string | null;
  payload: Omit<Producto, 'id'> | null;
}

const ENCABEZADOS_CSV = ['nombre', 'codigo', 'categoria', 'unidad', 'costo', 'precio', 'existencia', 'activo'] as const;

@Component({
  selector: 'app-productos',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, SelectBuscableComponent, EscaneoCodigoComponent],
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
  private static readonly LIMITE_BUSQUEDA_ETIQUETAS = 200;

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

  protected readonly modalAbierto = signal(false);
  protected readonly productoEnEdicion = signal<Producto | null>(null);
  protected readonly productoAEliminar = signal<Producto | null>(null);
  /** true cuando el producto en edición ya tiene al menos una bodega
   *  asignada (ver tieneBodegaAsignada() en producto.util.ts) — a partir de
   *  ahí "Existencia inicial" se vuelve de solo lectura: cambiarla de verdad
   *  se hace desde Movimientos entre bodegas, para no tener dos números que
   *  puedan desincronizarse. */
  protected readonly existenciaBloqueada = signal(false);
  /** Foto del producto en edición (base64, ya redimensionada) — aparte del
   *  formulario reactivo por lo mismo que fotoActual en miembros.component.ts:
   *  más simple de resetear/precargar que meterla como FormControl. */
  protected readonly fotoActual = signal<string>('');
  /** true mientras el visor de foto a tamaño completo está abierto (ver
   *  guardar()/quitarFoto() no la tocan; solo se cierra al abrir/cerrar el
   *  modal o con el botón ✕ del visor). */
  protected readonly fotoAmpliada = signal(false);

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
    existencia: [0, [Validators.min(0)]],
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
    this.existenciaBloqueada.set(false);
    this.fotoActual.set('');
    this.fotoAmpliada.set(false);
    this.form.controls.existencia.enable();
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
      existencia: 0,
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
    const bloqueada = tieneBodegaAsignada(producto.id, this.existenciasBodega());
    this.existenciaBloqueada.set(bloqueada);
    this.fotoActual.set(producto.foto ?? '');
    this.fotoAmpliada.set(false);
    /** Deshabilitar de verdad el FormControl (no solo el atributo HTML) es
     *  necesario: ReactiveFormsModule reescribe la propiedad `disabled` del
     *  <input> en cada ciclo de detección de cambios según el estado del
     *  control, así que un `[attr.disabled]` puesto solo en la plantilla
     *  pierde esa pelea y el campo queda editable de todas formas. */
    if (bloqueada) {
      this.form.controls.existencia.disable();
    } else {
      this.form.controls.existencia.enable();
    }
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
      existencia: existenciaTotal(producto, this.existenciasBodega()),
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

  /** Pone en el campo "Código / SKU" lo que se acaba de escanear (lector
   *  USB/Bluetooth o cámara — ver app-escaneo-codigo) — [limpiarDespues]
   *  en false en el template para que se vea el código capturado. Avisa
   *  (sin bloquear) si ya hay OTRO producto activo con ese mismo código,
   *  ya que ahora se usa para buscar por escaneo en Movimientos entre
   *  bodegas/Conteo físico/Órdenes de compra y un duplicado haría que el
   *  escaneo encuentre el producto equivocado. */
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
      return;
    }
    // unidadCompraId != 0 ("Sin unidad de compra alterna") exige un factor
    // > 0 — no se valida con Validators porque depende de otro control.
    if (this.form.controls.unidadCompraId.value !== 0 && !this.form.controls.factorConversionCompra.value) {
      this.toast.advertencia('Captura a cuántas unidades base equivale la unidad de compra (factor de conversión).');
      return;
    }

    const valor = this.form.getRawValue();
    const { esServicio, existencia, nivelMinimo, nivelMaximo, manejaLotes, ...resto } = valor;
    const payload = {
      ...resto,
      codigo: resto.codigo || null,
      descripcion: resto.descripcion || null,
      existencia: esServicio ? null : existencia,
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
  protected readonly importando = signal(false);
  protected readonly progresoImportacion = signal('');
  protected readonly resumenImportacion = signal<{ importados: number; omitidos: number } | null>(null);

  protected readonly filasValidas = computed(() => this.filasImportacion().filter((f) => f.error === null));
  protected readonly filasConError = computed(() => this.filasImportacion().filter((f) => f.error !== null));

  /** Plantilla descargable: mismos encabezados que espera importarArchivo(),
   *  con dos renglones de ejemplo (un producto físico y un servicio) usando
   *  claves reales si ya hay catálogos capturados, o un ejemplo genérico si
   *  todavía no hay ninguno. */
  descargarPlantilla(): void {
    const claveCategoria = this.categorias()[0]?.clave ?? 'GENERAL';
    const claveUnidad = this.unidades()[0]?.clave ?? 'PZA';
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
      },
    ];
    exportarCsv(
      'plantilla-productos.csv',
      ENCABEZADOS_CSV.map((clave) => ({ clave, etiqueta: clave })),
      filas,
    );
    this.toast.info('La columna "categoria" y "unidad" deben coincidir con la Clave de esos catálogos. "existencia" vacío = servicio.');
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

    this.resumenImportacion.set(null);
    this.filasImportacion.set(renglones.map((campos, indice) => this.validarFila(campos, indice + 2)));
    this.modalImportarAbierto.set(true);
  }

  /** `numeroRenglon` es el número de línea real del archivo (contando el
   *  encabezado como línea 1) — así un error apunta al mismo renglón que el
   *  usuario vería si abre el CSV en Excel. */
  private validarFila(campos: string[], numeroRenglon: number): FilaImportacion {
    const [nombre = '', codigo = '', categoriaTexto = '', unidadTexto = '', costoTexto = '', precioTexto = '', existenciaTexto = '', activoTexto = ''] = campos;

    const base: Omit<FilaImportacion, 'error' | 'payload'> = {
      numero: numeroRenglon,
      nombre: nombre.trim(),
      codigo: codigo.trim(),
      categoriaTexto: categoriaTexto.trim(),
      unidadTexto: unidadTexto.trim(),
      costoTexto: costoTexto.trim(),
      precioTexto: precioTexto.trim(),
      existenciaTexto: existenciaTexto.trim(),
      activoTexto: activoTexto.trim(),
    };

    if (!base.nombre) {
      return { ...base, error: 'Falta el nombre.', payload: null };
    }

    const categoria = this.categorias().find((c) => c.clave.toLowerCase() === base.categoriaTexto.toLowerCase());
    if (!categoria) {
      return { ...base, error: `La categoría "${base.categoriaTexto}" no existe (revisa la Clave).`, payload: null };
    }

    const unidad = this.unidades().find((u) => u.clave.toLowerCase() === base.unidadTexto.toLowerCase());
    if (!unidad) {
      return { ...base, error: `La unidad "${base.unidadTexto}" no existe (revisa la Clave).`, payload: null };
    }

    const costo = base.costoTexto === '' ? 0 : Number(base.costoTexto);
    if (Number.isNaN(costo) || costo < 0) {
      return { ...base, error: `Costo inválido: "${base.costoTexto}".`, payload: null };
    }

    if (base.precioTexto === '') {
      return { ...base, error: 'Falta el precio.', payload: null };
    }
    const precio = Number(base.precioTexto);
    if (Number.isNaN(precio) || precio < 0) {
      return { ...base, error: `Precio inválido: "${base.precioTexto}".`, payload: null };
    }

    let existencia: number | null = null;
    if (base.existenciaTexto !== '') {
      existencia = Number(base.existenciaTexto);
      if (Number.isNaN(existencia) || existencia < 0) {
        return { ...base, error: `Existencia inválida: "${base.existenciaTexto}".`, payload: null };
      }
    }

    const activoTextoNormalizado = base.activoTexto.toLowerCase();
    const activo = !['no', 'false', '0'].includes(activoTextoNormalizado);

    return {
      ...base,
      error: null,
      payload: {
        nombre: base.nombre,
        codigo: base.codigo || null,
        categoriaProductoId: categoria.id,
        unidadMedidaId: unidad.id,
        descripcion: null,
        costo,
        precioUnitario: precio,
        existencia,
        nivelMinimo: null, // el CSV no trae esta columna — se define luego, por producto, en Productos.
        nivelMaximo: null, // idem — se asigna después, en Productos.
        manejaLotes: false, // idem — se activa después, por producto, en Productos.
        destacado: false, // idem — se marca después, por producto, en Productos.
        proveedorId: null, // idem — se asigna después, en Productos.
        unidadCompraId: null, // idem — se asigna después, en Productos.
        factorConversionCompra: null,
        activo,
      },
    };
  }

  cancelarImportacion(): void {
    this.modalImportarAbierto.set(false);
    this.filasImportacion.set([]);
    this.resumenImportacion.set(null);
  }

  async confirmarImportacion(): Promise<void> {
    const validas = this.filasValidas();
    if (validas.length === 0) return;

    this.importando.set(true);
    let importados = 0;
    const errores: string[] = [];

    for (let i = 0; i < validas.length; i++) {
      const fila = validas[i];
      this.progresoImportacion.set(`Importando ${i + 1}/${validas.length}: ${fila.nombre}…`);
      try {
        await firstValueFrom(this.data.alta<Producto>('Producto', fila.payload!));
        importados++;
      } catch (error) {
        errores.push(`Renglón ${fila.numero} (${fila.nombre}): ${(error as Error)?.message ?? 'error desconocido'}.`);
      }
    }

    this.importando.set(false);
    this.progresoImportacion.set('');
    this.resumenImportacion.set({ importados, omitidos: this.filasConError().length + errores.length });

    if (errores.length > 0) {
      this.filasImportacion.update((filas) => [
        ...filas.filter((f) => f.error !== null),
        ...errores.map((mensaje, indice) => ({
          numero: -1 - indice,
          nombre: '',
          codigo: '',
          categoriaTexto: '',
          unidadTexto: '',
          costoTexto: '',
          precioTexto: '',
          existenciaTexto: '',
          activoTexto: '',
          error: mensaje,
          payload: null,
        })),
      ]);
    } else {
      this.filasImportacion.set(this.filasImportacion().filter((f) => f.error !== null));
    }

    this.toast.exito(`Importación terminada: ${importados} creado${importados === 1 ? '' : 's'}.`);
    if (this.busquedaRealizada()) this.cargar();
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
  // Modal de selección: qué productos (con código/SKU) y cuántas copias de
  // cada uno — ver imprimirEtiquetas() más abajo, que imprime en una
  // ventana nueva aparte, no desde esta misma pantalla.
  protected readonly modalEtiquetasAbierto = signal(false);
  protected readonly busquedaEtiquetas = signal('');
  protected readonly cargandoEtiquetas = signal(false);
  protected readonly seleccionEtiquetas = signal<Set<number>>(new Set());
  protected readonly cantidadEtiquetas = signal<Record<number, number>>({});

  /** Resultados de la búsqueda del modal "Imprimir etiquetas" — a
   *  diferencia de antes (computed sobre this.productos(), que solo tenía
   *  sentido cuando esa señal traía el catálogo completo), ahora es su
   *  propia señal llenada por buscarProductosEtiquetas(), que pregunta al
   *  servidor directo: la tabla principal ya solo mantiene en memoria la
   *  página actual (ver cargar()), así que buscar aquí contra eso dejaría
   *  de encontrar productos que no estén en esa página. */
  protected readonly productosParaEtiquetas = signal<Producto[]>([]);

  protected readonly totalEtiquetasSeleccionadas = computed(() =>
    Array.from(this.seleccionEtiquetas()).reduce((acc, id) => acc + this.cantidadEtiquetaDe(id), 0),
  );

  abrirModalEtiquetas(): void {
    this.busquedaEtiquetas.set('');
    this.seleccionEtiquetas.set(new Set());
    this.cantidadEtiquetas.set({});
    this.productosParaEtiquetas.set([]);
    this.modalEtiquetasAbierto.set(true);
    this.buscarProductosEtiquetas();
  }

  /** Dispara la búsqueda server-side del modal (ver productosParaEtiquetas).
   *  El cuadro de búsqueda cubre nombre Y código a la vez (igual que el
   *  comportamiento anterior en memoria): primero intenta por nombre
   *  (parcial); si no hay texto o si no encontró nada, intenta por código
   *  — así un código exacto que no haga match por nombre igual aparece. */
  protected buscarProductosEtiquetas(): void {
    this.cargandoEtiquetas.set(true);
    const texto = this.busquedaEtiquetas().trim();
    this.data
      .listarPagina<Producto>(
        'Producto',
        { activo: true, nombre: texto || undefined },
        0,
        ProductosComponent.LIMITE_BUSQUEDA_ETIQUETAS,
      )
      .subscribe({
        next: ({ filas }) => {
          if (filas.length > 0 || !texto) {
            this.productosParaEtiquetas.set(this.ordenarPorNombre(filas));
            this.cargandoEtiquetas.set(false);
            return;
          }
          this.data
            .listarPagina<Producto>('Producto', { activo: true, codigo: texto }, 0, ProductosComponent.LIMITE_BUSQUEDA_ETIQUETAS)
            .subscribe({
              next: ({ filas: filasPorCodigo }) => {
                this.productosParaEtiquetas.set(this.ordenarPorNombre(filasPorCodigo));
                this.cargandoEtiquetas.set(false);
              },
              error: () => this.cargandoEtiquetas.set(false),
            });
        },
        error: () => this.cargandoEtiquetas.set(false),
      });
  }

  private ordenarPorNombre(filas: Producto[]): Producto[] {
    return [...filas].sort((a, b) => a.nombre.localeCompare(b.nombre));
  }

  estaSeleccionadoParaEtiqueta(id: number): boolean {
    return this.seleccionEtiquetas().has(id);
  }

  toggleSeleccionEtiqueta(id: number): void {
    this.seleccionEtiquetas.update((actual) => {
      const nuevo = new Set(actual);
      if (nuevo.has(id)) {
        nuevo.delete(id);
      } else {
        nuevo.add(id);
      }
      return nuevo;
    });
  }

  cantidadEtiquetaDe(id: number): number {
    return this.cantidadEtiquetas()[id] ?? 1;
  }

  actualizarCantidadEtiqueta(id: number, valor: string): void {
    const numero = Math.max(1, Math.round(Number(valor) || 1));
    this.cantidadEtiquetas.update((actual) => ({ ...actual, [id]: numero }));
  }

  /** Dibuja un código de barras CODE128 en un <canvas> fuera de pantalla y
   *  devuelve su PNG como data URL — CODE128 porque acepta cualquier texto
   *  (Producto.codigo es libre, ver producto.model.ts), a diferencia de
   *  EAN13/UPC que exigen un formato numérico fijo. Un <canvas> no necesita
   *  estar insertado en el documento para dibujarse, así que esto no toca
   *  el DOM de la pantalla para nada. */
  /** Devuelve el código de barras como marcado <svg> (texto), NO como PNG
   *  en un <canvas>. Antes se usaba canvas.toDataURL('image/png'), pero
   *  varios navegadores con protección anti-"fingerprinting" (confirmado:
   *  Brave) interceptan la lectura de un <canvas> y devuelven una imagen en
   *  blanco/alterada en vez de los píxeles reales — el código se generaba
   *  sin error pero salía vacío al imprimir. JsBarcode también sabe dibujar
   *  directo a un <svg>, que no pasa por esa protección (no es lectura de
   *  píxeles de canvas), así que el SVG se incrusta tal cual en el HTML de
   *  la etiqueta — además imprime más nítido por ser vectorial. */
  private dibujarCodigoBarras(codigo: string): string {
    // JsBarcode también se expone en window.JsBarcode como efecto secundario
    // de cargarse (ver node_modules/jsbarcode/bin/JsBarcode.js) — si el
    // import ESM llegara a resolver mal por la interoperabilidad CJS/ESM del
    // bundler (JsBarcode quedando como objeto en vez de función), esto cae
    // de vuelta a esa referencia global en lugar de fallar en silencio.
    const dibujar: typeof JsBarcode =
      typeof JsBarcode === 'function' ? JsBarcode : (window as unknown as { JsBarcode?: typeof JsBarcode }).JsBarcode!;
    if (typeof dibujar !== 'function') {
      throw new Error('No se pudo cargar el generador de códigos de barras (JsBarcode).');
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    dibujar(svg, codigo, { format: 'CODE128', width: 1.6, height: 42, displayValue: false, margin: 0 });
    return new XMLSerializer().serializeToString(svg);
  }

  /** Imprime con un <iframe> OCULTO insertado en la propia página — nada de
   *  ventana/pestaña nueva. Se probaron dos enfoques antes y ninguno
   *  resultó confiable: (1) ocultar el resto de la app con CSS global
   *  (visibility/[data-print-etiquetas]) dependía de que TODO lo demás en
   *  pantalla se ocultara bien; (2) una ventana nueva vía window.open()
   *  depende de que el navegador no la bloquee como pop-up — y varios
   *  navegadores lo hacen en silencio, sin avisar ni devolver un error,
   *  dejando la sensación de que "no pasa nada". Un iframe insertado en el
   *  DOM (aunque con tamaño 0 y fuera de la vista) SÍ se renderiza, así que
   *  print() puede imprimir solo su contenido sin que ningún bloqueador de
   *  pop-ups intervenga y sin tocar el resto del layout de la app. */
  imprimirEtiquetas(event: Event): void {
    // CLAVE: este <form> no tiene [formGroup], y el componente solo
    // importa ReactiveFormsModule (no FormsModule) — así que no hay
    // ninguna directiva de Angular que reconozca (ngSubmit) aquí. Por eso
    // se usa el evento nativo (submit) con preventDefault() explícito; sin
    // esto, el navegador hace un envío de formulario real (navegación GET
    // a la misma URL), que es justo lo que causaba que "no pasara nada".
    event.preventDefault();

    const seleccionados = this.productosParaEtiquetas().filter((p) => this.seleccionEtiquetas().has(p.id));
    if (seleccionados.length === 0) {
      this.toast.advertencia('Elige al menos un producto.');
      return;
    }

    const conCodigo = seleccionados.filter((p) => !!p.codigo);
    const sinCodigo = seleccionados.length - conCodigo.length;
    if (sinCodigo > 0) {
      this.toast.advertencia(`${sinCodigo} producto(s) elegido(s) no tiene(n) código — se omiten de la impresión.`);
    }
    if (conCodigo.length === 0) return;

    // Importante: el iframe necesita un tamaño REAL (no 0x0) — con 0x0,
    // Chrome/Edge recientes lo tratan como "sin contenido que imprimir" y
    // descartan la llamada a print() en silencio, sin ningún error. Por eso
    // se posiciona fuera de la pantalla (left/top muy negativos) en vez de
    // ponerle tamaño cero: así sigue siendo invisible para el usuario pero
    // el navegador sí lo considera imprimible.
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.position = 'fixed';
    iframe.style.left = '-10000px';
    iframe.style.top = '0';
    iframe.style.width = '900px';
    iframe.style.height = '700px';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const quitarIframe = () => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    };

    try {
      const doc = iframe.contentDocument;
      if (!doc) throw new Error('El navegador no permitió preparar el documento de impresión.');

      // Una entrada por cada copia pedida (ver cantidadEtiquetaDe()).
      const etiquetas = conCodigo.flatMap((p) => Array.from({ length: this.cantidadEtiquetaDe(p.id) }, () => p));

      const htmlEtiquetas = etiquetas
        .map(
          (p) => `
        <div class="etiqueta">
          ${this.dibujarCodigoBarras(p.codigo ?? '')}
          <div class="nombre">${this.escaparHtml(p.nombre)}</div>
          <div class="precio">${this.escaparHtml(formatMoneda(p.precioUnitario))}</div>
        </div>`,
        )
        .join('');

      doc.open();
      doc.write(`<!doctype html>
      <html lang="es">
        <head>
          <meta charset="utf-8" />
          <title>Etiquetas</title>
          <style>
            * { box-sizing: border-box; }
            body { margin: 0; font-family: Arial, Helvetica, sans-serif; }
            .etiquetas-grid { display: flex; flex-wrap: wrap; }
            .etiqueta {
              width: 63.5mm; height: 29.6mm; padding: 3mm; overflow: hidden;
              display: flex; flex-direction: column; align-items: center; justify-content: center;
              border: 1px dashed #999; text-align: center;
            }
            .etiqueta svg { width: 100%; height: 11mm; }
            .etiqueta .nombre { font-size: 9px; font-weight: 700; line-height: 1.2; max-width: 100%; overflow: hidden; margin-top: 1mm; }
            .etiqueta .precio { font-size: 11px; font-weight: 800; margin-top: 1mm; }
            @media print { .etiqueta { border: none; } }
          </style>
        </head>
        <body>
          <div class="etiquetas-grid">${htmlEtiquetas}</div>
        </body>
      </html>`);
      doc.close();

      const ventana = iframe.contentWindow;
      if (!ventana) throw new Error('El navegador no permitió preparar la ventana de impresión.');

      // CLAVE: print() se llama de forma SÍNCRONA aquí, en la misma cadena
      // de ejecución que el clic/submit del usuario — nada de setTimeout
      // antes. Algunos navegadores (confirmado: Brave) exigen que print()
      // se invoque dentro del mismo "gesto de usuario" (misma activación
      // síncrona) o lo descartan en silencio sin ningún error ni aviso, que
      // es justo el síntoma que se vio: ni ventana, ni error, ni consola.
      // document.write()/close() ya son síncronos, así que el documento
      // está listo en este punto sin necesidad de esperar.
      try {
        ventana.focus();
        ventana.print();
      } catch (errPrint) {
        console.error('Error al imprimir:', errPrint);
      } finally {
        // La limpieza del iframe SÍ puede ir con retraso — quitar el DOM no
        // necesita ninguna activación de usuario, solo se espera a que el
        // diálogo de impresión ya se haya mostrado.
        setTimeout(quitarIframe, 1000);
      }
    } catch (error) {
      // Antes, cualquier falla aquí se quedaba en silencio y no pasaba nada
      // visible — ahora se avisa con el motivo real.
      console.error('Error al generar las etiquetas de impresión:', error);
      quitarIframe();
      const motivo = error instanceof Error ? error.message : String(error);
      this.toast.error(`No se pudieron generar las etiquetas: ${motivo}`);
    }
  }

  private escaparHtml(texto: string): string {
    const div = document.createElement('div');
    div.textContent = texto;
    return div.innerHTML;
  }
}

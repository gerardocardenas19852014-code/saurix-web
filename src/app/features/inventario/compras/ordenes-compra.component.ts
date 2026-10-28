import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { fuenteDatosActual } from '../../../core/services/fuente-datos';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { SelectBuscableComponent, OpcionBuscable } from '../../../shared/components/select-buscable/select-buscable.component';
import { ToastService } from '../../../shared/services/toast.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { Producto } from '../productos/producto.model';
import { Bodega } from '../bodegas/bodega.model';
import { Proveedor } from '../proveedores/proveedor.model';
import { UnidadMedida } from '../unidades-medida/unidad-medida.model';
import { MovimientoInventario } from '../movimientos-bodega/movimiento-inventario.model';
import { formatMoneda } from '../productos/producto.util';
import { OrdenCompra, EstadoOrdenCompra } from './orden-compra.model';
import { OrdenCompraItem } from './orden-compra-item.model';
import { OrdenCompraService, folioSugeridoOrdenCompra, LineaRecepcion } from './orden-compra.service';
import { OrdenCompraBorradorService } from './orden-compra-borrador.service';
import { EscaneoCodigoComponent } from '../../../shared/components/escaneo-codigo/escaneo-codigo.component';

interface FilaOrdenCompra {
  id: number;
  folio: string;
  proveedorNombre: string;
  bodegaNombre: string;
  fecha: string;
  estado: EstadoOrdenCompra;
  total: number;
  /** true si estado es pendiente/recibida_parcial Y ya pasó su
   *  fechaEntregaEstimada — mismo criterio que
   *  NotificacionesService.revisarOrdenesVencidas(). */
  vencida: boolean;
}

/** Línea del formulario de alta/edición — solo editable mientras la orden
 *  esté 'pendiente' sin nada recibido (ver puedeEditarItems()); una vez que
 *  ya se registró alguna recepción, las cantidades/costos quedan fijos para
 *  no desincronizar lo que ya entró a MovimientoInventario.
 *
 *  Homologación 27-oct: a diferencia de antes, la línea ya NO guarda solo
 *  productoId y hace falta buscarlo en un catálogo completo cargado en
 *  memoria (ese catálogo ya no existe en modo Supabase — ver cargar()) —
 *  guarda directo el código/nombre/unidades/costo que devolvió la búsqueda
 *  con la que se agregó (código exacto, autocomplete por nombre, o la
 *  hidratación acotada de una orden ya guardada — ver
 *  fn_ordenes_compra_productos_por_ids()). Así nunca hace falta volver a
 *  consultar el producto solo para mostrar o recalcular la línea. */
interface FilaItemForm {
  id: number; // 0 = línea nueva, sin guardar todavía
  productoId: number;
  codigo: string;
  nombre: string;
  /** Costo del producto en su unidad BASE, tal como vino de la búsqueda —
   *  se usa para resugerir el costo si se cambia de unidad de compra (ver
   *  cambiarUnidadLinea()), nunca se vuelve a consultar. */
  costoBase: number;
  unidadBaseId: number;
  unidadBaseNombre: string;
  unidadCompraId: number | null;
  unidadCompraNombre: string | null;
  factorConversionCompra: number | null;
  cantidadTexto: string;
  costoUnitarioTexto: string;
  cantidadRecibida: number;
  /** null = unidad base del producto (el caso de siempre). Con número, la
   *  unidad de compra alterna elegida para ESTA línea — se congela como
   *  OrdenCompraItem.unidadId al guardar, junto con el factor
   *  correspondiente (factorConversionCompra, ya conocido de antes). */
  unidadId: number | null;
}

/** Fila del panel de recepción: cuánto falta y cuánto se va a recibir ahora. */
interface FilaRecepcion {
  item: OrdenCompraItem;
  productoNombre: string;
  pendiente: number;
  aRecibirTexto: string;
}

/** Forma normalizada de "un producto encontrado para Compras", sin importar
 *  si vino del código exacto, del autocomplete por nombre, o de hidratar
 *  los productos de una orden ya guardada — las tres consultas (ver
 *  fn_ordenes_compra_producto_por_codigo / fn_ordenes_compra_autocomplete_producto /
 *  fn_ordenes_compra_productos_por_ids) devuelven las mismas columnas. */
interface ProductoCompraResumen {
  id: number;
  codigo: string;
  nombre: string;
  costo: number;
  activo: boolean;
  unidadMedidaId: number;
  unidadMedidaNombre: string;
  unidadCompraId: number | null;
  unidadCompraNombre: string | null;
  factorConversionCompra: number | null;
}

const ETIQUETA_ESTADO: Record<EstadoOrdenCompra, string> = {
  pendiente: 'Pendiente',
  recibida_parcial: 'Recibida parcial',
  recibida_completa: 'Recibida completa',
  cancelada: 'Cancelada',
};
const CLASE_ESTADO: Record<EstadoOrdenCompra, string> = {
  pendiente: 'grid-badge-warning',
  recibida_parcial: 'grid-badge-neutral',
  recibida_completa: 'grid-badge-success',
  cancelada: 'grid-badge-muted',
};

/**
 * Órdenes de compra — encabezado (orden-compra.model.ts) + líneas
 * (orden-compra-item.model.ts). Mismo patrón lista/ficha que
 * MiembrosFamiliaComponent: la lista usa app-data-table, la ficha es la
 * pantalla completa de alta/edición +, cuando la orden ya existe y no está
 * cerrada, el panel de recepción (ver recibir(), que delega en
 * OrdenCompraService.recibir() — ahí vive el costeo promedio ponderado y
 * el cálculo de estado — eso sigue IGUAL, fuera del alcance de esta
 * homologación).
 *
 * HOMOLOGACIÓN 27-oct-2026 ("Nueva orden de compra" a prueba de 200,000+
 * productos): antes, abrir esta pantalla cargaba TODO inventario.producto
 * para armar un <select> en memoria (opcionesProducto) y cada línea nacía
 * vacía ("+ Agregar línea" → "Buscar producto..." dentro de la fila). Las
 * dos cosas son inviables con un catálogo grande. Ahora:
 *
 *  - Ya NO se carga el catálogo completo de productos en modo Supabase —
 *    cargar() solo trae encabezados/líneas/bodegas/proveedores/unidades
 *    (catálogos chicos). Los productos se consultan al servidor SOLO en
 *    3 momentos, cada uno acotado (ver los métodos homónimos):
 *      · Código exacto (escaneo o Enter) → fn_ordenes_compra_producto_por_codigo
 *      · Autocomplete por nombre (app-select-buscable en modo remoto,
 *        con debounce) → fn_ordenes_compra_autocomplete_producto
 *      · Abrir una orden ya guardada / aplicar un borrador de Sugerencia
 *        de reposición → fn_ordenes_compra_productos_por_ids, acotada a
 *        los productoId de ESA orden/borrador (nunca el catálogo).
 *  - Las líneas (FilaItemForm) ya guardan su propio código/nombre/unidad/
 *    costo — nunca hace falta volver a consultar el producto para
 *    mostrar o recalcular una línea ya agregada.
 *  - agregarLinea() (fila vacía) desapareció — una línea solo existe una
 *    vez que de verdad se eligió un producto (ver agregarProductoALaOrden()).
 *  - guardar() en modo Supabase ya no hace baja/alta secuenciales sueltas:
 *    llama a fn_orden_compra_guardar(), una función transaccional que crea/
 *    actualiza el encabezado y reemplaza sus líneas en una sola operación
 *    atómica — si algo falla a mitad, Postgres revierte TODO (ya no puede
 *    quedar un encabezado creado con líneas a medias). En modo IndexedDB
 *    local (catálogos de prueba, sin el problema de escala) se conserva
 *    el flujo secuencial de siempre — ver guardarLocal().
 */
@Component({
  selector: 'app-ordenes-compra',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, SelectBuscableComponent, EscaneoCodigoComponent, DatePipe],
  templateUrl: './ordenes-compra.component.html',
  styleUrl: './ordenes-compra.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrdenesCompraComponent implements OnInit, OnDestroy {
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  private readonly data = inject(DataClientService);
  private readonly ordenCompraService = inject(OrdenCompraService);
  private readonly borradorService = inject(OrdenCompraBorradorService);
  private readonly fb = inject(FormBuilder);
  protected readonly toast = inject(ToastService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);
  protected readonly formatMoneda = formatMoneda;
  protected readonly etiquetaEstado = ETIQUETA_ESTADO;
  protected readonly claseEstado = CLASE_ESTADO;

  private readonly esSupabase = fuenteDatosActual() === 'supabase';
  private readonly sb = this.esSupabase ? inject(SupabaseService).cliente : null;

  /** Campo Código de la barra de captura — para regresarle el foco
   *  explícitamente después de agregar por el camino de nombre+Cantidad+
   *  Agregar (por el camino de código/escaneo, el foco nunca se mueve de
   *  ahí solo; ver limpiarBarraCaptura()). */
  @ViewChild('escaneoCodigoBarra') private escaneoCodigoBarra?: EscaneoCodigoComponent;

  protected readonly vista = signal<'lista' | 'ficha'>('lista');
  protected readonly ordenes = signal<OrdenCompra[]>([]);
  protected readonly items = signal<OrdenCompraItem[]>([]);
  protected readonly bodegas = signal<Bodega[]>([]);
  protected readonly proveedores = signal<Proveedor[]>([]);
  protected readonly unidades = signal<UnidadMedida[]>([]);
  protected readonly movimientos = signal<MovimientoInventario[]>([]);
  protected readonly cargando = signal(false);
  protected readonly guardando = signal(false);

  // ── Listado de órdenes — filtros + paginación SERVER-SIDE (homologación
  // 27-oct-2026, ver cargarListado()/cargarListadoSupabase()/
  // cargarListadoLocal() más abajo). Ningún filtro dispara una consulta
  // por sí solo — solo cambiarFiltro() (botón "🔍 Buscar" o Enter en el
  // campo de texto) lo hace, igual que Productos y servicios/Movimientos
  // entre bodegas (historial)/Valor de stock. ──────────────────────────
  protected readonly filtroBusqueda = signal('');
  protected readonly filtroProveedorId = signal(0);
  protected readonly filtroBodegaId = signal(0);
  protected readonly filtroEstado = signal('');
  protected readonly filtroDesde = signal('');
  protected readonly filtroHasta = signal('');
  protected readonly paginaActual = signal(1);
  /** Total real de órdenes que cumplen el filtro actual (antes de recortar
   *  a la página) — lo da el propio servidor (fn_ordenes_compra_listar,
   *  columna total_filas vía count(*) over()) en modo Supabase; nunca se
   *  calcula contando filas ya traídas. */
  protected readonly totalOrdenesFiltradas = signal(0);
  protected readonly totalPaginas = computed(() =>
    Math.max(1, Math.ceil(this.totalOrdenesFiltradas() / Math.max(1, this.preferenciasGrid.tamanoPagina()))),
  );
  /** Página actual ya resuelta (encabezado + proveedor/bodega + total ya
   *  calculados) — lo que de verdad pinta <app-data-table>. Para 200,000+
   *  órdenes esto SIEMPRE trae como máximo preferenciasGrid.tamanoPagina()
   *  filas, nunca el histórico completo — ver cargarListadoSupabase(). */
  protected readonly filasListado = signal<FilaOrdenCompra[]>([]);
  /** Evita que una respuesta vieja (petición lenta) pise el resultado de
   *  una búsqueda/página más reciente — mismo patrón que
   *  MovimientosBodegaComponent.secuenciaHistorial. */
  private secuenciaListado = 0;

  /** Catálogo completo de productos — SOLO se llena en modo IndexedDB
   *  local (catálogos de prueba, chicos: no tienen el problema de escala
   *  que motivó esta homologación). En modo Supabase esto NUNCA se llena
   *  — los productos se consultan bajo demanda (ver clase de arriba). */
  private productosLocal: Producto[] = [];

  protected readonly ordenActiva = signal<OrdenCompra | null>(null);
  protected readonly ordenAEliminar = signal<FilaOrdenCompra | null>(null);

  protected readonly bodegasActivas = computed(() => this.bodegas().filter((b) => b.activo !== false));
  protected readonly proveedoresActivos = computed(() => this.proveedores().filter((p) => p.activo !== false));

  protected readonly opcionesBodega = computed<OpcionBuscable[]>(() =>
    this.bodegasActivas().map((b) => ({ valor: b.id, etiqueta: b.nombre })),
  );
  /** Proveedor: catálogo cargado completo en memoria (igual que antes de
   *  esta homologación) — a diferencia de producto, el número de
   *  proveedores de una empresa está acotado por la realidad del negocio
   *  (decenas/cientos, nunca 200,000+), y hoy no existe ningún índice ni
   *  RPC de búsqueda remota para proveedor en el esquema. Se revisó (punto
   *  18 del pedido) y se decide mantenerlo así — ver el reporte final. */
  protected readonly opcionesProveedor = computed<OpcionBuscable[]>(() =>
    this.proveedoresActivos().map((p) => ({ valor: p.id, etiqueta: p.nombre })),
  );

  private nombreProveedor(id: number): string {
    return this.proveedores().find((p) => p.id === id)?.nombre ?? '—';
  }
  private nombreBodega(id: number): string {
    return this.bodegas().find((b) => b.id === id)?.nombre ?? '—';
  }

  /** Nombres de los productos de LA ORDEN ABIERTA ahora mismo (acotado a
   *  sus propias líneas — ver abrirOrdenPorId()) — para el historial de
   *  recepciones (movimientosDeOrden), que solo guarda productoId. Nunca
   *  el catálogo completo. */
  protected readonly nombresProductosOrdenActual = signal<Map<number, string>>(new Map());
  protected nombreProductoOrdenActual(id: number): string {
    return this.nombresProductosOrdenActual().get(id) ?? '—';
  }

  protected tieneUnidadCompraAlterna(linea: FilaItemForm): boolean {
    return !!linea.unidadCompraId && !!linea.factorConversionCompra;
  }

  /** Nombre de la unidad en la que está capturada la línea (base o de
   *  compra) — para mostrarla cuando el producto no tiene unidad alterna
   *  (selector no aplica) y como etiqueta de referencia junto al selector
   *  cuando sí la tiene. */
  protected nombreUnidadLinea(linea: FilaItemForm): string {
    return linea.unidadId ? (linea.unidadCompraNombre ?? '—') : linea.unidadBaseNombre;
  }

  /** Opciones del selector de unidad de una línea: la unidad base del
   *  producto (valor 0 = "sin unidad de compra alterna") y su unidad de
   *  compra alterna, si tiene. Solo se llama cuando tieneUnidadCompraAlterna()
   *  ya dio true. */
  protected opcionesUnidadLinea(linea: FilaItemForm): OpcionBuscable[] {
    return [
      { valor: 0, etiqueta: linea.unidadBaseNombre + ' (base)' },
      { valor: linea.unidadCompraId!, etiqueta: linea.unidadCompraNombre ?? '—' },
    ];
  }

  protected readonly columnas: ColumnaTabla<FilaOrdenCompra>[] = [
    { campo: 'folio', etiqueta: 'Folio' },
    { campo: 'proveedorNombre', etiqueta: 'Proveedor' },
    { campo: 'bodegaNombre', etiqueta: 'Bodega destino' },
    { campo: 'fecha', etiqueta: 'Fecha', formatear: (f) => new Date(f.fecha).toLocaleDateString('es-MX') },
    { campo: 'total', etiqueta: 'Total', formatear: (f) => formatMoneda(f.total) },
    {
      campo: 'estado',
      etiqueta: 'Estado',
      formatear: (f) => (f.vencida ? `${ETIQUETA_ESTADO[f.estado]} — Vencida` : ETIQUETA_ESTADO[f.estado]),
      claseValor: (f) => (f.vencida ? 'grid-badge-danger' : CLASE_ESTADO[f.estado]),
    },
  ];

  protected readonly form = this.fb.nonNullable.group({
    proveedorId: [0, Validators.required],
    bodegaDestinoId: [0, Validators.required],
    fecha: [new Date().toISOString().slice(0, 10), Validators.required],
    fechaEntregaEstimada: [''],
    notas: [''],
  });

  protected readonly itemsForm = signal<FilaItemForm[]>([]);
  protected readonly totalOrden = computed(() =>
    this.itemsForm().reduce((acc, i) => acc + (Number(i.cantidadTexto) || 0) * (Number(i.costoUnitarioTexto) || 0), 0),
  );

  // ── Barra de captura rápida: "Código / escanear…", "Buscar producto por
  // nombre…", "Cantidad", "+ Agregar" — ver agregarPorCodigo()/
  // agregarDesdeBarra()/agregarProductoALaOrden() más abajo. ──────────────
  protected readonly productoSeleccionadoId = signal<number | null>(null);
  private productoSeleccionadoInfo: ProductoCompraResumen | null = null;
  protected readonly cantidadCapturaTexto = signal('1');
  /** Última tanda de resultados del autocomplete por nombre — para poder
   *  recuperar el producto completo (costo/unidad/etc.) en cuanto el
   *  usuario elige uno, sin otra consulta (ver buscarProductoAutocomplete()/
   *  onSeleccionarProductoAutocomplete()). */
  private resultadosAutocompleteActual: ProductoCompraResumen[] = [];

  /** Número real de columnas de la tabla de líneas, para el colspan de la
   *  fila "sin líneas todavía": 6 fijas (Código, Producto, Unidad,
   *  Cantidad, Costo unitario, Subtotal) + "Recibido" si la orden ya
   *  existe + acción "Quitar" si todavía se puede editar. */
  protected readonly colspanItems = computed(() => 6 + (this.ordenActiva() ? 1 : 0) + (this.puedeEditarItems() ? 1 : 0));

  protected readonly puedeEditarItems = computed(() => {
    const orden = this.ordenActiva();
    return !orden || orden.estado === 'pendiente';
  });

  protected readonly filasRecepcion = signal<FilaRecepcion[]>([]);
  protected readonly recibiendo = signal(false);

  protected readonly movimientosDeOrden = computed(() => {
    const orden = this.ordenActiva();
    if (!orden) return [];
    return this.movimientos()
      .filter((m) => m.ordenCompraId === orden.id)
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
  });

  async ngOnInit(): Promise<void> {
    document.documentElement.setAttribute('data-wide', 'grid'); // ancho completo
    await this.cargarCatalogos();
    await this.cargarListado();
    await this.aplicarBorradorDesdeReposicion();
  }

  /** Si se llegó aquí desde el botón "Generar orden de compra" de
   *  Sugerencia de reposición, abre la ficha de alta ya con proveedor y
   *  líneas precargadas — el usuario sigue siendo quien revisa/ajusta
   *  bodega y cantidades y decide guardar; nada se crea todavía solo por
   *  llegar aquí. Las líneas del borrador solo traen productoId/cantidad/
   *  costoUnitario (ver OrdenCompraBorradorService) — se hidratan acá con
   *  fn_ordenes_compra_productos_por_ids(), acotado a esos productoId
   *  nada más (nunca el catálogo completo). */
  private async aplicarBorradorDesdeReposicion(): Promise<void> {
    const borrador = this.borradorService.tomarBorrador();
    if (!borrador) return;
    this.nuevaOrden();
    this.form.patchValue({
      proveedorId: borrador.proveedorId,
      bodegaDestinoId: borrador.bodegaId ?? 0,
    });
    const ids = [...new Set(borrador.lineas.map((l) => l.productoId))];
    const resumenes = await this.hidratarProductosPorIds(ids);
    const porId = new Map(resumenes.map((r) => [r.id, r]));
    this.itemsForm.set(
      borrador.lineas.map((l) => {
        const info = porId.get(l.productoId);
        return {
          id: 0,
          productoId: l.productoId,
          codigo: info?.codigo ?? '',
          nombre: info?.nombre ?? '(producto no encontrado)',
          costoBase: info?.costo ?? l.costoUnitario,
          unidadBaseId: info?.unidadMedidaId ?? 0,
          unidadBaseNombre: info?.unidadMedidaNombre ?? '—',
          unidadCompraId: info?.unidadCompraId ?? null,
          unidadCompraNombre: info?.unidadCompraNombre ?? null,
          factorConversionCompra: info?.factorConversionCompra ?? null,
          cantidadTexto: String(l.cantidad),
          costoUnitarioTexto: String(l.costoUnitario),
          cantidadRecibida: 0,
          unidadId: null, // sugerencia de reposición siempre calcula en unidad base
        };
      }),
    );
  }

  /** Catálogos chicos (bodegas/proveedores/unidades, + productos en modo
   *  IndexedDB local) — se cargan UNA sola vez (ngOnInit), nunca cambian
   *  por guardar/recibir/eliminar una orden, así que no hace falta
   *  recargarlos después de cada una de esas operaciones (mismo criterio
   *  que ProductosComponent.cargarCatalogos()). El histórico de órdenes
   *  en sí vive en cargarListado()/cargarListadoSupabase()/
   *  cargarListadoLocal() — ver ahí el detalle de la homologación
   *  27-oct-2026 (paginación + filtros SERVER-SIDE). */
  private async cargarCatalogos(): Promise<void> {
    if (this.esSupabase) {
      const [bodegas, proveedores, unidades] = await Promise.all([
        firstValueFrom(this.data.list<Bodega>('Bodega')),
        firstValueFrom(this.data.list<Proveedor>('Proveedor')),
        firstValueFrom(this.data.list<UnidadMedida>('UnidadMedida')),
      ]);
      this.bodegas.set(bodegas);
      this.proveedores.set(proveedores);
      this.unidades.set(unidades);
    } else {
      const [productos, bodegas, proveedores, unidades] = await Promise.all([
        firstValueFrom(this.data.list<Producto>('Producto')),
        firstValueFrom(this.data.list<Bodega>('Bodega')),
        firstValueFrom(this.data.list<Proveedor>('Proveedor')),
        firstValueFrom(this.data.list<UnidadMedida>('UnidadMedida')),
      ]);
      this.productosLocal = productos;
      this.bodegas.set(bodegas);
      this.proveedores.set(proveedores);
      this.unidades.set(unidades);
    }
    this.movimientos.set([]);
  }

  /** Trae SOLO la página actual del listado (encabezados + proveedor/
   *  bodega resueltos + total de cada orden), según los filtros actuales —
   *  NUNCA el histórico completo. Se llama al entrar a la pantalla, al
   *  presionar "🔍 Buscar"/Enter (cambiarFiltro(), que además regresa a
   *  página 1), al cambiar de página, y después de guardar/recibir/
   *  eliminar una orden (para que la lista refleje el cambio). Protegida
   *  contra respuestas fuera de orden con secuenciaListado, igual que
   *  MovimientosBodegaComponent.cargarHistorial(). */
  async cargarListado(): Promise<void> {
    this.cargando.set(true);
    const miSecuencia = ++this.secuenciaListado;
    const resultado = this.esSupabase ? await this.cargarListadoSupabase() : await this.cargarListadoLocal();
    if (miSecuencia !== this.secuenciaListado) return; // ya respondió una búsqueda/página más nueva — descartar esta
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    // Si la página en la que estábamos quedó vacía (p.ej. se acaba de
    // eliminar la última orden de la última página, o un filtro nuevo
    // tiene menos páginas que la posición actual), retrocede a la última
    // página real en vez de dejar la tabla en blanco — mismo criterio que
    // ProductosComponent.cargar().
    if (resultado.filas.length === 0 && this.paginaActual() > 1 && resultado.total > 0) {
      this.paginaActual.set(Math.max(1, Math.ceil(resultado.total / tamanio)));
      this.cargando.set(false);
      await this.cargarListado();
      return;
    }
    this.filasListado.set(resultado.filas);
    this.totalOrdenesFiltradas.set(resultado.total);
    this.cargando.set(false);
  }

  /** Modo Supabase — fn_ordenes_compra_listar() hace TODO el trabajo en
   *  PostgreSQL: filtra (folio/proveedor por texto, proveedor_id, bodega_id,
   *  estado, rango de fecha), ordena fecha DESC/id DESC, pagina con
   *  OFFSET/LIMIT, y calcula el total de cada orden (suma de
   *  orden_compra_item) y el conteo real de filas (count(*) over(), columna
   *  total_filas) en una sola consulta — nunca se trae el histórico
   *  completo ni las líneas de cada orden para armar esta pantalla. */
  private async cargarListadoSupabase(): Promise<{ filas: FilaOrdenCompra[]; total: number }> {
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActual() - 1) * tamanio;
    const { data, error } = await this.sb!.schema('inventario').rpc('fn_ordenes_compra_listar', {
      p_busqueda: this.filtroBusqueda().trim() || null,
      p_proveedor_id: this.filtroProveedorId() || null,
      p_bodega_id: this.filtroBodegaId() || null,
      p_estado: this.filtroEstado() || null,
      p_desde_fecha: this.filtroDesde() || null,
      p_hasta_fecha: this.filtroHasta() || null,
      p_desde: desde,
      p_cantidad: tamanio,
    });
    if (error) {
      this.toast.error('No se pudo cargar el listado de órdenes: ' + error.message);
      return { filas: [], total: 0 };
    }
    const filas = (data ?? []) as Record<string, unknown>[];
    const hoyTexto = new Date().toISOString().slice(0, 10);
    return {
      filas: filas.map((f) => {
        const estado = f['estado'] as EstadoOrdenCompra;
        const fechaEntregaEstimada = f['fecha_entrega_estimada'] as string | null;
        return {
          id: Number(f['id']),
          folio: String(f['folio']),
          proveedorNombre: this.nombreProveedor(Number(f['proveedor_id'])),
          bodegaNombre: this.nombreBodega(Number(f['bodega_destino_id'])),
          fecha: String(f['fecha']),
          estado,
          total: Number(f['total']) || 0,
          vencida:
            (estado === 'pendiente' || estado === 'recibida_parcial') &&
            !!fechaEntregaEstimada &&
            fechaEntregaEstimada.slice(0, 10) < hoyTexto,
        };
      }),
      total: Number(filas[0]?.['total_filas'] ?? 0),
    };
  }

  /** Filtra/ordena en memoria sobre this.ordenes()/this.items() — solo para
   *  modo IndexedDB local (catálogos de prueba, chicos: sin el problema de
   *  escala de 200,000+ órdenes que sí aplica en modo Supabase). Mismo
   *  orden (fecha DESC, id DESC como criterio de desempate estable) y
   *  mismo cálculo de total/vencida que antes de esta homologación. */
  private filasListadoLocalFiltradas(): FilaOrdenCompra[] {
    const texto = this.filtroBusqueda().trim().toLowerCase();
    const proveedorId = this.filtroProveedorId();
    const bodegaId = this.filtroBodegaId();
    const estado = this.filtroEstado();
    const desde = this.filtroDesde();
    const hasta = this.filtroHasta();
    const hoyTexto = new Date().toISOString().slice(0, 10);
    const items = this.items();
    return this.ordenes()
      .filter((o) => {
        if (proveedorId && o.proveedorId !== proveedorId) return false;
        if (bodegaId && o.bodegaDestinoId !== bodegaId) return false;
        if (estado && o.estado !== estado) return false;
        if (desde && o.fecha.slice(0, 10) < desde) return false;
        if (hasta && o.fecha.slice(0, 10) > hasta) return false;
        if (texto) {
          const proveedorNombre = this.nombreProveedor(o.proveedorId).toLowerCase();
          if (!o.folio.toLowerCase().includes(texto) && !proveedorNombre.includes(texto)) return false;
        }
        return true;
      })
      .map((o) => ({
        id: o.id,
        folio: o.folio,
        proveedorNombre: this.nombreProveedor(o.proveedorId),
        bodegaNombre: this.nombreBodega(o.bodegaDestinoId),
        fecha: o.fecha,
        estado: o.estado,
        total: items.filter((i) => i.ordenCompraId === o.id).reduce((acc, i) => acc + i.cantidad * i.costoUnitario, 0),
        vencida:
          (o.estado === 'pendiente' || o.estado === 'recibida_parcial') &&
          !!o.fechaEntregaEstimada &&
          o.fechaEntregaEstimada.slice(0, 10) < hoyTexto,
      }))
      .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id);
  }

  /** Modo IndexedDB local — recarga encabezados + líneas COMPLETOS (igual
   *  que antes de esta homologación: catálogos de prueba, chicos, sin el
   *  problema de escala) y pagina/filtra en memoria. */
  private async cargarListadoLocal(): Promise<{ filas: FilaOrdenCompra[]; total: number }> {
    const [ordenes, items] = await Promise.all([
      firstValueFrom(this.data.list<OrdenCompra>('OrdenCompra')),
      firstValueFrom(this.data.list<OrdenCompraItem>('OrdenCompraItem')),
    ]);
    this.ordenes.set(ordenes);
    this.items.set(items);
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const todas = this.filasListadoLocalFiltradas();
    const desde = (this.paginaActual() - 1) * tamanio;
    return { filas: todas.slice(desde, desde + tamanio), total: todas.length };
  }

  /** Cualquier cambio de filtro (texto, proveedor, bodega, estado, fechas)
   *  vuelve a la página 1 — quedarse en, digamos, la página 37 de un filtro
   *  nuevo casi siempre cae fuera de rango o muestra resultados que no
   *  tienen relación con lo que se acaba de buscar. Solo se llama desde el
   *  botón "🔍 Buscar" o Enter en el campo de texto — ningún filtro
   *  dispara una consulta por sí solo (ver sección de signals de filtros). */
  protected cambiarFiltro(): void {
    this.paginaActual.set(1);
    this.cargarListado();
  }

  protected irAPaginaAnterior(): void {
    if (this.paginaActual() <= 1) return;
    this.paginaActual.update((p) => p - 1);
    this.cargarListado();
  }

  protected irAPaginaSiguiente(): void {
    if (this.paginaActual() >= this.totalPaginas()) return;
    this.paginaActual.update((p) => p + 1);
    this.cargarListado();
  }

  /** Movimientos de inventario de ESTA orden (acotados por ordenCompraId,
   *  ver cargar()) — se piden solo cuando el usuario realmente abre la
   *  ficha, no al cargar la lista completa de órdenes. */
  private cargarMovimientosDeOrden(ordenCompraId: number): void {
    this.data.list<MovimientoInventario>('MovimientoInventario', { ordenCompraId }).subscribe((movimientos) => {
      this.movimientos.set(movimientos);
    });
  }

  volverALista(): void {
    this.vista.set('lista');
    this.cargarListado();
  }

  nuevaOrden(): void {
    this.ordenActiva.set(null);
    this.form.reset({
      proveedorId: 0,
      bodegaDestinoId: 0,
      fecha: new Date().toISOString().slice(0, 10),
      fechaEntregaEstimada: '',
      notas: '',
    });
    this.itemsForm.set([]);
    this.filasRecepcion.set([]);
    this.nombresProductosOrdenActual.set(new Map());
    this.limpiarBarraCaptura();
    this.vista.set('ficha');
  }

  abrirOrden(fila: FilaOrdenCompra): void {
    this.abrirOrdenPorId(fila.id);
  }

  /** Abre una orden ya guardada: hidrata SOLO los productos que están en
   *  sus propias líneas (ver hidratarProductosPorIds()) — nunca el
   *  catálogo completo, sin importar cuántos productos tenga la empresa. */
  private async abrirOrdenPorId(id: number): Promise<void> {
    let orden: OrdenCompra;
    try {
      orden = await firstValueFrom(this.data.getById<OrdenCompra>('OrdenCompra', id));
    } catch {
      return;
    }
    this.ordenActiva.set(orden);
    this.cargarMovimientosDeOrden(id);
    this.limpiarBarraCaptura();
    this.form.reset({
      proveedorId: orden.proveedorId,
      bodegaDestinoId: orden.bodegaDestinoId,
      fecha: orden.fecha.slice(0, 10),
      fechaEntregaEstimada: orden.fechaEntregaEstimada?.slice(0, 10) ?? '',
      notas: orden.notas ?? '',
    });
    const itemsDeOrden = await firstValueFrom(
      this.data.list<OrdenCompraItem>('OrdenCompraItem', { ordenCompraId: orden.id }),
    );
    const ids = [...new Set(itemsDeOrden.map((i) => i.productoId))];
    const resumenes = await this.hidratarProductosPorIds(ids);
    const porId = new Map(resumenes.map((r) => [r.id, r]));
    this.nombresProductosOrdenActual.set(new Map(resumenes.map((r) => [r.id, r.nombre])));

    this.itemsForm.set(
      itemsDeOrden.map((i) => {
        const info = porId.get(i.productoId);
        return {
          id: i.id,
          productoId: i.productoId,
          codigo: info?.codigo ?? '',
          nombre: info?.nombre ?? '(producto no encontrado)',
          costoBase: info?.costo ?? (Number(i.costoUnitario) || 0),
          unidadBaseId: info?.unidadMedidaId ?? 0,
          unidadBaseNombre: info?.unidadMedidaNombre ?? '—',
          unidadCompraId: info?.unidadCompraId ?? null,
          unidadCompraNombre: info?.unidadCompraNombre ?? null,
          factorConversionCompra: info?.factorConversionCompra ?? null,
          cantidadTexto: String(i.cantidad),
          costoUnitarioTexto: String(i.costoUnitario),
          cantidadRecibida: i.cantidadRecibida,
          unidadId: i.unidadId ?? null,
        };
      }),
    );
    this.filasRecepcion.set(
      itemsDeOrden
        .filter((i) => i.cantidadRecibida < i.cantidad)
        .map((i) => ({
          item: i,
          productoNombre: porId.get(i.productoId)?.nombre ?? '(producto no encontrado)',
          pendiente: i.cantidad - i.cantidadRecibida,
          aRecibirTexto: String(i.cantidad - i.cantidadRecibida),
        })),
    );
    this.vista.set('ficha');
  }

  // ── Búsqueda de productos para Compras (código exacto / autocomplete por
  // nombre / hidratación acotada) — SIEMPRE bajo demanda, NUNCA el catálogo
  // completo (ver comentario de clase). ───────────────────────────────────

  private mapearProductoCompra(f: Record<string, unknown>): ProductoCompraResumen {
    return {
      id: Number(f['id']),
      codigo: String(f['codigo'] ?? ''),
      nombre: String(f['nombre'] ?? ''),
      costo: Number(f['costo']) || 0,
      activo: f['activo'] !== false,
      unidadMedidaId: Number(f['unidad_medida_id']),
      unidadMedidaNombre: String(f['unidad_medida_nombre'] ?? '—'),
      unidadCompraId: f['unidad_compra_id'] != null ? Number(f['unidad_compra_id']) : null,
      unidadCompraNombre: f['unidad_compra_nombre'] != null ? String(f['unidad_compra_nombre']) : null,
      factorConversionCompra: f['factor_conversion_compra'] != null ? Number(f['factor_conversion_compra']) : null,
    };
  }

  private productoLocalAResumen(p: Producto): ProductoCompraResumen {
    return {
      id: p.id,
      codigo: p.codigo ?? '',
      nombre: p.nombre,
      costo: p.costo,
      activo: p.activo !== false,
      unidadMedidaId: p.unidadMedidaId,
      unidadMedidaNombre: this.unidades().find((u) => u.id === p.unidadMedidaId)?.nombre ?? '—',
      unidadCompraId: p.unidadCompraId ?? null,
      unidadCompraNombre: p.unidadCompraId ? (this.unidades().find((u) => u.id === p.unidadCompraId)?.nombre ?? '—') : null,
      factorConversionCompra: p.factorConversionCompra ?? null,
    };
  }

  /** Hidrata SOLO los productos cuyos ids se piden — acotado por quien
   *  llama a cuántas líneas tiene una orden/borrador (decenas, nunca
   *  200,000). Usado al abrir una orden ya guardada y al aplicar un
   *  borrador de Sugerencia de reposición. */
  private async hidratarProductosPorIds(ids: number[]): Promise<ProductoCompraResumen[]> {
    if (ids.length === 0) return [];
    if (this.esSupabase) {
      const { data, error } = await this.sb!.schema('inventario').rpc('fn_ordenes_compra_productos_por_ids', { p_ids: ids });
      if (error) return [];
      return (data as Record<string, unknown>[]).map((f) => this.mapearProductoCompra(f));
    }
    return this.productosLocal.filter((p) => ids.includes(p.id)).map((p) => this.productoLocalAResumen(p));
  }

  /** Campo "Código / escanear…" de la barra de captura — responde tanto al
   *  lector (USB/Bluetooth/cámara) como a teclear el código a mano + Enter
   *  (ver app-escaneo-codigo). Consulta el código EXACTO en el servidor
   *  (nunca busca en un catálogo cargado en memoria): si existe, agrega la
   *  línea o suma a la cantidad ya existente (ver agregarProductoALaOrden())
   *  y dentro de la misma barra de captura, limpiando el campo y
   *  manteniendo el foco ahí automáticamente (el <input> nunca pierde el
   *  foco en todo este flujo, así que no hace falta ningún .focus()
   *  explícito) — así se puede escanear producto tras producto sin tocar
   *  el mouse. Si no se encuentra, NO crea ninguna fila — solo avisa y deja
   *  el foco donde estaba para corregir/reintentar. Si el producto existe
   *  pero está inactivo, respeta la regla de siempre (no se agrega) con un
   *  mensaje específico. */
  async agregarPorCodigo(codigoCrudo: string): Promise<void> {
    if (!this.puedeEditarItems()) return;
    const codigo = codigoCrudo.trim();
    if (!codigo) return;

    const encontrado = this.esSupabase ? await this.buscarProductoPorCodigoSupabase(codigo) : this.buscarProductoPorCodigoLocal(codigo);
    if (!encontrado) {
      this.toast.advertencia(`No se encontró un producto con ese código.`);
      return;
    }
    if (!encontrado.activo) {
      this.toast.advertencia(`"${encontrado.nombre}" está inactivo y no se puede agregar a la orden.`);
      return;
    }
    this.agregarProductoALaOrden(encontrado);
  }

  private async buscarProductoPorCodigoSupabase(codigo: string): Promise<ProductoCompraResumen | undefined> {
    const { data, error } = await this.sb!.schema('inventario').rpc('fn_ordenes_compra_producto_por_codigo', { p_codigo: codigo });
    if (error || !data || (data as unknown[]).length === 0) return undefined;
    return this.mapearProductoCompra((data as Record<string, unknown>[])[0]);
  }

  private buscarProductoPorCodigoLocal(codigo: string): ProductoCompraResumen | undefined {
    const normalizado = codigo.trim().toLowerCase();
    const p = this.productosLocal.find((p) => (p.codigo ?? '').trim().toLowerCase() === normalizado);
    return p ? this.productoLocalAResumen(p) : undefined;
  }

  /** busquedaRemota de app-select-buscable para "Buscar producto por
   *  nombre…" — se llama con debounce (300ms, ver el input [debounceMs]
   *  en la plantilla) cada vez que el usuario escribe, nunca una vez por
   *  tecla. Como máximo 15 resultados ("CÓDIGO — NOMBRE — UNIDAD"), nunca
   *  el catálogo completo. Guarda la tanda completa en
   *  resultadosAutocompleteActual para no tener que volver a consultar al
   *  elegir uno (ver onSeleccionarProductoAutocomplete()). */
  protected buscarProductoAutocomplete = async (texto: string): Promise<OpcionBuscable[]> => {
    const resultados = this.esSupabase ? await this.autocompletarProductoSupabase(texto) : this.autocompletarProductoLocal(texto);
    this.resultadosAutocompleteActual = resultados;
    return resultados.map((r) => ({
      valor: r.id,
      etiqueta: r.unidadMedidaNombre ? `${r.codigo} — ${r.nombre} — ${r.unidadMedidaNombre}` : `${r.codigo} — ${r.nombre}`,
    }));
  };

  private async autocompletarProductoSupabase(texto: string): Promise<ProductoCompraResumen[]> {
    const { data, error } = await this.sb!.schema('inventario').rpc('fn_ordenes_compra_autocomplete_producto', {
      p_busqueda: texto || null,
      p_limite: 15,
    });
    if (error) return [];
    return (data as Record<string, unknown>[]).map((f) => this.mapearProductoCompra(f));
  }

  private autocompletarProductoLocal(texto: string): ProductoCompraResumen[] {
    const termino = texto.trim().toLowerCase();
    return this.productosLocal
      .filter((p) => p.activo !== false)
      .filter((p) => !termino || p.nombre.toLowerCase().includes(termino) || (p.codigo ?? '').toLowerCase().includes(termino))
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .slice(0, 15)
      .map((p) => this.productoLocalAResumen(p));
  }

  /** Al elegir una opción del autocomplete por nombre: guarda el producto
   *  completo (de resultadosAutocompleteActual, sin volver a consultar) —
   *  falta todavía darle "+ Agregar" (o Enter en Cantidad) para que entre
   *  a la tabla, ver agregarDesdeBarra(). */
  protected onSeleccionarProductoAutocomplete(id: number | string | null): void {
    if (id == null) {
      this.productoSeleccionadoId.set(null);
      this.productoSeleccionadoInfo = null;
      return;
    }
    const encontrado = this.resultadosAutocompleteActual.find((r) => r.id === Number(id));
    this.productoSeleccionadoId.set(encontrado ? encontrado.id : null);
    this.productoSeleccionadoInfo = encontrado ?? null;
  }

  /** Botón "+ Agregar" (o Enter en el campo Cantidad) — agrega a la tabla
   *  el producto elegido por nombre con la cantidad capturada. */
  protected agregarDesdeBarra(): void {
    if (!this.productoSeleccionadoInfo) return;
    this.agregarProductoALaOrden(this.productoSeleccionadoInfo);
  }

  /** Núcleo común de "agregar un producto a la orden" — lo usan tanto el
   *  código exacto (Enter/escaneo) como el autocomplete por nombre +
   *  "+ Agregar", así que el criterio de "producto repetido" es el mismo
   *  sin importar por cuál de los dos caminos se agregó.
   *
   *  CRÍTICO (punto 10 del pedido): si el producto YA está en la orden,
   *  NO se crea otra fila — se le suma la cantidad capturada a la
   *  cantidad que ya tenía (si Cantidad dice 5, se suman 5, no 1).
   *  Si es la primera vez, nace con la cantidad capturada (por default 1)
   *  y el costo sugerido del producto. Después de agregar, Cantidad
   *  vuelve a 1 y el campo de nombre se limpia — listo para capturar el
   *  siguiente sin tocar el mouse. */
  private agregarProductoALaOrden(info: ProductoCompraResumen): void {
    const cantidadCapturada = Math.max(1, Number(this.cantidadCapturaTexto()) || 1);
    const indiceExistente = this.itemsForm().findIndex((f) => f.productoId === info.id);
    if (indiceExistente >= 0) {
      const actual = this.itemsForm()[indiceExistente];
      const nuevaCantidad = (Number(actual.cantidadTexto) || 0) + cantidadCapturada;
      this.cambiarLinea(indiceExistente, { cantidadTexto: String(nuevaCantidad) });
      this.toast.info(`${info.nombre} — cantidad actualizada a ${nuevaCantidad}.`);
    } else {
      this.itemsForm.update((filas) => [
        ...filas,
        {
          id: 0,
          productoId: info.id,
          codigo: info.codigo,
          nombre: info.nombre,
          costoBase: info.costo,
          unidadBaseId: info.unidadMedidaId,
          unidadBaseNombre: info.unidadMedidaNombre,
          unidadCompraId: info.unidadCompraId,
          unidadCompraNombre: info.unidadCompraNombre,
          factorConversionCompra: info.factorConversionCompra,
          cantidadTexto: String(cantidadCapturada),
          costoUnitarioTexto: String(info.costo),
          cantidadRecibida: 0,
          unidadId: null,
        },
      ]);
      this.toast.info(`${info.nombre} agregado.`);
    }
    this.limpiarBarraCaptura();
  }

  /** Deja la barra de captura lista para el siguiente producto: Cantidad
   *  vuelve a 1, el producto elegido en el autocomplete se limpia, el
   *  campo Código se limpia (por si quedó texto a medio escribir) y el
   *  foco regresa ahí — así se puede seguir escaneando/tecleando producto
   *  tras producto sin tocar el mouse, sin importar por cuál de los dos
   *  caminos (código o nombre) se agregó el anterior. */
  private limpiarBarraCaptura(): void {
    this.cantidadCapturaTexto.set('1');
    this.productoSeleccionadoId.set(null);
    this.productoSeleccionadoInfo = null;
    this.escaneoCodigoBarra?.limpiarTexto();
    this.escaneoCodigoBarra?.enfocar();
  }

  quitarLinea(index: number): void {
    this.itemsForm.update((filas) => filas.filter((_, i) => i !== index));
  }

  /** Cantidad/costo editables directo en la tabla — el subtotal (ver
   *  totalOrden()) se recalcula al vuelo en el cliente, sin ninguna
   *  consulta a Postgres: son cálculos de estado temporal de la orden,
   *  nada que ya esté guardado. */
  cambiarLinea(index: number, cambio: Partial<FilaItemForm>): void {
    this.itemsForm.update((filas) => filas.map((f, i) => (i === index ? { ...f, ...cambio } : f)));
  }

  /** Cambia la unidad en la que se captura esta línea (base o de compra
   *  alterna — ver tieneUnidadCompraAlterna()/opcionesUnidadLinea()) y
   *  re-sugiere el costo unitario en esa unidad (costoBase está en unidad
   *  base, así que se multiplica por el factor ya conocido de la línea —
   *  nunca se vuelve a consultar el producto). */
  cambiarUnidadLinea(index: number, valorSeleccionado: number): void {
    const fila = this.itemsForm()[index];
    if (!fila) return;
    const unidadId = valorSeleccionado || null;
    const factor = unidadId ? (fila.factorConversionCompra ?? 1) : 1;
    this.cambiarLinea(index, { unidadId, costoUnitarioTexto: String(fila.costoBase * factor) });
  }

  async guardar(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const lineasValidas = this.itemsForm().filter((f) => f.productoId > 0 && Number(f.cantidadTexto) > 0);
    if (lineasValidas.length === 0) {
      this.toast.advertencia('Agrega al menos una línea con producto y cantidad.');
      return;
    }

    this.guardando.set(true);
    try {
      if (this.esSupabase) {
        await this.guardarSupabase(lineasValidas);
      } else {
        await this.guardarLocal(lineasValidas);
      }
    } finally {
      this.guardando.set(false);
    }
  }

  /** Crea/actualiza la orden en UNA sola llamada transaccional
   *  (fn_orden_compra_guardar) — encabezado + reemplazo completo de
   *  líneas, todo o nada. Soluciona el riesgo de "encabezado creado
   *  correctamente → falla a mitad de las líneas → orden inconsistente"
   *  que tenía el guardar() anterior (baja/alta sueltas, una por una). */
  private async guardarSupabase(lineasValidas: FilaItemForm[]): Promise<void> {
    const valor = this.form.getRawValue();
    const ordenExistente = this.ordenActiva();
    const puedeEditar = this.puedeEditarItems();

    const payloadLineas = puedeEditar
      ? lineasValidas.map((f) => ({
          producto_id: f.productoId,
          cantidad: Number(f.cantidadTexto),
          costo_unitario: Number(f.costoUnitarioTexto) || 0,
          unidad_id: f.unidadId,
          factor_conversion: f.unidadId ? (f.factorConversionCompra ?? 1) : 1,
        }))
      : null; // ya no se pueden editar líneas (ver puedeEditarItems()) — no se tocan

    const { error } = await this.sb!.schema('inventario').rpc('fn_orden_compra_guardar', {
      p_orden_id: ordenExistente?.id ?? null,
      p_proveedor_id: valor.proveedorId,
      p_bodega_destino_id: valor.bodegaDestinoId,
      p_fecha: valor.fecha,
      p_fecha_entrega_estimada: valor.fechaEntregaEstimada || null,
      p_notas: valor.notas || null,
      p_lineas: payloadLineas,
    });
    if (error) {
      this.toast.error('No se pudo guardar la orden: ' + error.message);
      return;
    }
    this.toast.exito(ordenExistente ? 'Orden actualizada.' : 'Orden creada correctamente.');
    this.volverALista();
  }

  /** Modo IndexedDB local — comportamiento IDÉNTICO al de antes de esta
   *  homologación (baja/alta secuenciales vía DataClientService): los
   *  catálogos de prueba son chicos y no tienen el problema de escala ni
   *  el riesgo de inconsistencia a gran volumen que motivó la RPC
   *  transaccional de arriba. */
  private async guardarLocal(lineasValidas: FilaItemForm[]): Promise<void> {
    const valor = this.form.getRawValue();
    const ordenExistente = this.ordenActiva();

    let orden: OrdenCompra;
    if (ordenExistente) {
      orden = await firstValueFrom(
        this.data.modificacion<OrdenCompra>('OrdenCompra', {
          ...ordenExistente,
          proveedorId: valor.proveedorId,
          bodegaDestinoId: valor.bodegaDestinoId,
          fecha: valor.fecha,
          fechaEntregaEstimada: valor.fechaEntregaEstimada || null,
          notas: valor.notas || null,
        }),
      );
    } else {
      orden = await firstValueFrom(
        this.data.alta<OrdenCompra>('OrdenCompra', {
          folio: folioSugeridoOrdenCompra(this.ordenes()),
          proveedorId: valor.proveedorId,
          bodegaDestinoId: valor.bodegaDestinoId,
          fecha: valor.fecha,
          fechaEntregaEstimada: valor.fechaEntregaEstimada || null,
          notas: valor.notas || null,
          estado: 'pendiente',
        }),
      );
    }

    if (this.puedeEditarItems()) {
      const itemsPrevios = this.items().filter((i) => i.ordenCompraId === orden.id);
      for (const previo of itemsPrevios) {
        await firstValueFrom(this.data.baja('OrdenCompraItem', previo.id));
      }
      for (const linea of lineasValidas) {
        await firstValueFrom(
          this.data.alta<OrdenCompraItem>('OrdenCompraItem', {
            ordenCompraId: orden.id,
            productoId: linea.productoId,
            cantidad: Number(linea.cantidadTexto),
            costoUnitario: Number(linea.costoUnitarioTexto) || 0,
            cantidadRecibida: 0,
            unidadId: linea.unidadId,
            factorConversion: linea.unidadId ? (linea.factorConversionCompra ?? 1) : 1,
          }),
        );
      }
    }

    this.toast.exito(ordenExistente ? 'Orden actualizada.' : `Orden ${orden.folio} creada.`);
    this.volverALista();
  }

  cambiarARecibir(index: number, texto: string): void {
    this.filasRecepcion.update((filas) => filas.map((f, i) => (i === index ? { ...f, aRecibirTexto: texto } : f)));
  }

  async confirmarRecepcion(): Promise<void> {
    const orden = this.ordenActiva();
    if (!orden) return;

    const lineas: LineaRecepcion[] = this.filasRecepcion()
      .map((f) => ({ item: f.item, cantidadARecibir: Math.min(Number(f.aRecibirTexto) || 0, f.pendiente) }))
      .filter((l) => l.cantidadARecibir > 0);

    if (lineas.length === 0) {
      this.toast.advertencia('Captura al menos una cantidad a recibir.');
      return;
    }

    this.recibiendo.set(true);
    try {
      await this.ordenCompraService.recibir(orden, lineas);
      this.toast.exito('Recepción registrada.');
      await this.cargarListado();
      await this.abrirOrdenPorId(orden.id);
    } finally {
      this.recibiendo.set(false);
    }
  }

  pedirEliminar(fila: FilaOrdenCompra): void {
    this.ordenAEliminar.set(fila);
  }

  async confirmarEliminar(): Promise<void> {
    const orden = this.ordenAEliminar();
    if (!orden) return;
    if (orden.estado !== 'pendiente') {
      this.toast.error('Solo se puede eliminar una orden pendiente (sin nada recibido).');
      this.ordenAEliminar.set(null);
      return;
    }
    const itemsDeOrden = await firstValueFrom(
      this.data.list<OrdenCompraItem>('OrdenCompraItem', { ordenCompraId: orden.id }),
    );
    for (const item of itemsDeOrden) {
      await firstValueFrom(this.data.baja('OrdenCompraItem', item.id));
    }
    await firstValueFrom(this.data.baja('OrdenCompra', orden.id));
    this.toast.exito('Orden eliminada.');
    this.ordenAEliminar.set(null);
    this.cargarListado();
  }
}

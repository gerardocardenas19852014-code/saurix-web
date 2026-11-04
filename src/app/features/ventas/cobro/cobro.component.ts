import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DataClientService, FILTRO_BUSQUEDA } from '../../../core/services/data-client.service';
import { AuthService } from '../../../core/services/auth.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { ToastService } from '../../../shared/services/toast.service';
import { ProgramaLealtadService } from '../lealtad/lealtad.service';
import { SelectBuscableComponent, OpcionBuscable } from '../../../shared/components/select-buscable/select-buscable.component';
import { EscaneoCodigoComponent } from '../../../shared/components/escaneo-codigo/escaneo-codigo.component';
import { EscaneoGlobalService } from '../../../shared/services/escaneo-global.service';
import { Producto } from '../../inventario/productos/producto.model';
import { existenciaTotal, tieneBodegaAsignada } from '../../inventario/productos/producto.util';
import { CategoriaProducto } from '../../inventario/categorias-producto/categoria-producto.model';
import { Bodega } from '../../inventario/bodegas/bodega.model';
import { ExistenciaBodega } from '../../inventario/movimientos-bodega/existencia-bodega.model';
import { TipoListaPrecio } from '../../inventario/tipos-lista-precio/tipo-lista-precio.model';
import { PrecioLista } from '../../inventario/listas-precio/precio-lista.model';
import { construirTicketHtml, ESTILO_TICKET, formatMoneda, redondear } from '../ventas.util';
import { imprimirHtml } from '../../../shared/utils/imprimir.util';
import { nombreCompletoUsuario } from '../../seguridad/usuarios/usuario.model';
import { Cliente } from '../clientes/cliente.model';
import { ClienteService } from '../clientes/cliente.service';
import { ClienteFormModalComponent } from '../clientes/cliente-form-modal.component';
import { TurnoCaja } from '../turno/turno-caja.model';
import { TurnoCajaService } from '../turno/turno-caja.service';
import { CANALES_SUGERIDOS, folioSugeridoDespuesDe, folioSugeridoVenta, VentaService } from '../venta/venta.service';
import { MetodoPago, METODOS_PAGO, Venta } from '../venta/venta.model';
import { CargaVentaPedidoTienda, CargaVentaPedidoTiendaService } from '../carga-venta-pedido-tienda.service';
import { PedidoTiendaService } from '../pedidos-tienda/pedido-tienda.service';

/** Un renglón del carrito, antes de convertirse en VentaItem (ver venta.model.ts).
 *  `productoId: null` = renglón de "Venta simple". */
interface ItemCarrito {
  productoId: number | null;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  descuentoPct: number;
  bodegaId: number | null;
}

interface PagoUI {
  metodoPago: MetodoPago;
  monto: number;
  montoRecibido: number | null;
  cambio: number | null;
}

/** Copia "congelada" de un renglón/pago ya cobrado, para poder imprimir el
 *  ticket en el panel de "Venta registrada" sin depender de que el
 *  carrito/pagos sigan intactos (se limpian justo después de cobrar). */
interface ItemTicket {
  cantidad: number;
  descripcion: string;
  precioUnitario: number;
  subtotal: number;
}
interface PagoTicket {
  metodoPago: MetodoPago;
  monto: number;
  cambio: number | null;
}

/** Cuántos productos trae cada página de la cuadrícula de búsqueda — 20,
 *  tal como pide el prompt maestro Ventas→Cobro (2026-11, Cambio 1),
 *  reemplazando los 30 del informe "eliminar 8 cargas" anterior. */
const TAMANO_PAGINA_PRODUCTOS = 20;
/** Tope de ExistenciaBodega/PrecioLista por producto nuevo que se pide de
 *  golpe (ver cargarExistenciaYPrecioPara()) — generoso a propósito (nunca
 *  se ha visto un producto con más de un puñado de bodegas o listas) para
 *  no tener que leer bodegas()/listasPrecio() antes de poder pedir esto. */
const TOPE_FILAS_POR_PRODUCTO = 20;

/**
 * Pantalla principal de Ventas — "Cobro": pensada para móvil/touch, con
 * cuadrícula de productos + búsqueda/categoría a la izquierda y el ticket
 * (carrito, cliente, totales, cobrar) a la derecha. Replica el flujo de la
 * imagen de referencia que mandó el usuario: Venta simple para vender sin
 * capturar producto, selector de cliente con acceso directo a capturar uno
 * nuevo con datos fiscales, y un cobro que soporta Efectivo (con cambio),
 * Tarjeta, Transferencia y pago mixto (varios métodos en la misma venta).
 *
 * Sin un turno de caja Abierto no se puede cobrar — ver ngOnInit(), que
 * manda a Apertura de turno si turnoAbierto() da null.
 *
 * BÚSQUEDA Y PAGINACIÓN SERVER-SIDE (2026-11, ver claude/
 * ventas-cobro-homologacion-integral-2026-11.md — bloque "eliminar las 8
 * cargas completas"): esta pantalla dejó de descargar el catálogo de
 * Producto/Cliente/ExistenciaBodega/PrecioLista/Venta completos al abrir.
 * Reutiliza DataClientService.listarPagina()/FILTRO_BUSQUEDA (ya existente,
 * pensado para catálogos grandes — ver su comentario de clase), NO una RPC
 * nueva. `productos()` ahora es solo la PÁGINA visible de la búsqueda
 * actual, nunca el catálogo entero — por eso cualquier código que necesite
 * resolver un producto que pudo haber salido de la página visible
 * (incrementar() de una línea del carrito, "Cargar a venta" desde Pedidos
 * web) usa `productosConocidos` (caché por id, nunca se vacía durante la
 * sesión de Cobro) en vez de buscar dentro de `productos()`.
 * `existenciasBodega()`/`preciosLista()` siguen siendo los mismos arreglos
 * de siempre (producto.util.ts no se tocó) pero ahora solo contienen filas
 * de los productos ya conocidos (página visible + carrito), nunca de todo
 * el catálogo — ver cargarExistenciaYPrecioPara().
 */
@Component({
  selector: 'app-cobro',
  standalone: true,
  imports: [NgTemplateOutlet, ReactiveFormsModule, SelectBuscableComponent, ClienteFormModalComponent, EscaneoCodigoComponent],
  templateUrl: './cobro.component.html',
  styleUrl: './cobro.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CobroComponent implements OnInit, OnDestroy {
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
    if (this.debounceBusquedaProductos) clearTimeout(this.debounceBusquedaProductos);
    const pedidoOrigenId = this.pedidoTiendaOrigenId();
    if (pedidoOrigenId !== null) this.pedidoTiendaService.liberar(pedidoOrigenId).catch(() => {});
    this.detenerEscaneoGlobal?.();
  }

  private readonly data = inject(DataClientService);
  private readonly auth = inject(AuthService);
  /** SOLO para fn_cobro_producto_por_codigo (ver seleccionarProductoPorCodigo
   *  más abajo) — el resto de la pantalla sigue usando exclusivamente
   *  DataClientService, que no expone rpc(). Mismo patrón que
   *  VentaService.sb. */
  private readonly sb = inject(SupabaseService).cliente;
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly clienteService = inject(ClienteService);
  private readonly turnoCajaService = inject(TurnoCajaService);
  private readonly ventaService = inject(VentaService);
  private readonly cargaVentaPedidoTienda = inject(CargaVentaPedidoTiendaService);
  private readonly pedidoTiendaService = inject(PedidoTiendaService);
  protected readonly lealtadService = inject(ProgramaLealtadService);
  private readonly escaneoGlobal = inject(EscaneoGlobalService);
  /** Función de limpieza que regresa escaneoGlobal.activar() -- ver
   *  ngOnInit()/ngOnDestroy() más abajo (Cambio 3, prompt maestro
   *  Ventas→Cobro 2026-11). */
  private detenerEscaneoGlobal: (() => void) | null = null;

  protected readonly formatMoneda = formatMoneda;
  protected readonly metodosPago = METODOS_PAGO;

  protected readonly cargando = signal(true);
  protected readonly turno = signal<TurnoCaja | null>(null);
  protected readonly proximoFolio = signal('');

  // ── Catálogo de productos: página actual de la búsqueda (NUNCA el
  // catálogo completo) + caché de productos ya resueltos por id ──────────
  protected readonly productos = signal<Producto[]>([]);
  protected readonly totalProductos = signal(0);
  protected readonly cargandoProductos = signal(false);
  protected readonly hayMasProductos = computed(() => this.productos().length < this.totalProductos());
  /** Todo producto que Cobro ya resolvió una vez (página visible, código
   *  escaneado, o línea de un pedido web cargado) — se consulta por id
   *  desde incrementar()/cargarDesdePedidoTienda() en vez de buscar dentro
   *  de productos() (que ya NO contiene el catálogo completo). No es un
   *  signal a propósito: solo se lee desde código TS síncrono, nunca desde
   *  el template. */
  private readonly productosConocidos = new Map<number, Producto>();
  /** codigo normalizado (trim + minúsculas) -> Producto ya resuelto por
   *  fn_cobro_producto_por_codigo en ESTA sesión -- ver
   *  seleccionarProductoPorCodigo(). Limitada a 200 entradas (se vacía
   *  entera si se llega a ese tope -- un turno de caja realista no
   *  escanea 200 códigos DISTINTOS, así que nunca debería notarse). */
  private readonly productoPorCodigoConocido = new Map<string, Producto>();
  private static readonly TOPE_CACHE_CODIGOS = 200;
  /** ids de producto cuya ExistenciaBodega/PrecioLista ya se pidió, para
   *  no volver a pedirla cada vez que el mismo id sigue siendo conocido
   *  (ver cargarExistenciaYPrecioPara()). */
  private readonly idsConExistenciaYPrecioCargados = new Set<number>();

  protected readonly categorias = signal<CategoriaProducto[]>([]);
  protected readonly bodegas = signal<Bodega[]>([]);
  /** Acumulador — solo contiene filas de productos ya conocidos (ver
   *  arriba), nunca de todo ExistenciaBodega. existenciaTotal()/
   *  tieneBodegaAsignada() (producto.util.ts) no cambiaron: siguen
   *  esperando el arreglo completo de ExistenciaBodega "relevante", que
   *  ahora es chico por construcción en vez de ser literalmente toda la
   *  tabla. */
  protected readonly existenciasBodega = signal<ExistenciaBodega[]>([]);
  /** Igual que arriba, pero para PrecioLista. Se pide SIN filtrar por
   *  tipoListaPrecioId (ver informe: el número de listas por empresa está
   *  acotado por el mismo catálogo pequeño TipoListaPrecio, así que traer
   *  todas las listas de un puñado de productos es insignificante) — así
   *  cambiar el combo de "lista de precio" no dispara ninguna petición
   *  nueva. */
  protected readonly preciosLista = signal<PrecioLista[]>([]);
  protected readonly listasPrecio = signal<TipoListaPrecio[]>([]);

  // ── Cliente: autocomplete remoto, nunca el catálogo completo ───────────
  /** Cliente elegido ahora mismo (o el genérico al abrir) — ya NO se deriva
   *  de un arreglo completo de Cliente; se asigna explícitamente en
   *  elegirCliente()/alGuardarCliente()/ngOnInit(). */
  protected readonly clienteSeleccionado = signal<Cliente | null>(null);
  /** Mismo propósito que productosConocidos: cliente ya resuelto por id
   *  (resultado de autocomplete, el genérico, o uno recién creado), para
   *  poder leer su listaPrecioPredeterminadaId al elegirlo. */
  private readonly clientesConocidos = new Map<number, Cliente>();

  protected readonly busquedaProducto = signal('');
  protected readonly categoriaFiltro = signal<number | null>(null);
  protected readonly bodegaVentaId = signal<number | null>(null);
  protected readonly listaPrecioId = signal<number | null>(null);
  protected readonly clienteId = signal<number | null>(null);
  /** Texto libre (ver venta.model.ts) — vacío = mostrador normal. Útil
   *  sobre todo para capturar a mano una venta que llegó por /tienda
   *  (pedido recibido por WhatsApp/correo) una vez que ya se validó. */
  protected readonly canalVenta = signal('');
  protected readonly canalesSugeridos = CANALES_SUGERIDOS;

  protected readonly carrito = signal<ItemCarrito[]>([]);
  /** Distinto de null mientras el carrito actual viene de "Cargar a
   *  venta" (ver Pedidos web) — solo para, AL COBRAR, vincular ese
   *  pedido/orden con la Venta resultante (nunca antes: "cargar a venta"
   *  ≠ "venta cobrada", sección 19 del plan). Se limpia si el carrito se
   *  vacía por completo antes de cobrar, para no vincular por error una
   *  venta que ya no tiene nada que ver con ese pedido. */
  protected readonly pedidoTiendaOrigenId = signal<number | null>(null);

  protected readonly modalVentaSimpleAbierto = signal(false);
  protected readonly modalClienteAbierto = signal(false);
  protected readonly modalPagoAbierto = signal(false);
  /** Cajón/modal del ticket en celular (Cambio 2, prompt maestro
   *  Ventas→Cobro 2026-11) — en computadora el ticket sigue siempre
   *  visible en la columna derecha (.pos-ticket, ver scss) y esta señal
   *  no tiene ningún efecto ahí. En celular el ticket arranca oculto;
   *  este botón flotante "Ver ticket" lo abre como modal y cerrarlo
   *  NUNCA toca carrito/pagos/cliente -- solo oculta el panel. */
  protected readonly ticketMovilAbierto = signal(false);
  protected readonly procesandoVenta = signal(false);
  /** Doble clic / doble Enter en "Agregar" de Venta simple (ver informe,
   *  sección de validaciones): mismo criterio que procesandoVenta arriba. */
  protected readonly procesandoVentaSimple = signal(false);
  protected readonly pagos = signal<PagoUI[]>([]);

  /** Panel de "Venta registrada" que aparece justo después de cobrar, con
   *  folio + botón de Imprimir ticket — ver confirmarCobro(). */
  protected readonly ventaRecienCobrada = signal<Venta | null>(null);
  protected readonly clienteRecienCobrado = signal('');
  protected readonly itemsTicket = signal<ItemTicket[]>([]);
  protected readonly pagosTicket = signal<PagoTicket[]>([]);

  protected readonly ventaSimpleForm = this.fb.nonNullable.group({
    descripcion: ['', Validators.required],
    monto: [0, [Validators.required, Validators.min(0.01)]],
  });

  protected readonly pagoForm = this.fb.nonNullable.group({
    metodoPago: ['Efectivo' as MetodoPago, Validators.required],
    monto: [0, [Validators.required, Validators.min(0.01)]],
    montoRecibido: [null as number | null],
  });

  protected readonly subtotalCarrito = computed(() =>
    redondear(this.carrito().reduce((acc, i) => acc + i.cantidad * i.precioUnitario, 0)),
  );
  protected readonly descuentoCarrito = computed(() =>
    redondear(this.carrito().reduce((acc, i) => acc + i.cantidad * i.precioUnitario * (i.descuentoPct / 100), 0)),
  );
  protected readonly totalCarrito = computed(() => redondear(this.subtotalCarrito() - this.descuentoCarrito()));

  // ── Programa de lealtad (ver lealtad.service.ts) ────────────────────────
  protected readonly puntosACanjear = signal(0);

  /** Puntos disponibles del cliente elegido — 0 si es el genérico "Público
   *  en General" o si el programa está apagado (no tiene sentido ofrecer
   *  canjear algo que no se puede canjear). */
  protected readonly puntosDisponiblesCliente = computed(() => {
    const cliente = this.clienteSeleccionado();
    if (!cliente || cliente.esGenerico || !this.lealtadService.programaActivo()) return 0;
    return this.lealtadService.puntosDeCliente(cliente);
  });

  protected readonly descuentoPuntosSeleccionado = computed(() =>
    Math.min(this.lealtadService.descuentoPorPuntos(this.puntosACanjear()), this.totalCarrito()),
  );

  /** Total real a cobrar, ya con el descuento de puntos aplicado — esto es
   *  lo que de verdad hay que cubrir con los pagos (ver faltantePorPagar). */
  protected readonly totalConPuntos = computed(() =>
    redondear(Math.max(0, this.totalCarrito() - this.descuentoPuntosSeleccionado())),
  );

  protected readonly totalPagado = computed(() => redondear(this.pagos().reduce((acc, p) => acc + p.monto, 0)));
  protected readonly faltantePorPagar = computed(() => redondear(this.totalConPuntos() - this.totalPagado()));
  /** Suma del cambio de TODOS los pagos en efectivo ya agregados — para la
   *  jerarquía visual del modal Cobrar (ver informe, sección de UX):
   *  "Falta" si todavía falta cubrir el total; si no, "Cambio: $X.XX" si de
   *  verdad hay algo que entregar, o "Pagado ✓" si quedó exacto. */
  protected readonly cambioTotalPagos = computed(() => redondear(this.pagos().reduce((acc, p) => acc + (p.cambio ?? 0), 0)));

  async ngOnInit(): Promise<void> {
    document.documentElement.setAttribute('data-wide', 'grid');

    const usuario = this.auth.usuarioActual();
    if (!usuario) return;

    await this.lealtadService.cargar();

    // turnoAbiertoOCrear(): si "Apertura de caja" está desactivada, abre un
    // turno en silencio en vez de mandar a una pantalla que ya ni aparece en
    // el menú (ver su comentario en TurnoCajaService) — así Cobro no se queda
    // esperando algo que el negocio nunca podría crear.
    const turno = await this.turnoCajaService.turnoAbiertoOCrear(usuario.id);
    if (!turno) {
      this.router.navigateByUrl('/ventas/apertura-turno');
      return;
    }
    this.turno.set(turno);

    // Catálogos chicos (Categoría/Bodega/TipoListaPrecio): se quedan
    // full-load tal cual — decenas de filas cuando mucho, cambian poco, y
    // alimentan selects/chips que necesitan verse completos de entrada
    // (ver informe "eliminar 8 cargas", clasificación de catálogos
    // pequeños). El folio sugerido ya no descarga Venta completa: solo la
    // fila con el id más alto (los folios los asigna fn_venta_registrar()
    // en orden estrictamente creciente, así que el id más alto siempre
    // tiene el folio más alto).
    const [categorias, bodegas, listasPrecio, ultimaVenta] = await Promise.all([
      firstValueFrom(this.data.list<CategoriaProducto>('CategoriaProducto')),
      firstValueFrom(this.data.list<Bodega>('Bodega')),
      firstValueFrom(this.data.list<TipoListaPrecio>('TipoListaPrecio')),
      firstValueFrom(this.data.listarPagina<Venta>('Venta', undefined, 0, 1, { columna: 'id', direccion: 'desc' })),
    ]);

    this.categorias.set(categorias.filter((c) => c.activo !== false));
    this.bodegas.set(bodegas.filter((b) => b.activo !== false));
    this.listasPrecio.set(listasPrecio.filter((l) => l.activo !== false));
    this.proximoFolio.set(
      ultimaVenta.filas[0] ? folioSugeridoDespuesDe(ultimaVenta.filas[0].folio) : folioSugeridoVenta([]),
    );

    this.bodegaVentaId.set(this.bodegas()[0]?.id ?? null);

    const generico = await this.clienteService.obtenerOCrearGenerico();
    this.clientesConocidos.set(generico.id, generico);
    this.clienteId.set(generico.id);
    this.clienteSeleccionado.set(generico);

    // Primera página del catálogo de productos (server-side, ver
    // buscarProductos()) — reemplaza el antiguo `data.list('Producto')`
    // sin filtro.
    await this.buscarProductos(true);

    this.cargando.set(false);

    // "Cargar a venta" desde Pedidos web (ver CargaVentaPedidoTiendaService)
    // — se consume UNA sola vez, después de que ya está todo lo necesario
    // para precargar el carrito (bodegaVentaId). Si no hay nada pendiente,
    // tomar() regresa null y no pasa nada.
    const carga = this.cargaVentaPedidoTienda.tomar();
    if (carga) await this.cargarDesdePedidoTienda(carga);

    // Cambio 3 (prompt maestro Ventas→Cobro 2026-11): escaneo con pistola
    // SIN necesitar seleccionar ningún campo. Se apaga solo (ver
    // "habilitado" en EscaneoGlobalService) mientras cualquiera de estos
    // modales esté abierto -- el propio <input> de app-escaneo-codigo
    // sigue funcionando normal en ese caso, este detector global
    // sencillamente no interfiere.
    this.detenerEscaneoGlobal = this.escaneoGlobal.activar({
      habilitado: () =>
        !this.cargando() &&
        !this.modalVentaSimpleAbierto() &&
        !this.modalClienteAbierto() &&
        !this.modalPagoAbierto() &&
        !this.ventaRecienCobrada(),
      alDetectar: (codigo) => this.seleccionarProductoPorCodigo(codigo),
    });
  }

  // ── Catálogo / búsqueda server-side ─────────────────────────────────────
  /** Caja de búsqueda: debounce manual ~300ms (mismo criterio que
   *  SelectBuscableComponent en modo remoto, sin agregar RxJS a esta
   *  pantalla) + descarte de respuestas obsoletas (secuenciaBusquedaProductos
   *  en buscarProductos()). */
  private debounceBusquedaProductos: ReturnType<typeof setTimeout> | null = null;
  private secuenciaBusquedaProductos = 0;

  protected alEscribirBusqueda(texto: string): void {
    this.busquedaProducto.set(texto);
    if (this.debounceBusquedaProductos) clearTimeout(this.debounceBusquedaProductos);
    this.debounceBusquedaProductos = setTimeout(() => this.buscarProductos(true), texto.trim() ? 300 : 0);
  }

  /** Se quitó el botón "Todas" (Cambio 1, prompt maestro Ventas→Cobro
   *  2026-11): ahora pulsar la categoría YA seleccionada la desmarca y
   *  regresa al catálogo general (categoriaFiltro = null), en vez de no
   *  hacer nada como antes. */
  protected alCambiarCategoria(categoriaId: number): void {
    const nuevoValor = this.categoriaFiltro() === categoriaId ? null : categoriaId;
    this.categoriaFiltro.set(nuevoValor);
    this.buscarProductos(true);
  }

  /** Única función que de verdad consulta Producto — con filtro de texto
   *  (nombre/código, OR) y categoría aplicados del lado del servidor
   *  (listarPagina + FILTRO_BUSQUEDA, ver DataClientService), nunca
   *  descargando el catálogo completo para filtrarlo en Angular.
   *  reset=true: nueva búsqueda (reemplaza la página); reset=false:
   *  "cargar más" (desde = lo que ya se tiene). */
  private async buscarProductos(reset: boolean): Promise<void> {
    const miSecuencia = ++this.secuenciaBusquedaProductos;
    const desde = reset ? 0 : this.productos().length;
    this.cargandoProductos.set(true);
    try {
      const texto = this.busquedaProducto().trim();
      const filtro: Record<string, unknown> = { activo: true };
      const categoria = this.categoriaFiltro();
      if (categoria !== null) filtro['categoriaProductoId'] = categoria;
      if (texto) filtro[FILTRO_BUSQUEDA] = { columnas: ['nombre', 'codigo'], texto };

      const resultado = await firstValueFrom(
        this.data.listarPagina<Producto>('Producto', filtro, desde, TAMANO_PAGINA_PRODUCTOS, { columna: 'nombre' }),
      );
      if (miSecuencia !== this.secuenciaBusquedaProductos) return; // ya hay una búsqueda más nueva en curso

      this.productos.set(reset ? resultado.filas : [...this.productos(), ...resultado.filas]);
      this.totalProductos.set(resultado.total);
      for (const p of resultado.filas) this.productosConocidos.set(p.id, p);
      await this.cargarExistenciaYPrecioPara(resultado.filas.map((p) => p.id));
    } finally {
      if (miSecuencia === this.secuenciaBusquedaProductos) this.cargandoProductos.set(false);
    }
  }

  protected cargarMasProductos(): void {
    if (this.cargandoProductos() || !this.hayMasProductos()) return;
    this.buscarProductos(false);
  }

  /** Pide ExistenciaBodega/PrecioLista SOLO para los ids de producto que
   *  todavía no se conocían (página nueva de búsqueda, código escaneado, o
   *  línea de un pedido web) — nunca el catálogo completo de ninguna de
   *  las dos tablas. Se pide SIN filtrar por bodega: así, al cambiar la
   *  "Bodega de venta" en el selector, ya no hace falta ninguna petición
   *  nueva (ya se tiene la existencia de TODAS las bodegas de estos pocos
   *  productos) — más eficiente que filtrar por la bodega seleccionada y
   *  tener que volver a pedir en cada cambio, y sin esa diferencia
   *  tieneBodegaAsignada() (que necesita saber si el producto tiene ALGÚN
   *  registro, en cualquier bodega) dejaría de funcionar igual que antes.
   *  Ver informe, precisión 1. */
  private async cargarExistenciaYPrecioPara(ids: number[]): Promise<void> {
    const nuevos = [...new Set(ids)].filter((id) => !this.idsConExistenciaYPrecioCargados.has(id));
    if (nuevos.length === 0) return;
    for (const id of nuevos) this.idsConExistenciaYPrecioCargados.add(id);

    const tope = nuevos.length * TOPE_FILAS_POR_PRODUCTO;
    const [existencias, precios] = await Promise.all([
      firstValueFrom(this.data.listarPagina<ExistenciaBodega>('ExistenciaBodega', { productoId: nuevos }, 0, tope)),
      firstValueFrom(this.data.listarPagina<PrecioLista>('PrecioLista', { productoId: nuevos }, 0, tope)),
    ]);
    this.existenciasBodega.update((lista) => [...lista, ...existencias.filas]);
    this.preciosLista.update((lista) => [...lista, ...precios.filas]);
  }

  precioProducto(producto: Producto): number {
    const lista = this.listaPrecioId();
    if (lista !== null) {
      const especial = this.preciosLista().find((p) => p.tipoListaPrecioId === lista && p.productoId === producto.id);
      if (especial) return especial.precio;
    }
    return producto.precioUnitario;
  }

  /** null = servicio (sin inventario que controlar, ver producto.model.ts).
   *  Sin cambios de lógica respecto a la versión anterior (producto.util.ts
   *  no se tocó) — solo cambió qué tan grande es existenciasBodega(). */
  existenciaDisponible(producto: Producto): number | null {
    if (producto.existencia === null) return null;
    const bodegaId = this.bodegaVentaId();
    if (bodegaId !== null && tieneBodegaAsignada(producto.id, this.existenciasBodega())) {
      return this.existenciasBodega().find((e) => e.productoId === producto.id && e.bodegaId === bodegaId)?.existencia ?? 0;
    }
    return existenciaTotal(producto, this.existenciasBodega());
  }

  // ── Escáner de código de barras ──────────────────────────────────────
  /** Agrega un producto escaneando su código de barras (app-escaneo-codigo,
   *  mismo componente que ya usan Movimientos entre bodegas e Inventario) —
   *  mismo criterio de búsqueda normalizada (trim + minúsculas) que
   *  MovimientosBodegaComponent.seleccionarPorCodigo(). Bloque F (ver la
   *  sección 8 del plan "Menú + Mi orden"): el MISMO lector, sin agregar
   *  ninguno nuevo, también distingue un código de barras de producto (de
   *  siempre) de un "QR de orden Saurix" (SAURIX:ORDER:<token>, ver
   *  catalogo-tienda.component.ts) y en ese caso carga la orden completa
   *  en vez de buscar un producto — reutiliza exactamente la misma
   *  revalidación/carga de "Cargar a venta" del Bloque E
   *  (cargarDesdePedidoTienda()), nunca una segunda implementación.
   *
   *  BÚSQUEDA SERVER-SIDE (2026-11): independiente de la página visible de
   *  productos() — antes buscaba dentro del catálogo completo ya
   *  descargado; ahora usa inventario.fn_cobro_producto_por_codigo(), una
   *  función puntual de coincidencia EXACTA (mismo patrón ya existente en
   *  Órdenes de compra, fn_ordenes_compra_producto_por_codigo) porque el
   *  filtro genérico de DataClientService solo sabe hacer "contiene"
   *  (ilike %texto%) sobre columnas de texto, nunca una igualdad exacta —
   *  justo lo que un código de barras escaneado necesita. */
  async seleccionarProductoPorCodigo(codigo: string): Promise<void> {
    const token = this.extraerTokenOrdenSaurix(codigo);
    if (token) {
      await this.cargarOrdenPorToken(token);
      return;
    }

    const codigoNormalizado = codigo.trim();
    if (!codigoNormalizado) return;
    const claveCache = codigoNormalizado.toLowerCase();

    let encontrado = this.productoPorCodigoConocido.get(claveCache);
    if (!encontrado) {
      const { data: fila, error } = await this.sb
        .schema('inventario')
        .rpc('fn_cobro_producto_por_codigo', { p_codigo: codigoNormalizado })
        .maybeSingle();
      if (error) {
        this.toast.error('No se pudo buscar el código: ' + error.message);
        return;
      }
      if (!fila) {
        this.toast.advertencia(`No se encontró ningún producto activo con el código "${codigo}".`);
        return;
      }
      encontrado = this.filaProductoACamel(fila as Record<string, unknown>);
      if (this.productoPorCodigoConocido.size >= CobroComponent.TOPE_CACHE_CODIGOS) this.productoPorCodigoConocido.clear();
      this.productoPorCodigoConocido.set(claveCache, encontrado);
    }
    this.productosConocidos.set(encontrado.id, encontrado);
    await this.cargarExistenciaYPrecioPara([encontrado.id]);
    this.agregarProducto(encontrado);
  }

  /** null = no es un QR de orden Saurix (es un código de barras normal,
   *  sigue el camino de siempre). El token son los 32 caracteres hex de
   *  ventas.pedido_tienda.token_publico (ver
   *  ventas.fn_asignar_folio_pedido_tienda()). */
  private extraerTokenOrdenSaurix(codigo: string): string | null {
    const coincidencia = codigo.trim().match(/^SAURIX:ORDER:([0-9a-f]{32})$/i);
    return coincidencia ? coincidencia[1].toLowerCase() : null;
  }

  /** PedidoTiendaService.resolverPorToken() ya viene filtrado por RLS a la
   *  empresa actual (ver su comentario) — un QR de la empresa A escaneado
   *  en la caja de la empresa B simplemente no encuentra nada, nunca
   *  expone ni carga el pedido de otra empresa (sección 23 del plan). */
  private async cargarOrdenPorToken(token: string): Promise<void> {
    const pedido = await this.pedidoTiendaService.resolverPorToken(token);
    if (!pedido) {
      this.toast.advertencia('Ese código QR de orden no corresponde a ningún pedido de esta tienda.');
      return;
    }
    if (pedido.estado !== 'Pendiente') {
      this.toast.advertencia(`La orden ${pedido.folio ?? pedido.id} ya quedó "${pedido.estado}" — ya no se puede cargar.`);
      return;
    }

    // Reclamo atómico (Bloque G, sección 21 del plan): el estado recién
    // leído arriba es solo para un mensaje rápido y amable — quien de
    // verdad decide si esta caja puede tomar la orden es este UPDATE
    // condicionado del lado del servidor (ver
    // PedidoTiendaService.reclamar()), igual que en
    // PedidosTiendaComponent.cargarAVenta()/abrirConfirmar(): nunca se
    // confía solo en lo que ya se tenía cargado en Angular.
    const reclamado = await this.pedidoTiendaService.reclamar(pedido.id);
    if (!reclamado) {
      this.toast.advertencia(`La orden ${pedido.folio ?? pedido.id} ya está siendo atendida en otra caja (o ya cambió de estado).`);
      return;
    }

    try {
      const lineas = await this.pedidoTiendaService.revalidarItems(pedido.id);
      if (lineas.length === 0) {
        this.toast.advertencia('Esa orden no tiene productos que cargar.');
        this.pedidoTiendaService.liberar(pedido.id).catch(() => {});
        return;
      }
      const nombre = pedido.nombreCliente ?? pedido.nombreMostrarEn;
      const etiquetaOrigen = pedido.origen === 'menu_qr' ? 'Menú QR' : 'Tienda en línea';
      const canal = [etiquetaOrigen, pedido.folio, nombre].filter(Boolean).join(' — ');
      await this.cargarDesdePedidoTienda({ pedidoId: pedido.id, canal, lineas });
    } catch (e) {
      this.toast.error('No se pudo cargar la orden escaneada: ' + (e instanceof Error ? e.message : 'error desconocido'));
      this.pedidoTiendaService.liberar(pedido.id).catch(() => {});
    }
  }

  /** Ver el comentario grande de pedidoTiendaOrigenId arriba. Nunca
   *  bloquea nada: cada renglón se agrega tal cual, con el precio YA
   *  revalidado por el servidor (ver PedidoTiendaService.revalidarItems())
   *  — aquí solo se revisa EXISTENCIA (ver existenciaDisponible(), que
   *  depende de bodegaVentaId() y por eso se checa aquí, no en el
   *  servidor) y se avisa, sin impedir cobrar igual.
   *
   *  2026-11: ahora resuelve cualquier productoId que todavía no esté en
   *  productosConocidos (un pedido web puede traer productos que esta
   *  caja nunca buscó/agregó antes) con UNA consulta acotada a esos pocos
   *  ids — nunca con el catálogo completo, que es justo lo que garantizaba
   *  (por descarga total) que `.find()` siempre encontrara el producto en
   *  la versión anterior. */
  private async cargarDesdePedidoTienda(carga: CargaVentaPedidoTienda): Promise<void> {
    this.pedidoTiendaOrigenId.set(carga.pedidoId);
    this.canalVenta.set(carga.canal);

    const idsFaltantes = [
      ...new Set(carga.lineas.map((l) => l.productoId).filter((id): id is number => id !== null)),
    ].filter((id) => !this.productosConocidos.has(id));
    if (idsFaltantes.length > 0) {
      const resultado = await firstValueFrom(
        this.data.listarPagina<Producto>('Producto', { id: idsFaltantes }, 0, idsFaltantes.length),
      );
      for (const p of resultado.filas) this.productosConocidos.set(p.id, p);
      await this.cargarExistenciaYPrecioPara(resultado.filas.map((p) => p.id));
    }

    const advertencias: string[] = [];
    const nuevasLineas: ItemCarrito[] = carga.lineas.map((linea) => {
      const producto = linea.productoId !== null ? this.productosConocidos.get(linea.productoId) : undefined;
      if (!linea.disponible) {
        advertencias.push(`${linea.descripcion}: ${linea.motivo ?? 'revisar'}`);
      } else if (producto) {
        const disponible = this.existenciaDisponible(producto);
        if (disponible !== null && linea.cantidad > disponible) {
          advertencias.push(`${linea.descripcion}: solo hay ${disponible} disponible(s)`);
        }
      }
      return {
        productoId: linea.productoId,
        descripcion: linea.descripcion,
        cantidad: linea.cantidad,
        precioUnitario: linea.precioUnitario,
        descuentoPct: 0,
        bodegaId: producto && producto.existencia !== null ? this.bodegaVentaId() : null,
      };
    });

    this.carrito.set(nuevasLineas);
    if (advertencias.length > 0) {
      this.toast.advertencia('Pedido cargado — revisa antes de cobrar: ' + advertencias.join(' · '));
    } else {
      this.toast.exito('Pedido cargado al carrito. Revisa y cobra normalmente.');
    }
  }

  // ── Carrito ───────────────────────────────────────────────────────────
  agregarProducto(producto: Producto): void {
    this.productosConocidos.set(producto.id, producto);
    const existente = this.carrito().find((i) => i.productoId === producto.id);
    const cantidadNueva = (existente?.cantidad ?? 0) + 1;

    const disponible = this.existenciaDisponible(producto);
    if (disponible !== null && cantidadNueva > disponible) {
      this.toast.advertencia(`Solo hay ${disponible} disponibles de "${producto.nombre}".`);
      return;
    }

    if (existente) {
      this.carrito.update((lista) => lista.map((i) => (i.productoId === producto.id ? { ...i, cantidad: cantidadNueva } : i)));
      return;
    }

    this.carrito.update((lista) => [
      ...lista,
      {
        productoId: producto.id,
        descripcion: producto.nombre,
        cantidad: 1,
        precioUnitario: this.precioProducto(producto),
        descuentoPct: 0,
        bodegaId: producto.existencia === null ? null : this.bodegaVentaId(),
      },
    ]);
  }

  incrementar(index: number): void {
    const item = this.carrito()[index];
    if (!item) return;
    if (item.productoId !== null) {
      const producto = this.productosConocidos.get(item.productoId) ?? null;
      const disponible = producto ? this.existenciaDisponible(producto) : null;
      if (disponible !== null && item.cantidad + 1 > disponible) {
        this.toast.advertencia('No hay más existencia disponible.');
        return;
      }
    }
    this.carrito.update((lista) => lista.map((i, idx) => (idx === index ? { ...i, cantidad: i.cantidad + 1 } : i)));
  }

  decrementar(index: number): void {
    this.carrito.update((lista) => {
      const item = lista[index];
      if (!item) return lista;
      if (item.cantidad <= 1) return lista.filter((_, idx) => idx !== index);
      return lista.map((i, idx) => (idx === index ? { ...i, cantidad: i.cantidad - 1 } : i));
    });
    this.limpiarOrigenSiCarritoVacio();
  }

  quitarLinea(index: number): void {
    this.carrito.update((lista) => lista.filter((_, idx) => idx !== index));
    this.limpiarOrigenSiCarritoVacio();
  }

  /** Ver el comentario grande de pedidoTiendaOrigenId arriba: si el
   *  cajero vació el carrito que venía de "Cargar a venta" antes de
   *  cobrar, esa vinculación ya no aplica (lo que se cobre después, si
   *  algo, ya no tiene que ver con ese pedido/orden). También suelta el
   *  reclamo (Bloque G, sección 21 del plan) para que OTRA caja pueda
   *  tomar esa orden de inmediato, en vez de esperar los 5 minutos de
   *  caducidad automática del reclamo — best-effort, no bloquea. */
  private limpiarOrigenSiCarritoVacio(): void {
    if (this.carrito().length === 0) {
      const pedidoOrigenId = this.pedidoTiendaOrigenId();
      this.pedidoTiendaOrigenId.set(null);
      if (pedidoOrigenId !== null) this.pedidoTiendaService.liberar(pedidoOrigenId).catch(() => {});
    }
  }

  /** Descuento por renglón (VentaItem.descuentoPct, ver venta.model.ts) —
   *  0-100, se aplica sobre cantidad × precioUnitario de ESE renglón. */
  actualizarDescuento(index: number, valor: string): void {
    const pct = Math.min(100, Math.max(0, Number(valor) || 0));
    this.carrito.update((lista) => lista.map((i, idx) => (idx === index ? { ...i, descuentoPct: pct } : i)));
  }

  cancelarVentaActual(): void {
    if (this.carrito().length === 0) return;
    this.carrito.set([]);
    this.limpiarOrigenSiCarritoVacio();
    this.ticketMovilAbierto.set(false); // regresa al catálogo en celular, ver Cambio 2
    this.toast.info('Venta cancelada.');
  }

  // ── Venta simple ───────────────────────────────────────────────────────
  abrirVentaSimple(): void {
    this.ventaSimpleForm.reset({ descripcion: '', monto: 0 });
    this.modalVentaSimpleAbierto.set(true);
  }

  /** Protegida contra doble clic / doble Enter (ver informe, validaciones
   *  de Venta simple): procesandoVentaSimple() deshabilita el botón de
   *  "Agregar" en el template mientras esta función corre. */
  agregarVentaSimple(): void {
    if (this.procesandoVentaSimple()) return;
    if (this.ventaSimpleForm.invalid) {
      this.ventaSimpleForm.markAllAsTouched();
      return;
    }
    this.procesandoVentaSimple.set(true);
    try {
      const valor = this.ventaSimpleForm.getRawValue();
      this.carrito.update((lista) => [
        ...lista,
        { productoId: null, descripcion: valor.descripcion, cantidad: 1, precioUnitario: redondear(valor.monto), descuentoPct: 0, bodegaId: null },
      ]);
      this.modalVentaSimpleAbierto.set(false);
    } finally {
      this.procesandoVentaSimple.set(false);
    }
  }

  // ── Cliente ───────────────────────────────────────────────────────────
  /** Autocomplete remoto para app-select-buscable (ver su comentario de
   *  clase, "MODO REMOTO" — ya usado en Movimientos entre bodegas →
   *  Historial → Producto, no es infraestructura nueva). Busca por
   *  nombre/RFC/teléfono (FILTRO_BUSQUEDA, OR) entre clientes activos,
   *  máximo 20 a la vez — reemplaza la descarga completa de Cliente.
   *  Arrow function (no método normal) porque el componente hijo invoca
   *  esta referencia directamente, sin "this": debe venir ya enlazada. */
  protected readonly buscarClientesRemoto = async (texto: string): Promise<OpcionBuscable[]> => {
    const filtro: Record<string, unknown> = { activo: true };
    const limpio = texto.trim();
    if (limpio) filtro[FILTRO_BUSQUEDA] = { columnas: ['nombre', 'rfc', 'telefono'], texto: limpio };
    const resultado = await firstValueFrom(this.data.listarPagina<Cliente>('Cliente', filtro, 0, 20, { columna: 'nombre' }));
    for (const c of resultado.filas) this.clientesConocidos.set(c.id, c);
    return resultado.filas.map((c) => ({ valor: c.id, etiqueta: this.etiquetaCliente(c) }));
  };

  private etiquetaCliente(c: Cliente): string {
    return c.esGenerico ? c.nombre : `${c.nombre} — ${c.rfc}`;
  }

  /** Etiqueta del cliente ya elegido, para que app-select-buscable (en
   *  modo remoto no tiene el catálogo completo para resolverla sola) la
   *  muestre sin tener que volver a buscar. */
  protected readonly etiquetaClienteSeleccionado = computed(() => {
    const c = this.clienteSeleccionado();
    return c ? this.etiquetaCliente(c) : '';
  });

  elegirCliente(id: number | string | null): void {
    const nuevoId = id === null ? null : Number(id);
    this.clienteId.set(nuevoId);
    this.puntosACanjear.set(0); // cambiar de cliente invalida cualquier canje que se tuviera capturado

    const cliente = nuevoId === null ? null : this.clientesConocidos.get(nuevoId) ?? null;
    this.clienteSeleccionado.set(cliente);

    // "Información de venta" del cliente (ver cliente-form-modal.component.ts):
    // su lista de precio predeterminada se preselecciona aquí — sigue siendo
    // un valor por default, el cajero puede cambiarla luego con el selector.
    this.listaPrecioId.set(cliente?.listaPrecioPredeterminadaId ?? null);
  }

  abrirNuevoCliente(): void {
    this.modalClienteAbierto.set(true);
  }

  alGuardarCliente(cliente: Cliente): void {
    this.clientesConocidos.set(cliente.id, cliente);
    this.clienteId.set(cliente.id);
    this.clienteSeleccionado.set(cliente);
    this.puntosACanjear.set(0);
    this.modalClienteAbierto.set(false);
  }

  /** Clamba la cantidad de puntos a canjear entre 0 y los puntos disponibles del cliente. */
  actualizarPuntosACanjear(valorTexto: string): void {
    const valor = Number(valorTexto);
    const disponibles = this.puntosDisponiblesCliente();
    if (!Number.isFinite(valor) || valor <= 0) {
      this.puntosACanjear.set(0);
      return;
    }
    this.puntosACanjear.set(Math.min(Math.floor(valor), disponibles));
  }

  // ── Cobro ───────────────────────────────────────────────────────────
  abrirPago(): void {
    if (this.carrito().length === 0) {
      this.toast.advertencia('Agrega al menos un producto o una venta simple.');
      return;
    }
    this.pagos.set([]);
    this.pagoForm.reset({ metodoPago: 'Efectivo', monto: this.totalConPuntos(), montoRecibido: null });
    this.modalPagoAbierto.set(true);
  }

  agregarPago(): void {
    if (this.pagoForm.invalid) {
      this.pagoForm.markAllAsTouched();
      return;
    }
    const valor = this.pagoForm.getRawValue();
    const faltante = this.faltantePorPagar();
    if (valor.monto > faltante + 0.01) {
      this.toast.advertencia(`El monto no puede ser mayor al saldo pendiente (${this.formatMoneda(faltante)}).`);
      return;
    }
    if (valor.metodoPago === 'Crédito' && this.clienteSeleccionado()?.esGenerico) {
      this.toast.advertencia('Elige un cliente real para vender a crédito — "Público en General" no puede fiar.');
      return;
    }

    const esEfectivo = valor.metodoPago === 'Efectivo';
    const montoRecibido = esEfectivo && valor.montoRecibido ? valor.montoRecibido : null;
    const cambio = montoRecibido !== null && montoRecibido > valor.monto ? redondear(montoRecibido - valor.monto) : null;

    this.pagos.update((lista) => [
      ...lista,
      { metodoPago: valor.metodoPago, monto: redondear(valor.monto), montoRecibido, cambio },
    ]);

    const nuevoFaltante = Math.max(0, this.faltantePorPagar());
    this.pagoForm.reset({ metodoPago: 'Efectivo', monto: nuevoFaltante, montoRecibido: null });
  }

  quitarPago(index: number): void {
    this.pagos.update((lista) => lista.filter((_, idx) => idx !== index));
    this.pagoForm.patchValue({ monto: Math.max(0, this.faltantePorPagar()) });
  }

  get montoRecibidoVisible(): boolean {
    return this.pagoForm.controls.metodoPago.value === 'Efectivo';
  }

  cambioEstimado(): number | null {
    const valor = this.pagoForm.getRawValue();
    if (valor.metodoPago !== 'Efectivo' || !valor.montoRecibido) return null;
    const cambio = valor.montoRecibido - valor.monto;
    return cambio > 0 ? redondear(cambio) : null;
  }

  async confirmarCobro(): Promise<void> {
    const turno = this.turno();
    const usuario = this.auth.usuarioActual();
    const clienteId = this.clienteId();
    if (!turno || !usuario || clienteId === null) return;

    if (this.faltantePorPagar() > 0.01) {
      this.toast.advertencia('Falta cubrir el total de la venta.');
      return;
    }

    // Copia "congelada" para el ticket — carrito/pagos se limpian abajo en
    // cuanto la venta queda registrada. idsVendidos se captura AQUÍ (antes
    // de vaciar el carrito) para poder refrescar solo esa existencia
    // después de cobrar (ver abajo).
    const itemsParaTicket: ItemTicket[] = this.carrito().map((i) => ({
      cantidad: i.cantidad,
      descripcion: i.descripcion,
      precioUnitario: i.precioUnitario,
      subtotal: redondear(i.cantidad * i.precioUnitario * (1 - i.descuentoPct / 100)),
    }));
    const pagosParaTicket: PagoTicket[] = this.pagos().map((p) => ({ metodoPago: p.metodoPago, monto: p.monto, cambio: p.cambio }));
    const nombreCliente = this.clienteSeleccionado()?.nombre ?? '';
    const idsVendidos = [...new Set(this.carrito().map((i) => i.productoId).filter((id): id is number => id !== null))];

    this.procesandoVenta.set(true);
    try {
      const venta = await this.ventaService.registrar({
        turnoCajaId: turno.id,
        clienteId,
        vendedorUsuarioId: usuario.id,
        notas: null,
        canal: this.canalVenta(),
        lineas: this.carrito().map((i) => ({
          productoId: i.productoId,
          descripcion: i.descripcion,
          cantidad: i.cantidad,
          precioUnitario: i.precioUnitario,
          descuentoPct: i.descuentoPct,
          bodegaId: i.bodegaId,
        })),
        pagos: this.pagos().map((p) => ({ metodoPago: p.metodoPago, monto: p.monto, montoRecibido: p.montoRecibido, cambio: p.cambio })),
        puntosACanjear: this.puntosACanjear(),
      });

      this.toast.exito(`Venta ${venta.folio} registrada.`);

      // Vincula el pedido/orden de origen ("Cargar a venta" desde Pedidos
      // web) con la Venta que acaba de quedar registrada — SOLO hasta
      // ahora, nunca antes (ver pedidoTiendaOrigenId arriba). Si falla, la
      // venta ya registrada NO se deshace: solo se avisa, el pedido se
      // queda "Pendiente" y el staff lo puede resolver a mano.
      const pedidoOrigenId = this.pedidoTiendaOrigenId();
      if (pedidoOrigenId !== null) {
        this.pedidoTiendaOrigenId.set(null);
        this.pedidoTiendaService.marcarConfirmadoDesdeVenta(pedidoOrigenId, venta.id).catch(() => {
          this.toast.advertencia('La venta se registró, pero no se pudo actualizar el pedido de origen en Pedidos web.');
        });
      }

      this.carrito.set([]);
      this.pagos.set([]);
      this.puntosACanjear.set(0);
      this.canalVenta.set('');
      this.modalPagoAbierto.set(false);
      this.ticketMovilAbierto.set(false); // regresa al catálogo en celular, ver Cambio 2

      this.ventaRecienCobrada.set(venta);
      this.clienteRecienCobrado.set(nombreCliente);
      this.itemsTicket.set(itemsParaTicket);
      this.pagosTicket.set(pagosParaTicket);

      // Refresca SOLO la existencia de los productos que acaban de
      // venderse (para que el grid refleje lo recién vendido) — nunca
      // ExistenciaBodega completa. El folio del siguiente ticket ya no
      // necesita ninguna petición: viene directo de venta.folio, que ya
      // regresó fn_venta_registrar() del lado del servidor.
      if (idsVendidos.length > 0) {
        const existencias = await firstValueFrom(
          this.data.listarPagina<ExistenciaBodega>('ExistenciaBodega', { productoId: idsVendidos }, 0, idsVendidos.length * TOPE_FILAS_POR_PRODUCTO),
        );
        this.existenciasBodega.update((lista) => [
          ...lista.filter((e) => !idsVendidos.includes(e.productoId)),
          ...existencias.filas,
        ]);
      }
      this.proximoFolio.set(folioSugeridoDespuesDe(venta.folio));
    } finally {
      this.procesandoVenta.set(false);
    }
  }

  /** Nombre del cajero actual — ver ventaRecienCobrada(), usado en el
   *  ticket impreso justo después de cobrar. */
  private nombreCajeroActual(): string {
    const usuario = this.auth.usuarioActual();
    return usuario ? nombreCompletoUsuario(usuario) : '';
  }

  imprimirTicketRecien(): void {
    const venta = this.ventaRecienCobrada();
    if (!venta) return;

    const cuerpo = construirTicketHtml({
      venta,
      items: this.itemsTicket(),
      pagos: this.pagosTicket(),
      clienteNombre: this.clienteRecienCobrado(),
      cajeroNombre: this.nombreCajeroActual(),
    });
    try {
      imprimirHtml(`Ticket ${venta.folio}`, cuerpo, ESTILO_TICKET);
    } catch {
      this.toast.error('No se pudo preparar la impresión del ticket.');
    }
  }

  cerrarPanelVentaRegistrada(): void {
    this.ventaRecienCobrada.set(null);
  }

  // ── Helper interno para fn_cobro_producto_por_codigo (ver arriba) ──────
  private filaProductoACamel(fila: Record<string, unknown>): Producto {
    return {
      id: fila['id'] as number,
      nombre: fila['nombre'] as string,
      codigo: (fila['codigo'] as string | null) ?? null,
      categoriaProductoId: fila['categoria_producto_id'] as number,
      unidadMedidaId: fila['unidad_medida_id'] as number,
      descripcion: (fila['descripcion'] as string | null) ?? null,
      costo: fila['costo'] as number,
      precioUnitario: fila['precio_unitario'] as number,
      existencia: (fila['existencia'] as number | null) ?? null,
      nivelMinimo: (fila['nivel_minimo'] as number | null) ?? null,
      nivelMaximo: (fila['nivel_maximo'] as number | null) ?? null,
      proveedorId: (fila['proveedor_id'] as number | null) ?? null,
      unidadCompraId: (fila['unidad_compra_id'] as number | null) ?? null,
      manejaLotes: fila['maneja_lotes'] as boolean,
      factorConversionCompra: (fila['factor_conversion_compra'] as number | null) ?? null,
      foto: (fila['foto'] as string | undefined) ?? undefined,
      destacado: fila['destacado'] as boolean,
      activo: fila['activo'] as boolean,
    };
  }
}

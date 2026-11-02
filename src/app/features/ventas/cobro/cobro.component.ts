import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../shared/services/toast.service';
import { ProgramaLealtadService } from '../lealtad/lealtad.service';
import { SelectBuscableComponent, OpcionBuscable } from '../../../shared/components/select-buscable/select-buscable.component';
import { EscaneoCodigoComponent } from '../../../shared/components/escaneo-codigo/escaneo-codigo.component';
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
import { CANALES_SUGERIDOS, folioSugeridoVenta, VentaService } from '../venta/venta.service';
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
 */
@Component({
  selector: 'app-cobro',
  standalone: true,
  imports: [ReactiveFormsModule, SelectBuscableComponent, ClienteFormModalComponent, EscaneoCodigoComponent],
  templateUrl: './cobro.component.html',
  styleUrl: './cobro.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CobroComponent implements OnInit, OnDestroy {
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
    const pedidoOrigenId = this.pedidoTiendaOrigenId();
    if (pedidoOrigenId !== null) this.pedidoTiendaService.liberar(pedidoOrigenId).catch(() => {});
  }

  private readonly data = inject(DataClientService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly clienteService = inject(ClienteService);
  private readonly turnoCajaService = inject(TurnoCajaService);
  private readonly ventaService = inject(VentaService);
  private readonly cargaVentaPedidoTienda = inject(CargaVentaPedidoTiendaService);
  private readonly pedidoTiendaService = inject(PedidoTiendaService);
  protected readonly lealtadService = inject(ProgramaLealtadService);

  protected readonly formatMoneda = formatMoneda;
  protected readonly metodosPago = METODOS_PAGO;

  protected readonly cargando = signal(true);
  protected readonly turno = signal<TurnoCaja | null>(null);
  protected readonly proximoFolio = signal('');

  protected readonly productos = signal<Producto[]>([]);
  protected readonly categorias = signal<CategoriaProducto[]>([]);
  protected readonly bodegas = signal<Bodega[]>([]);
  protected readonly existenciasBodega = signal<ExistenciaBodega[]>([]);
  protected readonly clientes = signal<Cliente[]>([]);
  protected readonly listasPrecio = signal<TipoListaPrecio[]>([]);
  protected readonly preciosLista = signal<PrecioLista[]>([]);

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
  protected readonly procesandoVenta = signal(false);
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

  protected readonly productosFiltrados = computed(() => {
    const texto = this.busquedaProducto().trim().toLowerCase();
    const categoria = this.categoriaFiltro();
    return this.productos().filter((p) => {
      if (p.activo === false) return false;
      if (categoria !== null && p.categoriaProductoId !== categoria) return false;
      if (!texto) return true;
      return p.nombre.toLowerCase().includes(texto) || (p.codigo ?? '').toLowerCase().includes(texto);
    });
  });

  protected readonly opcionesClientes = computed<OpcionBuscable[]>(() =>
    this.clientes()
      .filter((c) => c.activo !== false)
      .map((c) => ({ valor: c.id, etiqueta: c.esGenerico ? c.nombre : `${c.nombre} — ${c.rfc}` })),
  );

  protected readonly clienteSeleccionado = computed(() => this.clientes().find((c) => c.id === this.clienteId()) ?? null);

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

    const [productos, categorias, bodegas, existenciasBodega, clientes, listasPrecio, preciosLista, ventas] =
      await Promise.all([
        firstValueFrom(this.data.list<Producto>('Producto')),
        firstValueFrom(this.data.list<CategoriaProducto>('CategoriaProducto')),
        firstValueFrom(this.data.list<Bodega>('Bodega')),
        firstValueFrom(this.data.list<ExistenciaBodega>('ExistenciaBodega')),
        firstValueFrom(this.data.list<Cliente>('Cliente')),
        firstValueFrom(this.data.list<TipoListaPrecio>('TipoListaPrecio')),
        firstValueFrom(this.data.list<PrecioLista>('PrecioLista')),
        firstValueFrom(this.data.list<Venta>('Venta')),
      ]);

    this.productos.set(productos);
    this.categorias.set(categorias.filter((c) => c.activo !== false));
    this.bodegas.set(bodegas.filter((b) => b.activo !== false));
    this.existenciasBodega.set(existenciasBodega);
    this.listasPrecio.set(listasPrecio.filter((l) => l.activo !== false));
    this.preciosLista.set(preciosLista);
    this.proximoFolio.set(folioSugeridoVenta(ventas));

    this.bodegaVentaId.set(this.bodegas()[0]?.id ?? null);

    const generico = await this.clienteService.obtenerOCrearGenerico();
    const clientesConGenerico = clientes.some((c) => c.id === generico.id) ? clientes : [...clientes, generico];
    this.clientes.set(clientesConGenerico);
    this.clienteId.set(generico.id);

    this.cargando.set(false);

    // "Cargar a venta" desde Pedidos web (ver CargaVentaPedidoTiendaService)
    // — se consume UNA sola vez, después de que ya está todo lo necesario
    // para precargar el carrito (productos/bodegaVentaId). Si no hay nada
    // pendiente, tomar() regresa null y no pasa nada.
    const carga = this.cargaVentaPedidoTienda.tomar();
    if (carga) this.cargarDesdePedidoTienda(carga);
  }

  /** Ver el comentario grande de pedidoTiendaOrigenId arriba. Nunca
   *  bloquea nada: cada renglón se agrega tal cual, con el precio YA
   *  revalidado por el servidor (ver PedidoTiendaService.revalidarItems())
   *  — aquí solo se revisa EXISTENCIA (ver existenciaDisponible(), que
   *  depende de bodegaVentaId() y por eso se checa aquí, no en el
   *  servidor) y se avisa, sin impedir cobrar igual. */
  private cargarDesdePedidoTienda(carga: CargaVentaPedidoTienda): void {
    this.pedidoTiendaOrigenId.set(carga.pedidoId);
    this.canalVenta.set(carga.canal);

    const advertencias: string[] = [];
    const nuevasLineas: ItemCarrito[] = carga.lineas.map((linea) => {
      const producto = linea.productoId !== null ? this.productos().find((p) => p.id === linea.productoId) : undefined;
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

  // ── Catálogo / filtros ──────────────────────────────────────────────
  precioProducto(producto: Producto): number {
    const lista = this.listaPrecioId();
    if (lista !== null) {
      const especial = this.preciosLista().find((p) => p.tipoListaPrecioId === lista && p.productoId === producto.id);
      if (especial) return especial.precio;
    }
    return producto.precioUnitario;
  }

  /** null = servicio (sin inventario que controlar, ver producto.model.ts). */
  existenciaDisponible(producto: Producto): number | null {
    if (producto.existencia === null) return null;
    const bodegaId = this.bodegaVentaId();
    if (bodegaId !== null && tieneBodegaAsignada(producto.id, this.existenciasBodega())) {
      return this.existenciasBodega().find((e) => e.productoId === producto.id && e.bodegaId === bodegaId)?.existencia ?? 0;
    }
    return existenciaTotal(producto, this.existenciasBodega());
  }

  // ── Carrito ───────────────────────────────────────────────────────────
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
   *  (cargarDesdePedidoTienda()), nunca una segunda implementación. */
  async seleccionarProductoPorCodigo(codigo: string): Promise<void> {
    const token = this.extraerTokenOrdenSaurix(codigo);
    if (token) {
      await this.cargarOrdenPorToken(token);
      return;
    }

    const encontrado = this.productos().find(
      (p) => p.activo !== false && (p.codigo ?? '').trim().toLowerCase() === codigo.trim().toLowerCase(),
    );
    if (!encontrado) {
      this.toast.advertencia(`No se encontró ningún producto activo con el código "${codigo}".`);
      return;
    }
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
      this.cargarDesdePedidoTienda({ pedidoId: pedido.id, canal, lineas });
    } catch (e) {
      this.toast.error('No se pudo cargar la orden escaneada: ' + (e instanceof Error ? e.message : 'error desconocido'));
      this.pedidoTiendaService.liberar(pedido.id).catch(() => {});
    }
  }

  agregarProducto(producto: Producto): void {
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
      const producto = this.productos().find((p) => p.id === item.productoId);
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
    this.toast.info('Venta cancelada.');
  }

  // ── Venta simple ───────────────────────────────────────────────────────
  abrirVentaSimple(): void {
    this.ventaSimpleForm.reset({ descripcion: '', monto: 0 });
    this.modalVentaSimpleAbierto.set(true);
  }

  agregarVentaSimple(): void {
    if (this.ventaSimpleForm.invalid) {
      this.ventaSimpleForm.markAllAsTouched();
      return;
    }
    const valor = this.ventaSimpleForm.getRawValue();
    this.carrito.update((lista) => [
      ...lista,
      { productoId: null, descripcion: valor.descripcion, cantidad: 1, precioUnitario: valor.monto, descuentoPct: 0, bodegaId: null },
    ]);
    this.modalVentaSimpleAbierto.set(false);
  }

  // ── Cliente ───────────────────────────────────────────────────────────
  elegirCliente(id: number | string | null): void {
    const nuevoId = id === null ? null : Number(id);
    this.clienteId.set(nuevoId);
    this.puntosACanjear.set(0); // cambiar de cliente invalida cualquier canje que se tuviera capturado

    // "Información de venta" del cliente (ver cliente-form-modal.component.ts):
    // su lista de precio predeterminada se preselecciona aquí — sigue siendo
    // un valor por default, el cajero puede cambiarla luego con el selector.
    const cliente = this.clientes().find((c) => c.id === nuevoId);
    this.listaPrecioId.set(cliente?.listaPrecioPredeterminadaId ?? null);
  }

  abrirNuevoCliente(): void {
    this.modalClienteAbierto.set(true);
  }

  alGuardarCliente(cliente: Cliente): void {
    this.clientes.update((lista) => [...lista, cliente]);
    this.clienteId.set(cliente.id);
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
    // cuanto la venta queda registrada.
    const itemsParaTicket: ItemTicket[] = this.carrito().map((i) => ({
      cantidad: i.cantidad,
      descripcion: i.descripcion,
      precioUnitario: i.precioUnitario,
      subtotal: redondear(i.cantidad * i.precioUnitario * (1 - i.descuentoPct / 100)),
    }));
    const pagosParaTicket: PagoTicket[] = this.pagos().map((p) => ({ metodoPago: p.metodoPago, monto: p.monto, cambio: p.cambio }));
    const nombreCliente = this.clienteSeleccionado()?.nombre ?? '';

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

      this.ventaRecienCobrada.set(venta);
      this.clienteRecienCobrado.set(nombreCliente);
      this.itemsTicket.set(itemsParaTicket);
      this.pagosTicket.set(pagosParaTicket);

      // Refresca existencia (para que el grid refleje lo recién vendido) y
      // el folio sugerido para el siguiente ticket.
      const [existenciasBodega, ventas] = await Promise.all([
        firstValueFrom(this.data.list<ExistenciaBodega>('ExistenciaBodega')),
        firstValueFrom(this.data.list<Venta>('Venta')),
      ]);
      this.existenciasBodega.set(existenciasBodega);
      this.proximoFolio.set(folioSugeridoVenta(ventas));
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
}

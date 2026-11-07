import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { DataClientService, FILTRO_BUSQUEDA } from '../../../core/services/data-client.service';
import { AuthService } from '../../../core/services/auth.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { SelectBuscableComponent, OpcionBuscable } from '../../../shared/components/select-buscable/select-buscable.component';
import { ToastService } from '../../../shared/services/toast.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { Producto } from '../../inventario/productos/producto.model';
import { Bodega } from '../../inventario/bodegas/bodega.model';
import { Cliente } from '../clientes/cliente.model';
import { ClienteService } from '../clientes/cliente.service';
import { MetodoPago, METODOS_PAGO, Venta } from '../venta/venta.model';
import { TurnoCajaService } from '../turno/turno-caja.service';
import { formatMoneda, redondear } from '../ventas.util';
import { Cotizacion, CotizacionItem } from './cotizacion.model';
import { CotizacionService, LineaCotizacionEntrada } from './cotizacion.service';

interface LineaUI {
  productoId: number | null;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  descuentoPct: number;
}

/**
 * Cotizaciones — una propuesta de precio para el cliente que NO toca
 * inventario ni caja (ver cotizacion.model.ts); cuando el cliente acepta,
 * "Convertir a venta" la vuelve una Venta real con el mismo VentaService
 * que usa Cobro. Mismo criterio de "catálogo con modal de alta + detalle"
 * que el resto de las pantallas de Ventas, pero el alta aquí arma varias
 * líneas (como un mini-Cobro) en vez de un solo formulario plano.
 */
@Component({
  selector: 'app-cotizaciones',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, SelectBuscableComponent],
  templateUrl: './cotizaciones.component.html',
  styleUrl: './cotizaciones.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CotizacionesComponent implements OnInit, OnDestroy {
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  private readonly data = inject(DataClientService);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly clienteService = inject(ClienteService);
  private readonly turnoCajaService = inject(TurnoCajaService);
  private readonly cotizacionService = inject(CotizacionService);
  protected readonly toast = inject(ToastService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);
  protected readonly formatMoneda = formatMoneda;
  protected readonly metodosPago = METODOS_PAGO;

  protected readonly cargando = signal(true);
  protected readonly cotizaciones = signal<Cotizacion[]>([]);
  protected readonly bodegas = signal<Bodega[]>([]);

  // Fase 4 (2026-11): Cliente y Producto son catálogos sin límite de
  // crecimiento (a diferencia de Bodega, chico y acotado -- mismo criterio
  // que OrdenesCompraComponent.cargarCatalogos()) -- antes se descargaban
  // COMPLETOS solo para armar estos selectores y para mostrar el nombre del
  // cliente en el listado. Ahora se buscan en el servidor según se teclea
  // (ver buscarClientesRemoto()/buscarProductosRemoto()) y los ya vistos se
  // recuerdan aquí (nunca se limpia durante la sesión), mismo patrón que
  // CobroComponent.clientesConocidos/productosConocidos.
  private readonly clientesConocidos = new Map<number, Cliente>();
  private readonly productosConocidos = new Map<number, Producto>();

  protected nombreCliente(clienteId: number): string {
    return this.clientesConocidos.get(clienteId)?.nombre ?? '—';
  }

  private etiquetaCliente(c: Cliente): string {
    return c.esGenerico ? c.nombre : `${c.nombre} — ${c.rfc}`;
  }

  /** Mismo patrón que CobroComponent.buscarClientesRemoto() (límite de 10,
   *  homologado en Fase 3) -- busca en el servidor por nombre/RFC/teléfono
   *  en vez de filtrar un arreglo completo ya descargado. */
  protected readonly buscarClientesRemoto = async (texto: string): Promise<OpcionBuscable[]> => {
    const filtro: Record<string, unknown> = { activo: true };
    const limpio = texto.trim();
    if (limpio) filtro[FILTRO_BUSQUEDA] = { columnas: ['nombre', 'rfc', 'telefono'], texto: limpio };
    const resultado = await firstValueFrom(this.data.listarPagina<Cliente>('Cliente', filtro, 0, 10, { columna: 'nombre' }));
    for (const c of resultado.filas) this.clientesConocidos.set(c.id, c);
    return resultado.filas.map((c) => ({ valor: c.id, etiqueta: this.etiquetaCliente(c) }));
  };

  /** Etiqueta del cliente ya elegido (el genérico que abrirNueva() asigna
   *  por default, o el que el usuario haya buscado) -- en modo remoto
   *  app-select-buscable no tiene el catálogo completo para resolverla
   *  sola (mismo motivo que CobroComponent.etiquetaClienteSeleccionado). */
  protected readonly etiquetaClienteNuevaSeleccionado = computed(() => {
    const id = this.clienteNuevaId();
    if (id === null) return '';
    const c = this.clientesConocidos.get(id);
    return c ? this.etiquetaCliente(c) : '';
  });

  /** Búsqueda remota de productos para la línea de captura -- a diferencia
   *  de fn_productos_autocomplete() (usada en Movimientos entre bodegas/
   *  Kardex/Lotes/Órdenes de compra), aquí NO se filtra por existencia: una
   *  cotización puede incluir productos agotados o servicios (existencia
   *  NULL), porque todavía no descuenta inventario -- ver cotizacion.model.ts.
   *  Por eso se reutiliza el contrato GENÉRICO de DataClientService (igual
   *  que buscarClientesRemoto) en vez de esa función ya existente, sin
   *  necesidad de crear ninguna función nueva. */
  protected readonly buscarProductosRemoto = async (texto: string): Promise<OpcionBuscable[]> => {
    const filtro: Record<string, unknown> = { activo: true };
    const limpio = texto.trim();
    if (limpio) filtro[FILTRO_BUSQUEDA] = { columnas: ['nombre', 'codigo'], texto: limpio };
    const resultado = await firstValueFrom(this.data.listarPagina<Producto>('Producto', filtro, 0, 15, { columna: 'nombre' }));
    for (const prod of resultado.filas) this.productosConocidos.set(prod.id, prod);
    return [
      { valor: 0, etiqueta: '— Texto libre (sin producto del catálogo) —' },
      ...resultado.filas.map((prod) => ({ valor: prod.id, etiqueta: prod.nombre })),
    ];
  };

  /** Asegura que los clientes de estos ids estén en clientesConocidos --
   *  SOLO pide a los que todavía no se conocen (ver CobroComponent.
   *  cargarExistenciaYPrecioPara() para el mismo criterio), nunca la tabla
   *  Cliente completa. */
  private async asegurarClientesConocidos(ids: number[]): Promise<void> {
    const faltantes = [...new Set(ids)].filter((id) => !this.clientesConocidos.has(id));
    if (faltantes.length === 0) return;
    const clientes = await firstValueFrom(this.data.list<Cliente>('Cliente', { id: faltantes }));
    for (const c of clientes) this.clientesConocidos.set(c.id, c);
  }

  protected readonly columnas: ColumnaTabla<Cotizacion>[] = [
    { campo: 'folio', etiqueta: 'Folio' },
    { campo: 'fecha', etiqueta: 'Fecha', formatear: (c) => new Date(c.fecha).toLocaleDateString('es-MX') },
    { campo: 'clienteId', etiqueta: 'Cliente', formatear: (c) => this.nombreCliente(c.clienteId) },
    { campo: 'total', etiqueta: 'Total', formatear: (c) => formatMoneda(c.total) },
    {
      campo: 'estado',
      etiqueta: 'Estado',
      claseValor: (c) =>
        c.estado === 'Vigente' ? 'grid-badge-success' : c.estado === 'Convertida' ? 'grid-badge-neutral' : 'grid-badge-muted',
    },
  ];

  // ── Alta ────────────────────────────────────────────────────────────
  protected readonly modalNuevaAbierto = signal(false);
  protected readonly lineasNuevas = signal<LineaUI[]>([]);
  protected readonly clienteNuevaId = signal<number | null>(null);
  protected readonly guardandoNueva = signal(false);

  protected readonly cotizacionForm = this.fb.nonNullable.group({
    fechaVigencia: [''],
    notas: [''],
  });

  protected readonly lineaForm = this.fb.nonNullable.group({
    productoId: [0],
    descripcion: ['', Validators.required],
    cantidad: [1, [Validators.required, Validators.min(1)]],
    precioUnitario: [0, [Validators.required, Validators.min(0)]],
    descuentoPct: [0, [Validators.min(0), Validators.max(100)]],
  });

  protected readonly subtotalNueva = computed(() => redondear(this.lineasNuevas().reduce((acc, l) => acc + l.cantidad * l.precioUnitario, 0)));
  protected readonly descuentoNueva = computed(() =>
    redondear(this.lineasNuevas().reduce((acc, l) => acc + l.cantidad * l.precioUnitario * (l.descuentoPct / 100), 0)),
  );
  protected readonly totalNueva = computed(() => redondear(this.subtotalNueva() - this.descuentoNueva()));

  elegirProductoLinea(id: number | string | null): void {
    const productoId = id ? Number(id) : 0;
    this.lineaForm.controls.productoId.setValue(productoId);
    if (productoId === 0) {
      this.lineaForm.patchValue({ descripcion: '', precioUnitario: 0 });
      return;
    }
    const producto = this.productosConocidos.get(productoId);
    if (producto) this.lineaForm.patchValue({ descripcion: producto.nombre, precioUnitario: producto.precioUnitario });
  }

  /** Enter dentro de un campo de la línea (cantidad/precio/descuento en
   *  mobile suelen tener "Enter"/"Listo" como tecla de acción) agregaba la
   *  cotización ENTERA antes de tiempo -- este formulario de línea vive
   *  DENTRO del mismo <form> que "Generar cotización" (ver
   *  cotizaciones.component.html), así que un <input> normal sin este
   *  freno disparaba el submit nativo. Ahora Enter simplemente intenta
   *  agregar la línea, igual que tocar "+ Agregar línea" (Fase 4, 2026-11
   *  -- causa confirmada de los avisos "Agrega al menos una línea…"
   *  disparados de más, percibidos como duplicados). */
  protected onEnterLinea(event: Event): void {
    event.preventDefault();
    this.agregarLinea();
  }

  agregarLinea(): void {
    if (this.lineaForm.invalid) {
      this.lineaForm.markAllAsTouched();
      this.mostrarErroresValidacionLinea();
      this.enfocarPrimerCampoInvalidoLinea();
      return;
    }
    const valor = this.lineaForm.getRawValue();
    this.lineasNuevas.update((lista) => [
      ...lista,
      {
        productoId: valor.productoId || null,
        descripcion: valor.descripcion,
        cantidad: valor.cantidad,
        precioUnitario: valor.precioUnitario,
        descuentoPct: valor.descuentoPct,
      },
    ]);
    this.lineaForm.reset({ productoId: 0, descripcion: '', cantidad: 1, precioUnitario: 0, descuentoPct: 0 });
  }

  quitarLineaNueva(index: number): void {
    this.lineasNuevas.update((lista) => lista.filter((_, idx) => idx !== index));
  }

  /** Mismo criterio que UsuariosListComponent.mostrarErroresValidacion():
   *  un aviso (toast) específico por cada campo inválido en vez de un
   *  bloque de error fijo debajo del campo -- el campo igual se resalta en
   *  rojo solo (.edit-form input.ng-invalid.ng-touched, ver styles.scss),
   *  sin ocupar espacio extra. Mensajes de ejemplo del mandato de Fase 4. */
  private mostrarErroresValidacionLinea(): void {
    const c = this.lineaForm.controls;
    if (c.descripcion.invalid) this.toast.error('Ingresa una descripción.');
    if (c.cantidad.invalid) this.toast.error('La cantidad debe ser mayor que cero.');
    if (c.precioUnitario.invalid) this.toast.error('Ingresa un precio válido.');
    if (c.descuentoPct.invalid) this.toast.error('Revisa el descuento.');
  }

  /** Lleva el foco al primer campo inválido de la línea, en el mismo orden
   *  en que aparecen en el formulario (Fase 4, 2026-11 -- ver los `id` en
   *  cotizaciones.component.html). */
  private enfocarPrimerCampoInvalidoLinea(): void {
    const c = this.lineaForm.controls;
    const candidatos: Array<[boolean, string]> = [
      [c.descripcion.invalid, 'cotLineaDescripcion'],
      [c.cantidad.invalid, 'cotLineaCantidad'],
      [c.precioUnitario.invalid, 'cotLineaPrecioUnitario'],
      [c.descuentoPct.invalid, 'cotLineaDescuentoPct'],
    ];
    const primero = candidatos.find(([invalido]) => invalido)?.[1];
    if (primero) document.getElementById(primero)?.focus();
  }

  async abrirNueva(): Promise<void> {
    this.cotizacionForm.reset({ fechaVigencia: '', notas: '' });
    this.lineaForm.reset({ productoId: 0, descripcion: '', cantidad: 1, precioUnitario: 0, descuentoPct: 0 });
    this.lineasNuevas.set([]);
    const generico = await this.clienteService.obtenerOCrearGenerico();
    this.clientesConocidos.set(generico.id, generico); // ver etiquetaClienteNuevaSeleccionado()
    this.clienteNuevaId.set(generico.id);
    this.modalNuevaAbierto.set(true);
  }

  cerrarNueva(): void {
    this.modalNuevaAbierto.set(false);
  }

  async guardarNueva(): Promise<void> {
    const usuario = this.auth.usuarioActual();
    if (!usuario) return;

    // Fase 4 (2026-11): antes, si clienteId era null, no pasaba NADA visible
    // (return silencioso) -- el mandato pide avisar con un mensaje
    // específico ("Selecciona un cliente."), no dejar al usuario sin
    // ninguna pista de por qué "Generar cotización" no hizo nada.
    const clienteId = this.clienteNuevaId();
    if (clienteId === null) {
      this.toast.advertencia('Selecciona un cliente.');
      return;
    }

    if (this.lineasNuevas().length === 0) {
      this.toast.advertencia('Agrega al menos una línea a la cotización.');
      return;
    }

    this.guardandoNueva.set(true);
    try {
      const valor = this.cotizacionForm.getRawValue();
      const lineas: LineaCotizacionEntrada[] = this.lineasNuevas().map((l) => ({
        productoId: l.productoId,
        descripcion: l.descripcion,
        cantidad: l.cantidad,
        precioUnitario: l.precioUnitario,
        descuentoPct: l.descuentoPct,
      }));

      const cotizacion = await this.cotizacionService.generar({
        clienteId,
        vendedorUsuarioId: usuario.id,
        fechaVigencia: valor.fechaVigencia || null,
        notas: valor.notas || null,
        lineas,
      });

      this.toast.exito(`Cotización ${cotizacion.folio} generada.`);
      this.modalNuevaAbierto.set(false);
      await this.cargarListado();
    } finally {
      this.guardandoNueva.set(false);
    }
  }

  // ── Detalle / conversión / cancelación ─────────────────────────────────
  protected readonly cotizacionDetalle = signal<Cotizacion | null>(null);
  protected readonly itemsDetalle = signal<CotizacionItem[]>([]);
  protected readonly ventaConvertidaDetalle = signal<Venta | null>(null);
  protected readonly cargandoDetalle = signal(false);
  protected readonly cotizacionACancelar = signal<Cotizacion | null>(null);

  protected readonly modalConvertirAbierto = signal(false);
  protected readonly bodegaConversionId = signal<number | null>(null);
  protected readonly convirtiendo = signal(false);

  protected readonly conversionForm = this.fb.nonNullable.group({
    metodoPago: ['Efectivo' as MetodoPago, Validators.required],
  });

  protected readonly requiereBodegaConversion = computed(() => this.itemsDetalle().some((i) => i.productoId !== null));

  async ngOnInit(): Promise<void> {
    document.documentElement.setAttribute('data-wide', 'grid'); // ancho completo
    await this.cargarCatalogos();
    await this.cargarListado();
  }

  /** Bodega: catálogo chico y acotado (no crece con el negocio, a
   *  diferencia de Cliente/Producto -- mismo criterio que
   *  OrdenesCompraComponent.cargarCatalogos()) -- se carga UNA sola vez,
   *  nunca hace falta recargarlo después de guardar/cancelar/convertir
   *  una cotización. */
  private async cargarCatalogos(): Promise<void> {
    const bodegas = await firstValueFrom(this.data.list<Bodega>('Bodega'));
    this.bodegas.set(bodegas.filter((b) => b.activo !== false));
    this.bodegaConversionId.set(this.bodegas()[0]?.id ?? null);
  }

  protected readonly paginaActual = signal(1);
  private readonly totalCotizacionesFiltradas = signal(0);
  protected readonly totalCotizaciones = this.totalCotizacionesFiltradas;
  protected readonly totalPaginas = computed(() =>
    Math.max(1, Math.ceil(this.totalCotizacionesFiltradas() / Math.max(1, this.preferenciasGrid.tamanoPagina()))),
  );
  private secuenciaListado = 0;

  /** Trae SOLO la página actual de Cotizacion, ordenada por fecha
   *  descendente -- antes descargaba la tabla COMPLETA en cada carga y
   *  después de cada guardado/cancelación/conversión (Fase 4, 2026-11,
   *  mismo criterio de paginación servidor que
   *  OrdenesCompraComponent.cargarListado(), reutilizando el listarPagina()
   *  genérico de DataClientService -- sin necesidad de ninguna función RPC
   *  nueva). Protegida contra respuestas fuera de orden con
   *  secuenciaListado, igual que ese mismo componente. */
  async cargarListado(): Promise<void> {
    this.cargando.set(true);
    const miSecuencia = ++this.secuenciaListado;
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActual() - 1) * tamanio;
    const resultado = await firstValueFrom(
      this.data.listarPagina<Cotizacion>('Cotizacion', undefined, desde, tamanio, { columna: 'fecha', direccion: 'desc' }),
    );
    if (miSecuencia !== this.secuenciaListado) return; // ya hay una carga más nueva en curso -- descartar esta

    await this.asegurarClientesConocidos(resultado.filas.map((c) => c.clienteId));
    if (miSecuencia !== this.secuenciaListado) return;

    this.cotizaciones.set(resultado.filas);
    this.totalCotizacionesFiltradas.set(resultado.total);
    this.cargando.set(false);
  }

  protected irAPaginaAnterior(): void {
    if (this.paginaActual() <= 1) return;
    this.paginaActual.update((pg) => pg - 1);
    this.cargarListado();
  }

  protected irAPaginaSiguiente(): void {
    if (this.paginaActual() >= this.totalPaginas()) return;
    this.paginaActual.update((pg) => pg + 1);
    this.cargarListado();
  }

  async verDetalle(cotizacion: Cotizacion): Promise<void> {
    this.cotizacionDetalle.set(cotizacion);
    this.cargandoDetalle.set(true);
    await this.asegurarClientesConocidos([cotizacion.clienteId]);
    const items = await firstValueFrom(this.data.list<CotizacionItem>('CotizacionItem', { cotizacionId: cotizacion.id }));
    this.itemsDetalle.set(items);

    if (cotizacion.estado === 'Convertida' && cotizacion.ventaConvertidaId !== null) {
      const ventas = await firstValueFrom(this.data.list<Venta>('Venta', { id: cotizacion.ventaConvertidaId }));
      this.ventaConvertidaDetalle.set(ventas[0] ?? null);
    } else {
      this.ventaConvertidaDetalle.set(null);
    }
    this.cargandoDetalle.set(false);
  }

  cerrarDetalle(): void {
    this.cotizacionDetalle.set(null);
    this.itemsDetalle.set([]);
    this.ventaConvertidaDetalle.set(null);
  }

  pedirCancelar(cotizacion: Cotizacion): void {
    this.cotizacionACancelar.set(cotizacion);
  }

  async confirmarCancelar(): Promise<void> {
    const cotizacion = this.cotizacionACancelar();
    if (!cotizacion) return;

    const actualizada = await this.cotizacionService.cancelar(cotizacion);
    this.toast.exito(`Cotización ${cotizacion.folio} cancelada.`);
    this.cotizacionACancelar.set(null);
    this.cotizacionDetalle.set(actualizada);
    await this.cargarListado();
  }

  async abrirConvertir(): Promise<void> {
    const usuario = this.auth.usuarioActual();
    if (!usuario) return;

    // turnoAbiertoOCrear(): si "Apertura de caja" está desactivada, abre uno
    // en silencio en vez de bloquear — ver su comentario en TurnoCajaService.
    const turno = await this.turnoCajaService.turnoAbiertoOCrear(usuario.id);
    if (!turno) {
      this.toast.advertencia('Abre un turno de caja antes de convertir una cotización en venta.');
      return;
    }
    this.conversionForm.reset({ metodoPago: 'Efectivo' });
    this.modalConvertirAbierto.set(true);
  }

  cerrarConvertir(): void {
    this.modalConvertirAbierto.set(false);
  }

  async confirmarConvertir(): Promise<void> {
    const cotizacion = this.cotizacionDetalle();
    const usuario = this.auth.usuarioActual();
    if (!cotizacion || !usuario) return;

    if (this.requiereBodegaConversion() && this.bodegaConversionId() === null) {
      this.toast.advertencia('Elige la bodega de la que se descuenta existencia.');
      return;
    }
    if (this.conversionForm.invalid) {
      this.conversionForm.markAllAsTouched();
      return;
    }

    this.convirtiendo.set(true);
    try {
      const turno = await this.turnoCajaService.turnoAbiertoOCrear(usuario.id);
      if (!turno) {
        this.toast.advertencia('Ya no tienes un turno de caja abierto.');
        return;
      }

      const valor = this.conversionForm.getRawValue();
      const venta = await this.cotizacionService.convertirAVenta(cotizacion, this.itemsDetalle(), {
        turnoCajaId: turno.id,
        bodegaId: this.bodegaConversionId(),
        pago: { metodoPago: valor.metodoPago, monto: cotizacion.total, montoRecibido: null, cambio: null },
      });

      this.toast.exito(`Cotización convertida en venta ${venta.folio}.`);
      this.modalConvertirAbierto.set(false);
      await this.verDetalle({ ...cotizacion, estado: 'Convertida', ventaConvertidaId: venta.id });
      await this.cargarListado();
    } finally {
      this.convirtiendo.set(false);
    }
  }
}

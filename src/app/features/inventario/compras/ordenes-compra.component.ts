import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
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
import { formatMoneda, factorConversionUnidad } from '../productos/producto.util';
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
 *  no desincronizar lo que ya entró a MovimientoInventario. */
interface FilaItemForm {
  id: number; // 0 = línea nueva, sin guardar todavía
  productoId: number;
  cantidadTexto: string;
  costoUnitarioTexto: string;
  cantidadRecibida: number;
  /** null = unidad base del producto (el caso de siempre). Con número, la
   *  unidad de compra alterna elegida para ESTA línea (ver
   *  Producto.unidadCompraId) — se congela como OrdenCompraItem.unidadId al
   *  guardar, junto con el factor correspondiente (ver guardar() y
   *  factorConversionUnidad() en producto.util.ts). */
  unidadId: number | null;
}

/** Fila del panel de recepción: cuánto falta y cuánto se va a recibir ahora. */
interface FilaRecepcion {
  item: OrdenCompraItem;
  productoNombre: string;
  pendiente: number;
  aRecibirTexto: string;
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
 * MiembrosFamiliaComponent (ver miembros.component.ts): la lista usa
 * app-data-table, la ficha es la pantalla completa de alta/edición +,
 * cuando la orden ya existe y no está cerrada, el panel de recepción (ver
 * recibir(), que delega en OrdenCompraService.recibir() — ahí vive el
 * costeo promedio ponderado y el cálculo de estado).
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

  protected readonly vista = signal<'lista' | 'ficha'>('lista');
  protected readonly ordenes = signal<OrdenCompra[]>([]);
  protected readonly items = signal<OrdenCompraItem[]>([]);
  protected readonly productos = signal<Producto[]>([]);
  protected readonly bodegas = signal<Bodega[]>([]);
  protected readonly proveedores = signal<Proveedor[]>([]);
  protected readonly unidades = signal<UnidadMedida[]>([]);
  protected readonly movimientos = signal<MovimientoInventario[]>([]);
  protected readonly cargando = signal(false);
  protected readonly guardando = signal(false);
  protected readonly busqueda = signal('');

  protected readonly ordenActiva = signal<OrdenCompra | null>(null);
  protected readonly ordenAEliminar = signal<OrdenCompra | null>(null);

  protected readonly productosActivos = computed(() => this.productos().filter((p) => p.activo !== false));
  protected readonly bodegasActivas = computed(() => this.bodegas().filter((b) => b.activo !== false));
  protected readonly proveedoresActivos = computed(() => this.proveedores().filter((p) => p.activo !== false));

  protected readonly opcionesProducto = computed<OpcionBuscable[]>(() =>
    this.productosActivos().map((p) => ({ valor: p.id, etiqueta: p.nombre })),
  );
  protected readonly opcionesBodega = computed<OpcionBuscable[]>(() =>
    this.bodegasActivas().map((b) => ({ valor: b.id, etiqueta: b.nombre })),
  );
  protected readonly opcionesProveedor = computed<OpcionBuscable[]>(() =>
    this.proveedoresActivos().map((p) => ({ valor: p.id, etiqueta: p.nombre })),
  );

  protected nombreProducto(id: number): string {
    return this.productos().find((p) => p.id === id)?.nombre ?? '—';
  }
  private nombreProveedor(id: number): string {
    return this.proveedores().find((p) => p.id === id)?.nombre ?? '—';
  }
  private nombreBodega(id: number): string {
    return this.bodegas().find((b) => b.id === id)?.nombre ?? '—';
  }
  private nombreUnidad(id: number): string {
    return this.unidades().find((u) => u.id === id)?.nombre ?? '—';
  }

  /** true si el producto de la línea tiene definida una unidad de compra
   *  alterna (ver Producto.unidadCompraId/factorConversionCompra) — solo
   *  entonces tiene sentido mostrar el selector de unidad en la línea; si
   *  no, se compra siempre en la unidad base, como hasta ahora. */
  protected tieneUnidadCompraAlterna(productoId: number): boolean {
    const producto = this.productos().find((p) => p.id === productoId);
    return !!producto?.unidadCompraId && !!producto?.factorConversionCompra;
  }

  /** Nombre de la unidad en la que está capturada la línea (base o de
   *  compra) — para mostrarla cuando el producto no tiene unidad alterna
   *  (selector no aplica) y como etiqueta de referencia junto al selector
   *  cuando sí la tiene. */
  protected nombreUnidadLinea(linea: FilaItemForm): string {
    const producto = this.productos().find((p) => p.id === linea.productoId);
    if (!producto) return '—';
    return linea.unidadId ? this.nombreUnidad(linea.unidadId) : this.nombreUnidad(producto.unidadMedidaId);
  }

  /** Opciones del selector de unidad de una línea: la unidad base del
   *  producto (valor 0 = "sin unidad de compra alterna", mismo criterio que
   *  opcionesProveedor en Productos) y su unidad de compra alterna, si
   *  tiene. Solo se llama cuando tieneUnidadCompraAlterna() ya dio true. */
  protected opcionesUnidadLinea(productoId: number): OpcionBuscable[] {
    const producto = this.productos().find((p) => p.id === productoId);
    if (!producto) return [];
    return [
      { valor: 0, etiqueta: this.nombreUnidad(producto.unidadMedidaId) + ' (base)' },
      { valor: producto.unidadCompraId!, etiqueta: this.nombreUnidad(producto.unidadCompraId!) },
    ];
  }

  protected readonly filasVista = computed<FilaOrdenCompra[]>(() => {
    const items = this.items();
    const hoyTexto = new Date().toISOString().slice(0, 10);
    return this.ordenes()
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
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
  });

  protected readonly filasFiltradas = computed(() => {
    const texto = this.busqueda().trim().toLowerCase();
    if (!texto) return this.filasVista();
    return this.filasVista().filter(
      (f) => f.folio.toLowerCase().includes(texto) || f.proveedorNombre.toLowerCase().includes(texto),
    );
  });

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

  /** Las líneas solo se pueden agregar/quitar/editar mientras la orden no
   *  tenga NADA recibido todavía — una vez que entró aunque sea una
   *  recepción parcial, cambiar cantidad/costo desincronizaría lo que ya se
   *  aplicó a ExistenciaBodega/Producto.costo (ver OrdenCompraService). */
  /** Número real de columnas de la tabla de líneas, para el colspan de la
   *  fila "sin líneas todavía" (5 fijas, incluyendo Unidad + "Recibido" si
   *  la orden ya existe + acción "Quitar" si todavía se puede editar). */
  protected readonly colspanItems = computed(() => 5 + (this.ordenActiva() ? 1 : 0) + (this.puedeEditarItems() ? 1 : 0));

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
    await this.cargar();
    this.aplicarBorradorDesdeReposicion();
  }

  /** Si se llegó aquí desde el botón "Generar orden de compra" de
   *  Sugerencia de reposición (ver sugerencia-reposicion.component.ts),
   *  abre la ficha de alta ya con proveedor y líneas precargadas — el
   *  usuario sigue siendo quien revisa/ajusta bodega y cantidades y
   *  decide guardar; nada se crea todavía solo por llegar aquí. */
  private aplicarBorradorDesdeReposicion(): void {
    const borrador = this.borradorService.tomarBorrador();
    if (!borrador) return;
    this.nuevaOrden();
    this.form.patchValue({
      proveedorId: borrador.proveedorId,
      bodegaDestinoId: borrador.bodegaId ?? 0,
    });
    this.itemsForm.set(
      borrador.lineas.map((l) => ({
        id: 0,
        productoId: l.productoId,
        cantidadTexto: String(l.cantidad),
        costoUnitarioTexto: String(l.costoUnitario),
        cantidadRecibida: 0,
        unidadId: null, // sugerencia de reposición siempre calcula en unidad base
      })),
    );
  }

  /** Devuelve la promesa (en vez de "lanzar y olvidar") para que
   *  confirmarRecepcion() pueda esperar a que ordenes()/items() reflejen de
   *  verdad lo que acaba de recibir antes de volver a abrir la ficha —  el
   *  resto de llamadas (ngOnInit, volverALista, confirmarEliminar) la siguen
   *  usando sin await, como antes, porque no necesitan encadenar nada después. */
  async cargar(): Promise<void> {
    this.cargando.set(true);
    const [ordenes, items, productos, bodegas, proveedores, unidades, movimientos] = await Promise.all([
      firstValueFrom(this.data.list<OrdenCompra>('OrdenCompra')),
      firstValueFrom(this.data.list<OrdenCompraItem>('OrdenCompraItem')),
      firstValueFrom(this.data.list<Producto>('Producto')),
      firstValueFrom(this.data.list<Bodega>('Bodega')),
      firstValueFrom(this.data.list<Proveedor>('Proveedor')),
      firstValueFrom(this.data.list<UnidadMedida>('UnidadMedida')),
      firstValueFrom(this.data.list<MovimientoInventario>('MovimientoInventario')),
    ]);
    this.ordenes.set(ordenes);
    this.items.set(items);
    this.productos.set(productos);
    this.bodegas.set(bodegas);
    this.proveedores.set(proveedores);
    this.unidades.set(unidades);
    this.movimientos.set(movimientos);
    this.cargando.set(false);
  }

  volverALista(): void {
    this.vista.set('lista');
    this.cargar();
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
    this.vista.set('ficha');
  }

  abrirOrden(fila: FilaOrdenCompra): void {
    this.abrirOrdenPorId(fila.id);
  }

  private abrirOrdenPorId(id: number): void {
    const orden = this.ordenes().find((o) => o.id === id);
    if (!orden) return;
    this.ordenActiva.set(orden);
    this.form.reset({
      proveedorId: orden.proveedorId,
      bodegaDestinoId: orden.bodegaDestinoId,
      fecha: orden.fecha.slice(0, 10),
      fechaEntregaEstimada: orden.fechaEntregaEstimada?.slice(0, 10) ?? '',
      notas: orden.notas ?? '',
    });
    const itemsDeOrden = this.items().filter((i) => i.ordenCompraId === orden.id);
    this.itemsForm.set(
      itemsDeOrden.map((i) => ({
        id: i.id,
        productoId: i.productoId,
        cantidadTexto: String(i.cantidad),
        costoUnitarioTexto: String(i.costoUnitario),
        cantidadRecibida: i.cantidadRecibida,
        unidadId: i.unidadId ?? null,
      })),
    );
    this.filasRecepcion.set(
      itemsDeOrden
        .filter((i) => i.cantidadRecibida < i.cantidad)
        .map((i) => ({
          item: i,
          productoNombre: this.nombreProducto(i.productoId),
          pendiente: i.cantidad - i.cantidadRecibida,
          aRecibirTexto: String(i.cantidad - i.cantidadRecibida),
        })),
    );
    this.vista.set('ficha');
  }

  /** Atajo para armar la orden escaneando (lector USB/Bluetooth o cámara —
   *  ver app-escaneo-codigo): si el producto ya tiene una línea en esta
   *  orden, le suma 1 a la cantidad; si no, agrega una línea nueva con
   *  cantidad 1 y el costo autocompletado (mismo criterio que
   *  seleccionarProductoEnLinea()). Solo aplica mientras se puedan editar
   *  las líneas (ver puedeEditarItems()) — igual que agregarLinea(). */
  escanearLinea(codigo: string): void {
    if (!this.puedeEditarItems()) return;
    const normalizado = codigo.trim().toLowerCase();
    const producto = this.productosActivos().find((p) => (p.codigo ?? '').trim().toLowerCase() === normalizado);
    if (!producto) {
      this.toast.advertencia(`No se encontró ningún producto activo con el código "${codigo}".`);
      return;
    }
    const indiceExistente = this.itemsForm().findIndex((f) => f.productoId === producto.id);
    if (indiceExistente >= 0) {
      const actual = this.itemsForm()[indiceExistente];
      this.cambiarLinea(indiceExistente, { cantidadTexto: String((Number(actual.cantidadTexto) || 0) + 1) });
    } else {
      this.itemsForm.update((filas) => [
        ...filas,
        { id: 0, productoId: producto.id, cantidadTexto: '1', costoUnitarioTexto: String(producto.costo), cantidadRecibida: 0, unidadId: null },
      ]);
    }
    this.toast.info(`Línea actualizada: ${producto.nombre}.`);
  }

  agregarLinea(): void {
    this.itemsForm.update((filas) => [
      ...filas,
      { id: 0, productoId: 0, cantidadTexto: '1', costoUnitarioTexto: '0', cantidadRecibida: 0, unidadId: null },
    ]);
  }

  quitarLinea(index: number): void {
    this.itemsForm.update((filas) => filas.filter((_, i) => i !== index));
  }

  cambiarLinea(index: number, cambio: Partial<FilaItemForm>): void {
    this.itemsForm.update((filas) => filas.map((f, i) => (i === index ? { ...f, ...cambio } : f)));
  }

  /** Autocompleta costo unitario y, si la línea está vacía, cantidad 1 al
   *  elegir un producto — toma el último costo conocido (Producto.costo) para
   *  no dejar la captura en cero y que se les olvide ponerlo. */
  seleccionarProductoEnLinea(index: number, productoId: number): void {
    const producto = this.productos().find((p) => p.id === productoId);
    this.cambiarLinea(index, {
      productoId,
      costoUnitarioTexto: producto ? String(producto.costo) : '0',
      unidadId: null, // al cambiar de producto, siempre se vuelve a la unidad base
    });
  }

  /** Cambia la unidad en la que se captura esta línea (base o de compra
   *  alterna — ver tieneUnidadCompraAlterna()/opcionesUnidadLinea()) y
   *  re-sugiere el costo unitario en esa unidad (Producto.costo está en
   *  unidad base, así que se multiplica por el factor) — mismo criterio de
   *  "no dejar la captura en cero" que seleccionarProductoEnLinea(). */
  cambiarUnidadLinea(index: number, valorSeleccionado: number): void {
    const fila = this.itemsForm()[index];
    if (!fila) return;
    const producto = this.productos().find((p) => p.id === fila.productoId);
    const unidadId = valorSeleccionado || null;
    const factor = producto ? factorConversionUnidad(producto, unidadId) : 1;
    this.cambiarLinea(index, {
      unidadId,
      costoUnitarioTexto: producto ? String(producto.costo * factor) : fila.costoUnitarioTexto,
    });
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
    const valor = this.form.getRawValue();
    const ordenExistente = this.ordenActiva();

    try {
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
        // Reemplaza las líneas por completo (solo se llega aquí si todavía
        // no hay nada recibido — ver puedeEditarItems()): más simple y
        // seguro que calcular un diff alta/modificación/baja fila por fila.
        const itemsPrevios = this.items().filter((i) => i.ordenCompraId === orden.id);
        for (const previo of itemsPrevios) {
          await firstValueFrom(this.data.baja('OrdenCompraItem', previo.id));
        }
        for (const linea of lineasValidas) {
          const producto = this.productos().find((p) => p.id === linea.productoId);
          await firstValueFrom(
            this.data.alta<OrdenCompraItem>('OrdenCompraItem', {
              ordenCompraId: orden.id,
              productoId: linea.productoId,
              cantidad: Number(linea.cantidadTexto),
              costoUnitario: Number(linea.costoUnitarioTexto) || 0,
              cantidadRecibida: 0,
              unidadId: linea.unidadId,
              factorConversion: producto ? factorConversionUnidad(producto, linea.unidadId) : 1,
            }),
          );
        }
      }

      this.toast.exito(ordenExistente ? 'Orden actualizada.' : `Orden ${orden.folio} creada.`);
      this.volverALista();
    } finally {
      this.guardando.set(false);
    }
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
      await this.cargar();
      this.abrirOrdenPorId(orden.id);
    } finally {
      this.recibiendo.set(false);
    }
  }

  pedirEliminar(fila: FilaOrdenCompra): void {
    const orden = this.ordenes().find((o) => o.id === fila.id);
    if (orden) this.ordenAEliminar.set(orden);
  }

  async confirmarEliminar(): Promise<void> {
    const orden = this.ordenAEliminar();
    if (!orden) return;
    if (orden.estado !== 'pendiente') {
      this.toast.error('Solo se puede eliminar una orden pendiente (sin nada recibido).');
      this.ordenAEliminar.set(null);
      return;
    }
    const itemsDeOrden = this.items().filter((i) => i.ordenCompraId === orden.id);
    for (const item of itemsDeOrden) {
      await firstValueFrom(this.data.baja('OrdenCompraItem', item.id));
    }
    await firstValueFrom(this.data.baja('OrdenCompra', orden.id));
    this.toast.exito('Orden eliminada.');
    this.ordenAEliminar.set(null);
    this.cargar();
  }
}

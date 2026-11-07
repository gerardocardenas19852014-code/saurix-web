import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { AuthService } from '../../../core/services/auth.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { imprimirHtml } from '../../../shared/utils/imprimir.util';
import { MetodoPago, METODOS_PAGO, Venta, VentaItem, VentaPago } from '../venta/venta.model';
import { VentaService } from '../venta/venta.service';
import { Devolucion, DevolucionItem } from '../devolucion/devolucion.model';
import { CuentaPorCobrar } from '../cuenta-por-cobrar/cuenta-por-cobrar.model';
import { CuentaPorCobrarService } from '../cuenta-por-cobrar/cuenta-por-cobrar.service';
import { cantidadDisponibleParaDevolver, DevolucionService, LineaDevolucionEntrada } from '../devolucion/devolucion.service';
import { construirTicketHtml, estiloTicket, formatMoneda, redondear } from '../ventas.util';
import { exportarCsv } from '../../../shared/utils/csv.util';
import { exportarTablaPdf } from '../../../shared/utils/pdf-tabla.util';

/** Cada renglón del listado — ya resuelto por el servidor (cliente/vendedor
 *  por nombre, total, etc. vía ventas.fn_historial_ventas_listar()), nunca
 *  por un lookup en memoria contra tablas completas de Cliente/Usuario. */
interface FilaHistorialVenta {
  id: number;
  folio: string;
  fecha: string;
  clienteId: number;
  clienteNombre: string;
  vendedorUsuarioId: number;
  vendedorNombre: string;
  total: number;
  estado: string;
  canal: string | null;
}

/** CSV exporta TODO lo que cumple el filtro actual (no solo la página
 *  visible), en lotes — nunca en una sola petición gigante. Mismo criterio
 *  que UsuariosListComponent.exportarUsuariosCsv() / MovimientosBodega
 *  Component.exportarCsvHistorial(). */
const TAMANO_LOTE_EXPORTAR = 1000;
/** PDF es un reporte acotado, no un volcado completo — mismo criterio que
 *  MovimientosBodegaComponent.exportarPdfHistorial() / ValorStockComponent. */
const TOPE_FILAS_PDF = 200;

/**
 * Historial de ventas — todas las ventas registradas (de cualquier turno),
 * con filtro por fecha/estado/búsqueda, detalle de cada una (renglones +
 * pagos) y, desde ahí, Cancelar (ver VentaService.cancelar(), ya existía
 * desde que se construyó el módulo pero no tenía pantalla que lo usara) e
 * Imprimir ticket (reimpresión — el mismo ticket que ya se puede imprimir
 * justo al cobrar en CobroComponent).
 *
 * Mismo criterio de "pantalla de solo consulta con una acción propia" que
 * otros históricos del proyecto (ver ColumnaTabla.subfila/ocultarEditarEliminar
 * en data-table.component.ts): la fila no se edita ni se borra directo
 * desde el grid, todo pasa por el modal de detalle.
 *
 * HOMOLOGACIÓN DE RENDIMIENTO (Fase 1, "Prompt maestro" nov-2026): esta
 * pantalla descargaba `list('Venta')` + `list('Cliente')` + `list('Usuario')`
 * COMPLETOS (sin filtro ni paginación server-side) y filtraba/ordenaba/
 * resolvía nombres todo en memoria vía `ventasFiltradas()` — con mucho
 * historial eso significaba traer TRES tablas enteras para mostrar 20
 * filas. Ahora sigue el mismo patrón ya homologado en Órdenes de compra
 * (ver OrdenesCompraComponent.cargarListado()/cargarListadoSupabase()):
 * una función de PostgreSQL (`ventas.fn_historial_ventas_listar`) hace el
 * join con Cliente/Usuario, filtra (folio/cliente por texto, estado, rango
 * de fecha), ordena, pagina con OFFSET/LIMIT y regresa el total real
 * (`count(*) over()`) en una sola consulta. Un botón "🔍 Buscar" + Enter es
 * el único disparador de una consulta nueva — ningún filtro (fecha, estado,
 * texto) dispara nada por sí solo — y la paginación es real contra el
 * servidor (Anterior/Siguiente), protegida contra respuestas fuera de orden
 * con `secuenciaListado` (mismo patrón que MovimientosBodegaComponent).
 */
@Component({
  selector: 'app-historial-ventas',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent],
  templateUrl: './historial-ventas.component.html',
  styleUrl: './historial-ventas.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HistorialVentasComponent implements OnInit, OnDestroy {
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  private readonly data = inject(DataClientService);
  private readonly sb = inject(SupabaseService).cliente;
  private readonly ventaService = inject(VentaService);
  private readonly devolucionService = inject(DevolucionService);
  private readonly cuentaPorCobrarService = inject(CuentaPorCobrarService);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  protected readonly toast = inject(ToastService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);
  protected readonly formatMoneda = formatMoneda;
  protected readonly metodosPago = METODOS_PAGO;

  /** Solo la página actual, ya filtrada/ordenada/recortada y con nombres
   *  resueltos por el servidor — ver cargarListado(). */
  protected readonly ventasPagina = signal<FilaHistorialVenta[]>([]);
  protected readonly cargando = signal(true);

  /** Filtros EN EDICIÓN — nunca disparan una consulta por sí solos. Solo
   *  cambiarFiltro() (botón "🔍 Buscar" o Enter) los aplica de verdad. */
  protected readonly busqueda = signal('');
  protected readonly fechaDesde = signal(this.hoyISO());
  protected readonly fechaHasta = signal(this.hoyISO());
  protected readonly filtroEstado = signal<'Todas' | 'Completada' | 'Cancelada'>('Todas');

  protected readonly paginaActual = signal(1);
  /** Total real de ventas que cumplen el filtro actual (antes de recortar
   *  a la página) — lo da el propio servidor (fn_historial_ventas_listar,
   *  columna total_filas vía count(*) over()); nunca se calcula contando
   *  filas ya traídas. */
  protected readonly totalVentasFiltradas = signal(0);
  protected readonly totalPaginas = computed(() =>
    Math.max(1, Math.ceil(this.totalVentasFiltradas() / Math.max(1, this.preferenciasGrid.tamanoPagina()))),
  );
  /** Evita que una respuesta vieja (petición lenta) pise el resultado de
   *  una búsqueda/página más reciente — mismo patrón que
   *  OrdenesCompraComponent.secuenciaListado. */
  private secuenciaListado = 0;

  protected readonly columnas: ColumnaTabla<FilaHistorialVenta>[] = [
    { campo: 'folio', etiqueta: 'Folio' },
    { campo: 'fecha', etiqueta: 'Fecha', formatear: (v) => this.formatearFecha(v.fecha) },
    { campo: 'clienteNombre', etiqueta: 'Cliente' },
    { campo: 'vendedorNombre', etiqueta: 'Vendedor' },
    { campo: 'total', etiqueta: 'Total', formatear: (v) => formatMoneda(v.total) },
    {
      campo: 'estado',
      etiqueta: 'Estado',
      claseValor: (v) => (v.estado === 'Completada' ? 'grid-badge-success' : 'grid-badge-muted'),
    },
    { campo: 'canal', etiqueta: 'Canal', formatear: (v) => v.canal || 'Mostrador' },
  ];

  protected readonly ventaDetalle = signal<Venta | null>(null);
  /** Nombre de cliente/vendedor del renglón que abrió el detalle — ya
   *  venían resueltos por el servidor en el listado, así que el modal no
   *  necesita volver a consultar Cliente/Usuario por separado. */
  protected readonly clienteNombreDetalle = signal('—');
  protected readonly vendedorNombreDetalle = signal('—');
  protected readonly itemsDetalle = signal<VentaItem[]>([]);
  protected readonly pagosDetalle = signal<VentaPago[]>([]);
  protected readonly devolucionItemsDetalle = signal<DevolucionItem[]>([]);
  protected readonly cuentasPorCobrarDetalle = signal<CuentaPorCobrar[]>([]);
  protected readonly cargandoDetalle = signal(false);
  protected readonly ventaACancelar = signal<Venta | null>(null);

  protected readonly totalDevueltoDetalle = computed(() =>
    redondear(this.devolucionItemsDetalle().reduce((acc, di) => acc + di.subtotal, 0)),
  );

  /** Cancelar anula TODA la venta reponiendo la existencia completa de cada
   *  renglón (ver VentaService.cancelar()) — si ya se devolvió parte antes,
   *  esa existencia ya se repuso, así que Cancelar encima duplicaría la
   *  reposición. Por eso solo se permite cancelar una venta que todavía no
   *  tiene ninguna devolución registrada. */
  protected readonly puedeCancelarDetalle = computed(
    () =>
      this.ventaDetalle()?.estado === 'Completada' &&
      this.devolucionItemsDetalle().length === 0 &&
      this.cuentasPorCobrarDetalle().every((c) => c.estado === 'Pendiente' && c.saldoPendiente >= c.montoOriginal - 0.01),
  );

  protected readonly puedeDevolverDetalle = computed(
    () => this.ventaDetalle()?.estado === 'Completada' && this.itemsDevolvibles().length > 0,
  );

  // ── Devolución ───────────────────────────────────────────────────────
  protected readonly modalDevolucionAbierto = signal(false);
  protected readonly cantidadesDevolucion = signal<Record<number, number>>({});
  protected readonly guardandoDevolucion = signal(false);

  protected readonly devolucionForm = this.fb.nonNullable.group({
    motivo: [''],
    metodoReembolso: ['Efectivo' as MetodoPago, Validators.required],
  });

  protected readonly itemsDevolvibles = computed(() =>
    this.itemsDetalle().filter((item) => this.disponibleParaDevolver(item) > 0),
  );

  protected readonly totalDevolucionActual = computed(() => {
    const cantidades = this.cantidadesDevolucion();
    return redondear(
      this.itemsDetalle().reduce((acc, item) => {
        const cantidad = cantidades[item.id] ?? 0;
        if (cantidad <= 0 || item.cantidad <= 0) return acc;
        const precioNeto = item.subtotal / item.cantidad;
        return acc + cantidad * precioNeto;
      }, 0),
    );
  });

  private hoyISO(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private formatearFecha(fecha: string): string {
    return new Date(fecha).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
  }

  async ngOnInit(): Promise<void> {
    document.documentElement.setAttribute('data-wide', 'grid'); // ancho completo
    await this.cargarListado();
  }

  /** Trae SOLO la página actual del historial que cumple el filtro
   *  aplicado — nunca el histórico completo. Mismo patrón que
   *  OrdenesCompraComponent.cargarListado(). */
  async cargarListado(): Promise<void> {
    this.cargando.set(true);
    const miSecuencia = ++this.secuenciaListado;
    const resultado = await this.cargarListadoSupabase();
    if (miSecuencia !== this.secuenciaListado) return; // ya respondió una búsqueda/página más nueva — descartar esta
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    // Si la página en la que estábamos quedó vacía (p.ej. un filtro nuevo
    // tiene menos páginas que la posición actual), retrocede a la última
    // página real en vez de dejar la tabla en blanco.
    if (resultado.filas.length === 0 && this.paginaActual() > 1 && resultado.total > 0) {
      this.paginaActual.set(Math.max(1, Math.ceil(resultado.total / tamanio)));
      this.cargando.set(false);
      await this.cargarListado();
      return;
    }
    this.ventasPagina.set(resultado.filas);
    this.totalVentasFiltradas.set(resultado.total);
    this.cargando.set(false);
  }

  /** ventas.fn_historial_ventas_listar() hace TODO el trabajo en
   *  PostgreSQL: filtra (folio/cliente por texto, estado, rango de fecha),
   *  resuelve nombre de cliente y vendedor (join), ordena fecha DESC/id
   *  DESC, pagina con OFFSET/LIMIT y calcula el conteo real de filas
   *  (count(*) over(), columna total_filas) en una sola consulta. */
  private async cargarListadoSupabase(): Promise<{ filas: FilaHistorialVenta[]; total: number }> {
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActual() - 1) * tamanio;
    const estado = this.filtroEstado();
    const { data, error } = await this.sb.schema('ventas').rpc('fn_historial_ventas_listar', {
      p_busqueda: this.busqueda().trim() || null,
      p_estado: estado === 'Todas' ? null : estado,
      p_desde_fecha: this.fechaDesde() || null,
      p_hasta_fecha: this.fechaHasta() || null,
      p_desde: desde,
      p_cantidad: tamanio,
    });
    if (error) {
      this.toast.error('No se pudo cargar el historial de ventas: ' + error.message);
      return { filas: [], total: 0 };
    }
    const filas = (data ?? []) as Record<string, unknown>[];
    return { filas: filas.map((f) => this.mapearFila(f)), total: Number(filas[0]?.['total_filas'] ?? 0) };
  }

  private mapearFila(f: Record<string, unknown>): FilaHistorialVenta {
    return {
      id: Number(f['id']),
      folio: String(f['folio']),
      fecha: String(f['fecha']),
      clienteId: Number(f['cliente_id']),
      clienteNombre: (f['cliente_nombre'] as string | null) || '—',
      vendedorUsuarioId: Number(f['vendedor_usuario_id']),
      vendedorNombre: (f['vendedor_nombre'] as string | null) || '—',
      total: Number(f['total']) || 0,
      estado: String(f['estado']),
      canal: (f['canal'] as string | null) ?? null,
    };
  }

  /** Único disparador de una consulta nueva (botón "🔍 Buscar" o Enter en
   *  la caja de búsqueda) — cambiar fecha/estado/texto nunca consulta por
   *  sí solo. Vuelve a la página 1: quedarse en una página de un filtro
   *  nuevo casi siempre cae fuera de rango. */
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

  async verDetalle(fila: FilaHistorialVenta): Promise<void> {
    this.clienteNombreDetalle.set(fila.clienteNombre);
    this.vendedorNombreDetalle.set(fila.vendedorNombre);
    this.cargandoDetalle.set(true);
    const venta = await firstValueFrom(this.data.getById<Venta>('Venta', fila.id));
    this.ventaDetalle.set(venta);
    await this.cargarDetalle(venta);
    this.cargandoDetalle.set(false);
  }

  /** Separado de verDetalle() para poder refrescar el detalle (p.ej. justo
   *  después de registrar una devolución) sin parpadear "Cargando…" otra
   *  vez ni perder el modal abierto. */
  private async cargarDetalle(venta: Venta): Promise<void> {
    const [items, pagos, devoluciones, cuentasPorCobrar] = await Promise.all([
      firstValueFrom(this.data.list<VentaItem>('VentaItem', { ventaId: venta.id })),
      firstValueFrom(this.data.list<VentaPago>('VentaPago', { ventaId: venta.id })),
      firstValueFrom(this.data.list<Devolucion>('Devolucion', { ventaId: venta.id })),
      this.cuentaPorCobrarService.porVenta(venta.id),
    ]);
    this.itemsDetalle.set(items);
    this.pagosDetalle.set(pagos);
    this.cuentasPorCobrarDetalle.set(cuentasPorCobrar);

    if (devoluciones.length === 0) {
      this.devolucionItemsDetalle.set([]);
      return;
    }
    const itemsPorDevolucion = await Promise.all(
      devoluciones.map((d) => firstValueFrom(this.data.list<DevolucionItem>('DevolucionItem', { devolucionId: d.id }))),
    );
    this.devolucionItemsDetalle.set(itemsPorDevolucion.flat());
  }

  cerrarDetalle(): void {
    this.ventaDetalle.set(null);
    this.clienteNombreDetalle.set('—');
    this.vendedorNombreDetalle.set('—');
    this.itemsDetalle.set([]);
    this.pagosDetalle.set([]);
    this.devolucionItemsDetalle.set([]);
    this.cuentasPorCobrarDetalle.set([]);
  }

  disponibleParaDevolver(item: VentaItem): number {
    return cantidadDisponibleParaDevolver(item, this.devolucionItemsDetalle());
  }

  cantidadDevolucion(ventaItemId: number): number {
    return this.cantidadesDevolucion()[ventaItemId] ?? 0;
  }

  actualizarCantidadDevolucion(item: VentaItem, valor: string): void {
    const disponible = this.disponibleParaDevolver(item);
    const cantidad = Math.min(disponible, Math.max(0, Math.round(Number(valor) || 0)));
    this.cantidadesDevolucion.update((actual) => ({ ...actual, [item.id]: cantidad }));
  }

  abrirDevolucion(): void {
    this.cantidadesDevolucion.set({});
    this.devolucionForm.reset({ motivo: '', metodoReembolso: 'Efectivo' });
    this.modalDevolucionAbierto.set(true);
  }

  cerrarDevolucion(): void {
    this.modalDevolucionAbierto.set(false);
  }

  async confirmarDevolucion(): Promise<void> {
    const venta = this.ventaDetalle();
    const usuario = this.auth.usuarioActual();
    if (!venta || !usuario) return;

    const cantidades = this.cantidadesDevolucion();
    const lineas: LineaDevolucionEntrada[] = this.itemsDetalle()
      .filter((item) => (cantidades[item.id] ?? 0) > 0)
      .map((item) => {
        const cantidad = cantidades[item.id];
        const precioNeto = item.cantidad > 0 ? item.subtotal / item.cantidad : 0;
        return {
          ventaItemId: item.id,
          productoId: item.productoId,
          descripcion: item.descripcion,
          cantidad,
          precioUnitario: item.precioUnitario,
          subtotal: redondear(cantidad * precioNeto),
          bodegaId: item.bodegaId,
        };
      });

    if (lineas.length === 0) {
      this.toast.advertencia('Indica al menos una cantidad a devolver.');
      return;
    }
    if (this.devolucionForm.invalid) {
      this.devolucionForm.markAllAsTouched();
      return;
    }

    this.guardandoDevolucion.set(true);
    try {
      const valor = this.devolucionForm.getRawValue();
      const devolucion = await this.devolucionService.registrar({
        ventaId: venta.id,
        usuarioId: usuario.id,
        motivo: valor.motivo || null,
        lineas,
        metodoReembolso: valor.metodoReembolso,
      });
      this.toast.exito(`Devolución ${devolucion.folio} registrada — existencia repuesta.`);
      this.modalDevolucionAbierto.set(false);
      await this.cargarDetalle(venta);
      await this.cargarListado();
    } finally {
      this.guardandoDevolucion.set(false);
    }
  }

  pedirCancelar(venta: Venta): void {
    this.ventaACancelar.set(venta);
  }

  async confirmarCancelar(): Promise<void> {
    const venta = this.ventaACancelar();
    if (!venta) return;

    try {
      const ventaCancelada = await this.ventaService.cancelar(venta);
      this.toast.exito(`Venta ${venta.folio} cancelada — existencia repuesta.`);
      this.ventaACancelar.set(null);
      this.ventaDetalle.set(ventaCancelada);
      await this.cargarListado();
    } catch (error) {
      this.ventaACancelar.set(null);
      this.toast.error(error instanceof Error ? error.message : 'No se pudo cancelar la venta.');
    }
  }

  /** Exporta TODAS las ventas que cumplen el filtro actual (no solo la
   *  página visible), pidiéndolas en lotes de TAMANO_LOTE_EXPORTAR — nunca
   *  en una sola petición gigante ni descargando de más. Mismo patrón que
   *  UsuariosListComponent.exportarUsuariosCsv(). */
  async exportarCsv(): Promise<void> {
    const estado = this.filtroEstado();
    const parametros = {
      p_busqueda: this.busqueda().trim() || null,
      p_estado: estado === 'Todas' ? null : estado,
      p_desde_fecha: this.fechaDesde() || null,
      p_hasta_fecha: this.fechaHasta() || null,
    };

    const todas: FilaHistorialVenta[] = [];
    let desde = 0;
    let total = Infinity;
    while (desde < total) {
      const { data, error } = await this.sb
        .schema('ventas')
        .rpc('fn_historial_ventas_listar', { ...parametros, p_desde: desde, p_cantidad: TAMANO_LOTE_EXPORTAR });
      if (error) {
        this.toast.error('No se pudo exportar el historial: ' + error.message);
        return;
      }
      const filas = (data ?? []) as Record<string, unknown>[];
      if (filas.length === 0) break;
      todas.push(...filas.map((f) => this.mapearFila(f)));
      total = Number(filas[0]?.['total_filas'] ?? 0);
      desde += TAMANO_LOTE_EXPORTAR;
    }

    exportarCsv(
      'historial_ventas.csv',
      [
        { clave: 'folio', etiqueta: 'Folio' },
        { clave: 'fecha', etiqueta: 'Fecha' },
        { clave: 'cliente', etiqueta: 'Cliente' },
        { clave: 'vendedor', etiqueta: 'Vendedor' },
        { clave: 'total', etiqueta: 'Total' },
        { clave: 'estado', etiqueta: 'Estado' },
      ],
      todas.map((v) => ({
        folio: v.folio,
        fecha: this.formatearFecha(v.fecha),
        cliente: v.clienteNombre,
        vendedor: v.vendedorNombre,
        total: v.total,
        estado: v.estado,
      })),
    );
  }

  /** PDF es un reporte acotado a TOPE_FILAS_PDF (no un volcado completo) —
   *  mismo criterio que MovimientosBodegaComponent.exportarPdfHistorial().
   *  Si hay más filas que las mostradas, lo dice explícitamente (exporta
   *  CSV para el detalle completo). */
  async exportarPdf(): Promise<void> {
    const estado = this.filtroEstado();
    const { data, error } = await this.sb.schema('ventas').rpc('fn_historial_ventas_listar', {
      p_busqueda: this.busqueda().trim() || null,
      p_estado: estado === 'Todas' ? null : estado,
      p_desde_fecha: this.fechaDesde() || null,
      p_hasta_fecha: this.fechaHasta() || null,
      p_desde: 0,
      p_cantidad: TOPE_FILAS_PDF,
    });
    if (error) {
      this.toast.error('No se pudo exportar el historial: ' + error.message);
      return;
    }
    const filas = (data ?? []) as Record<string, unknown>[];
    const filasListado = filas.map((f) => this.mapearFila(f));
    const totalFiltrado = Number(filas[0]?.['total_filas'] ?? filasListado.length);
    const notaListado =
      totalFiltrado > filasListado.length
        ? `Mostrando las primeras ${filasListado.length} de ${totalFiltrado} ventas filtradas (exporta CSV para el detalle completo).`
        : undefined;

    exportarTablaPdf({
      nombreArchivo: 'historial_ventas.pdf',
      titulo: 'Historial de ventas',
      subtitulo: notaListado ?? `Del ${this.fechaDesde()} al ${this.fechaHasta()}`,
      columnas: [
        { etiqueta: 'Folio', ancho: 26 },
        { etiqueta: 'Fecha', ancho: 32 },
        { etiqueta: 'Cliente', ancho: 50 },
        { etiqueta: 'Vendedor', ancho: 40 },
        { etiqueta: 'Total', ancho: 24 },
        { etiqueta: 'Estado' },
      ],
      filas: filasListado.map((v) => [
        v.folio,
        this.formatearFecha(v.fecha),
        v.clienteNombre,
        v.vendedorNombre,
        formatMoneda(v.total),
        v.estado,
      ]),
    });
  }

  imprimirTicket(venta: Venta, items: VentaItem[], pagos: VentaPago[]): void {
    const cuerpo = construirTicketHtml({
      venta,
      items,
      pagos,
      clienteNombre: this.clienteNombreDetalle(),
      cajeroNombre: this.vendedorNombreDetalle(),
    });
    try {
      imprimirHtml(`Ticket ${venta.folio}`, cuerpo, estiloTicket('80mm'));
    } catch {
      this.toast.error('No se pudo preparar la impresión del ticket.');
    }
  }
}

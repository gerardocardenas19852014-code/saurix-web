import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { AuthService } from '../../../core/services/auth.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { imprimirHtml } from '../../../shared/utils/imprimir.util';
import { Usuario, nombreCompletoUsuario } from '../../seguridad/usuarios/usuario.model';
import { Cliente } from '../clientes/cliente.model';
import { MetodoPago, METODOS_PAGO, Venta, VentaItem, VentaPago } from '../venta/venta.model';
import { VentaService } from '../venta/venta.service';
import { Devolucion, DevolucionItem } from '../devolucion/devolucion.model';
import { CuentaPorCobrar } from '../cuenta-por-cobrar/cuenta-por-cobrar.model';
import { CuentaPorCobrarService } from '../cuenta-por-cobrar/cuenta-por-cobrar.service';
import { cantidadDisponibleParaDevolver, DevolucionService, LineaDevolucionEntrada } from '../devolucion/devolucion.service';
import { construirTicketHtml, ESTILO_TICKET, formatMoneda, redondear } from '../ventas.util';
import { exportarCsv } from '../../../shared/utils/csv.util';
import { exportarTablaPdf } from '../../../shared/utils/pdf-tabla.util';

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
  private readonly ventaService = inject(VentaService);
  private readonly devolucionService = inject(DevolucionService);
  private readonly cuentaPorCobrarService = inject(CuentaPorCobrarService);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  protected readonly toast = inject(ToastService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);
  protected readonly formatMoneda = formatMoneda;
  protected readonly metodosPago = METODOS_PAGO;

  protected readonly cargando = signal(true);
  protected readonly ventas = signal<Venta[]>([]);
  protected readonly clientes = signal<Cliente[]>([]);
  protected readonly usuarios = signal<Usuario[]>([]);

  protected readonly busqueda = signal('');
  protected readonly fechaDesde = signal(this.hoyISO());
  protected readonly fechaHasta = signal(this.hoyISO());
  protected readonly filtroEstado = signal<'Todas' | 'Completada' | 'Cancelada'>('Todas');

  protected readonly ventasFiltradas = computed(() => {
    const texto = this.busqueda().trim().toLowerCase();
    const desde = this.fechaDesde();
    const hasta = this.fechaHasta();
    const estado = this.filtroEstado();

    return this.ventas()
      .filter((v) => {
        const fechaVenta = v.fecha.slice(0, 10);
        if (desde && fechaVenta < desde) return false;
        if (hasta && fechaVenta > hasta) return false;
        if (estado !== 'Todas' && v.estado !== estado) return false;
        if (!texto) return true;
        const cliente = this.nombreCliente(v.clienteId).toLowerCase();
        return v.folio.toLowerCase().includes(texto) || cliente.includes(texto);
      })
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
  });

  protected readonly columnas: ColumnaTabla<Venta>[] = [
    { campo: 'folio', etiqueta: 'Folio' },
    { campo: 'fecha', etiqueta: 'Fecha', formatear: (v) => this.formatearFecha(v.fecha) },
    { campo: 'clienteId', etiqueta: 'Cliente', formatear: (v) => this.nombreCliente(v.clienteId) },
    { campo: 'vendedorUsuarioId', etiqueta: 'Vendedor', formatear: (v) => this.nombreVendedor(v.vendedorUsuarioId) },
    { campo: 'total', etiqueta: 'Total', formatear: (v) => formatMoneda(v.total) },
    {
      campo: 'estado',
      etiqueta: 'Estado',
      claseValor: (v) => (v.estado === 'Completada' ? 'grid-badge-success' : 'grid-badge-muted'),
    },
    { campo: 'canal', etiqueta: 'Canal', formatear: (v) => v.canal || 'Mostrador' },
  ];

  protected readonly ventaDetalle = signal<Venta | null>(null);
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

  protected nombreCliente(clienteId: number): string {
    return this.clientes().find((c) => c.id === clienteId)?.nombre ?? '—';
  }

  protected nombreVendedor(usuarioId: number): string {
    const usuario = this.usuarios().find((u) => u.id === usuarioId);
    return usuario ? nombreCompletoUsuario(usuario) : '—';
  }

  async ngOnInit(): Promise<void> {
    document.documentElement.setAttribute('data-wide', 'grid'); // ancho completo
    await this.cargar();
  }

  private async cargar(): Promise<void> {
    this.cargando.set(true);
    const [ventas, clientes, usuarios] = await Promise.all([
      firstValueFrom(this.data.list<Venta>('Venta')),
      firstValueFrom(this.data.list<Cliente>('Cliente')),
      firstValueFrom(this.data.list<Usuario>('Usuario')),
    ]);
    this.ventas.set(ventas);
    this.clientes.set(clientes);
    this.usuarios.set(usuarios);
    this.cargando.set(false);
  }

  async verDetalle(venta: Venta): Promise<void> {
    this.ventaDetalle.set(venta);
    this.cargandoDetalle.set(true);
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
      await this.cargar();
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
      await this.cargar();
    } catch (error) {
      this.ventaACancelar.set(null);
      this.toast.error(error instanceof Error ? error.message : 'No se pudo cancelar la venta.');
    }
  }

  exportarCsv(): void {
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
      this.ventasFiltradas().map((v) => ({
        folio: v.folio,
        fecha: this.formatearFecha(v.fecha),
        cliente: this.nombreCliente(v.clienteId),
        vendedor: this.nombreVendedor(v.vendedorUsuarioId),
        total: v.total,
        estado: v.estado,
      })),
    );
  }

  exportarPdf(): void {
    exportarTablaPdf({
      nombreArchivo: 'historial_ventas.pdf',
      titulo: 'Historial de ventas',
      subtitulo: `Del ${this.fechaDesde()} al ${this.fechaHasta()}`,
      columnas: [
        { etiqueta: 'Folio', ancho: 26 },
        { etiqueta: 'Fecha', ancho: 32 },
        { etiqueta: 'Cliente', ancho: 50 },
        { etiqueta: 'Vendedor', ancho: 40 },
        { etiqueta: 'Total', ancho: 24 },
        { etiqueta: 'Estado' },
      ],
      filas: this.ventasFiltradas().map((v) => [
        v.folio,
        this.formatearFecha(v.fecha),
        this.nombreCliente(v.clienteId),
        this.nombreVendedor(v.vendedorUsuarioId),
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
      clienteNombre: this.nombreCliente(venta.clienteId),
      cajeroNombre: this.nombreVendedor(venta.vendedorUsuarioId),
    });
    try {
      imprimirHtml(`Ticket ${venta.folio}`, cuerpo, ESTILO_TICKET);
    } catch {
      this.toast.error('No se pudo preparar la impresión del ticket.');
    }
  }
}

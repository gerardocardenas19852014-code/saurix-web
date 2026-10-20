import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { Venta, VentaItem, VentaPago, MetodoPago, METODOS_PAGO } from '../venta/venta.model';
import { Producto } from '../../inventario/productos/producto.model';
import { exportarCsv } from '../../../shared/utils/csv.util';
import { exportarTablaPdf } from '../../../shared/utils/pdf-tabla.util';
import { formatMoneda, redondear } from '../ventas.util';

interface ProductoVendido {
  nombre: string;
  cantidad: number;
  total: number;
}

/** Cuántos días hacia atrás considerar para "Productos más vendidos" —
 *  suficiente para que tenga sentido sin cargar/agregar el historial
 *  completo desde el primer día que exista el sistema. */
const DIAS_TOP_PRODUCTOS = 30;
const CANTIDAD_TOP_PRODUCTOS = 10;

/**
 * "¿Cómo van las ventas ahora mismo?" — mismo criterio exacto que
 * InventarioDashboardComponent (ver dashboard.component.ts en Inventario):
 * tarjetas de totales (.dashboard-stats/.dashboard-stat-card, ver
 * src/styles.scss) + una tabla de detalle debajo, sin ninguna librería de
 * gráficas (el dashboard de Inventario tampoco usa una).
 *
 * "Comparativo contra días anteriores" es Hoy vs Ayer; "productos más
 * vendidos" agrega VentaItem de los últimos DIAS_TOP_PRODUCTOS días (ventas
 * Completadas únicamente — una Cancelada no cuenta como vendida, ver
 * VentaService.cancelar()).
 */
@Component({
  selector: 'app-dashboard-ventas',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './dashboard-ventas.component.html',
  styleUrl: './dashboard-ventas.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardVentasComponent implements OnInit {
  private readonly data = inject(DataClientService);
  protected readonly formatMoneda = formatMoneda;
  protected readonly metodosPago = METODOS_PAGO;

  protected readonly cargando = signal(true);

  private readonly ventas = signal<Venta[]>([]);
  private readonly items = signal<VentaItem[]>([]);
  private readonly pagos = signal<VentaPago[]>([]);
  private readonly productos = signal<Producto[]>([]);

  private readonly hoyISO = new Date().toISOString().slice(0, 10);
  private readonly ayerISO = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  private readonly ventasCompletadas = computed(() => this.ventas().filter((v) => v.estado === 'Completada'));

  protected readonly ventasHoy = computed(() => this.ventasCompletadas().filter((v) => v.fecha.slice(0, 10) === this.hoyISO));
  protected readonly ventasAyer = computed(() => this.ventasCompletadas().filter((v) => v.fecha.slice(0, 10) === this.ayerISO));

  protected readonly totalHoy = computed(() => this.ventasHoy().reduce((acc, v) => acc + v.total, 0));
  protected readonly totalAyer = computed(() => this.ventasAyer().reduce((acc, v) => acc + v.total, 0));

  protected readonly numeroVentasHoy = computed(() => this.ventasHoy().length);
  protected readonly ticketPromedioHoy = computed(() =>
    this.numeroVentasHoy() > 0 ? this.totalHoy() / this.numeroVentasHoy() : 0,
  );

  /** % de cambio de Hoy contra Ayer — null cuando Ayer fue $0 (no hay
   *  contra qué comparar, evita división entre cero). */
  protected readonly cambioPctVsAyer = computed<number | null>(() => {
    const ayer = this.totalAyer();
    if (ayer <= 0) return null;
    return ((this.totalHoy() - ayer) / ayer) * 100;
  });

  protected readonly idsVentasHoy = computed(() => new Set(this.ventasHoy().map((v) => v.id)));

  /** Costo de lo vendido hoy — solo renglones con producto real (ver
   *  Producto.costo, ya existente en Inventario para "Valor de stock"); un
   *  renglón de "Venta simple" (productoId: null, texto libre) no tiene
   *  costo conocido, así que no participa — el margen calculado es exacto
   *  para lo que SÍ es producto de catálogo, y se queda corto si hay mucha
   *  Venta simple (decisión de alcance: no se le pide costo a mano a una
   *  venta simple). Usa el costo ACTUAL del producto (Producto.costo), no
   *  un costo histórico por lote — mismo criterio que Valor de stock. */
  protected readonly costoVendidoHoy = computed(() => {
    const ids = this.idsVentasHoy();
    const productosPorId = new Map(this.productos().map((p) => [p.id, p]));
    return redondear(
      this.items()
        .filter((i) => ids.has(i.ventaId) && i.productoId !== null)
        .reduce((acc, i) => acc + i.cantidad * (productosPorId.get(i.productoId!)?.costo ?? 0), 0),
    );
  });

  protected readonly margenHoy = computed(() => redondear(this.totalHoy() - this.costoVendidoHoy()));

  protected readonly margenPctHoy = computed(() => {
    const total = this.totalHoy();
    return total > 0 ? (this.margenHoy() / total) * 100 : 0;
  });

  protected readonly totalPorMetodoHoy = computed<{ metodoPago: MetodoPago; total: number }[]>(() => {
    const ids = this.idsVentasHoy();
    const pagosHoy = this.pagos().filter((p) => ids.has(p.ventaId));
    return this.metodosPago.map((metodoPago) => ({
      metodoPago,
      total: pagosHoy.filter((p) => p.metodoPago === metodoPago).reduce((acc, p) => acc + p.monto, 0),
    }));
  });

  /** Desglose de hoy por canal — ver Venta.canal (texto libre). Las
   *  ventas sin canal capturado (mostrador normal) se agrupan como
   *  "Mostrador" para no dejar un hueco en blanco en la tarjeta. */
  protected readonly totalPorCanalHoy = computed<{ canal: string; total: number; cantidad: number }[]>(() => {
    const porCanal = new Map<string, { total: number; cantidad: number }>();
    for (const venta of this.ventasHoy()) {
      const clave = venta.canal?.trim() || 'Mostrador';
      const actual = porCanal.get(clave) ?? { total: 0, cantidad: 0 };
      actual.total += venta.total;
      actual.cantidad += 1;
      porCanal.set(clave, actual);
    }
    return Array.from(porCanal.entries())
      .map(([canal, v]) => ({ canal, ...v }))
      .sort((a, b) => b.total - a.total);
  });

  protected readonly productosMasVendidos = computed<ProductoVendido[]>(() => {
    const limiteISO = new Date(Date.now() - DIAS_TOP_PRODUCTOS * 86400000).toISOString().slice(0, 10);
    const idsVentasEnRango = new Set(
      this.ventasCompletadas().filter((v) => v.fecha.slice(0, 10) >= limiteISO).map((v) => v.id),
    );

    const porNombre = new Map<string, ProductoVendido>();
    for (const item of this.items()) {
      if (!idsVentasEnRango.has(item.ventaId)) continue;
      const existente = porNombre.get(item.descripcion);
      if (existente) {
        existente.cantidad += item.cantidad;
        existente.total += item.subtotal;
      } else {
        porNombre.set(item.descripcion, { nombre: item.descripcion, cantidad: item.cantidad, total: item.subtotal });
      }
    }

    return Array.from(porNombre.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, CANTIDAD_TOP_PRODUCTOS);
  });

  async ngOnInit(): Promise<void> {
    this.cargando.set(true);

    // VentaItem/VentaPago traía la tabla COMPLETA (todas las ventas desde
    // siempre, con todos sus renglones y pagos) solo para sacar "hoy vs
    // ayer" y el top 30 días — con historial real esto son muchísimas más
    // filas que Venta (varios renglones/pagos por cada venta) y provocó el
    // 504 (Gateway Timeout) reportado en consola. Ahora Venta/Producto se
    // piden completos (una fila por venta, costo acotado) y de ahí se saca
    // el conjunto de ventaId dentro de la ventana de DIAS_TOP_PRODUCTOS
    // días — todo lo que este dashboard necesita cae dentro de esa ventana
    // (Hoy/Ayer incluidos) — para pedir VentaItem/VentaPago solo de esas
    // ventas (ver el soporte de filtro por arreglo, ".in()"/"IndexedDB.
    // includes()", agregado en DataClientService para este caso).
    const [ventas, productos] = await Promise.all([
      firstValueFrom(this.data.list<Venta>('Venta')),
      firstValueFrom(this.data.list<Producto>('Producto')),
    ]);

    const limiteISO = new Date(Date.now() - DIAS_TOP_PRODUCTOS * 86400000).toISOString().slice(0, 10);
    const idsEnRango = ventas.filter((v) => v.fecha.slice(0, 10) >= limiteISO).map((v) => v.id);

    const [items, pagos] =
      idsEnRango.length > 0
        ? await Promise.all([
            firstValueFrom(this.data.list<VentaItem>('VentaItem', { ventaId: idsEnRango })),
            firstValueFrom(this.data.list<VentaPago>('VentaPago', { ventaId: idsEnRango })),
          ])
        : [[], []];

    this.ventas.set(ventas);
    this.items.set(items);
    this.pagos.set(pagos);
    this.productos.set(productos);
    this.cargando.set(false);
  }

  exportarCsv(): void {
    exportarCsv(
      'productos_mas_vendidos.csv',
      [
        { clave: 'nombre', etiqueta: 'Producto' },
        { clave: 'cantidad', etiqueta: 'Cantidad' },
        { clave: 'total', etiqueta: 'Total vendido' },
      ],
      this.productosMasVendidos().map((p) => ({ nombre: p.nombre, cantidad: p.cantidad, total: p.total })),
    );
  }

  exportarPdf(): void {
    exportarTablaPdf({
      nombreArchivo: 'productos_mas_vendidos.pdf',
      titulo: 'Dashboard de ventas — Productos más vendidos',
      subtitulo: `Últimos ${DIAS_TOP_PRODUCTOS} días · Ventas de hoy: ${formatMoneda(this.totalHoy())} · Margen: ${formatMoneda(this.margenHoy())}`,
      columnas: [{ etiqueta: 'Producto' }, { etiqueta: 'Cantidad', ancho: 30 }, { etiqueta: 'Total vendido', ancho: 36 }],
      filas: this.productosMasVendidos().map((p) => [p.nombre, String(p.cantidad), formatMoneda(p.total)]),
    });
  }
}

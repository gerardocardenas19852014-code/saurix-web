import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { Venta, VentaItem, VentaPago, MetodoPago, METODOS_PAGO } from '../venta/venta.model';
import { formatMoneda } from '../ventas.util';

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

  protected readonly totalPorMetodoHoy = computed<{ metodoPago: MetodoPago; total: number }[]>(() => {
    const ids = this.idsVentasHoy();
    const pagosHoy = this.pagos().filter((p) => ids.has(p.ventaId));
    return this.metodosPago.map((metodoPago) => ({
      metodoPago,
      total: pagosHoy.filter((p) => p.metodoPago === metodoPago).reduce((acc, p) => acc + p.monto, 0),
    }));
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

  ngOnInit(): void {
    this.cargando.set(true);
    Promise.all([
      firstValueFrom(this.data.list<Venta>('Venta')),
      firstValueFrom(this.data.list<VentaItem>('VentaItem')),
      firstValueFrom(this.data.list<VentaPago>('VentaPago')),
    ]).then(([ventas, items, pagos]) => {
      this.ventas.set(ventas);
      this.items.set(items);
      this.pagos.set(pagos);
      this.cargando.set(false);
    });
  }
}

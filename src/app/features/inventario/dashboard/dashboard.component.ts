import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { Producto } from '../productos/producto.model';
import { formatMoneda, existenciaTotal, alertasStockBajo, haySobreStock } from '../productos/producto.util';
import { ExistenciaBodega } from '../movimientos-bodega/existencia-bodega.model';
import { NivelMinimoBodega } from '../productos/nivel-minimo-bodega.model';
import { MovimientoInventario } from '../movimientos-bodega/movimiento-inventario.model';
import { OrdenCompra } from '../compras/orden-compra.model';
import { LoteProducto } from '../lotes-caducidad/lote-producto.model';
import { diasParaCaducar } from '../lotes-caducidad/lote-producto.util';

type TipoMovimiento = 'entrada' | 'traspaso' | 'salida';

interface FilaMovimientoReciente {
  id: number;
  fecha: string;
  productoNombre: string;
  tipo: TipoMovimiento;
  cantidad: number;
}

/** Cuántos movimientos recientes mostrar en el resumen — ver últimosMovimientos. */
const CANTIDAD_MOVIMIENTOS_RECIENTES = 10;
/** Mismo umbral que lotes-caducidad.component.ts. */
const UMBRAL_PROXIMOS_DIAS = 30;

/**
 * "¿Cómo está el inventario ahora mismo?" en un solo lugar — antes vivía
 * arriba de la cuadrícula de pantallas en Inicio de Inventario, pero se
 * movió a su propia pantalla (ver backlog de mejoras de Inventario) para
 * que Inicio se quede solo como índice de pantallas. Cada tarjeta
 * reutiliza exactamente las mismas funciones que ya validan esas alertas
 * en su propia pantalla (alertasStockBajo()/haySobreStock() de
 * producto.util.ts, el mismo criterio de "vencida" de
 * ordenes-compra.component.ts, diasParaCaducar() de lote-producto.util.ts)
 * para que nunca se desincronicen con lo que el usuario ya ve ahí.
 */
@Component({
  selector: 'app-inventario-dashboard',
  standalone: true,
  imports: [RouterLink, DatePipe],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InventarioDashboardComponent implements OnInit {
  private readonly data = inject(DataClientService);

  protected readonly cargando = signal(true);

  private readonly productos = signal<Producto[]>([]);
  private readonly existenciasBodega = signal<ExistenciaBodega[]>([]);
  private readonly nivelesMinimoBodega = signal<NivelMinimoBodega[]>([]);
  private readonly movimientos = signal<MovimientoInventario[]>([]);
  private readonly ordenesCompra = signal<OrdenCompra[]>([]);
  private readonly lotes = signal<LoteProducto[]>([]);

  private readonly productosFisicosActivos = computed(() => this.productos().filter((p) => p.activo && p.existencia !== null));

  protected readonly valorTotalInventario = computed(() =>
    this.productosFisicosActivos().reduce((acc, p) => acc + existenciaTotal(p, this.existenciasBodega()) * p.costo, 0),
  );
  protected readonly valorTotalFormateado = computed(() => formatMoneda(this.valorTotalInventario()));

  protected readonly totalStockBajo = computed(
    () => this.productosFisicosActivos().filter((p) => alertasStockBajo(p, this.existenciasBodega(), this.nivelesMinimoBodega()).length > 0).length,
  );
  protected readonly totalSobreStock = computed(
    () => this.productosFisicosActivos().filter((p) => haySobreStock(p, this.existenciasBodega())).length,
  );

  private readonly hoyTexto = new Date().toISOString().slice(0, 10);

  protected readonly ordenesPendientes = computed(
    () => this.ordenesCompra().filter((o) => o.estado === 'pendiente' || o.estado === 'recibida_parcial').length,
  );
  protected readonly ordenesVencidas = computed(
    () =>
      this.ordenesCompra().filter(
        (o) =>
          (o.estado === 'pendiente' || o.estado === 'recibida_parcial') &&
          !!o.fechaEntregaEstimada &&
          o.fechaEntregaEstimada.slice(0, 10) < this.hoyTexto,
      ).length,
  );

  protected readonly lotesPorVencer = computed(
    () =>
      this.lotes().filter((l) => {
        if (!l.activo) return false;
        const dias = diasParaCaducar(l.fechaCaducidad);
        return dias !== null && dias >= 0 && dias <= UMBRAL_PROXIMOS_DIAS;
      }).length,
  );
  protected readonly lotesVencidos = computed(
    () => this.lotes().filter((l) => l.activo && (diasParaCaducar(l.fechaCaducidad) ?? 1) < 0).length,
  );

  private nombreProducto(id: number): string {
    return this.productos().find((p) => p.id === id)?.nombre ?? '—';
  }

  protected readonly ultimosMovimientos = computed<FilaMovimientoReciente[]>(() =>
    [...this.movimientos()]
      .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id)
      .slice(0, CANTIDAD_MOVIMIENTOS_RECIENTES)
      .map((m) => ({
        id: m.id,
        fecha: m.fecha,
        productoNombre: this.nombreProducto(m.productoId),
        tipo: m.bodegaOrigenId === null ? 'entrada' : m.bodegaDestinoId === null ? 'salida' : 'traspaso',
        cantidad: m.cantidad,
      })),
  );

  ngOnInit(): void {
    this.cargar();
  }

  private cargar(): void {
    this.cargando.set(true);
    Promise.all([
      firstValueFrom(this.data.list<Producto>('Producto')),
      firstValueFrom(this.data.list<ExistenciaBodega>('ExistenciaBodega')),
      firstValueFrom(this.data.list<NivelMinimoBodega>('NivelMinimoBodega')),
      firstValueFrom(this.data.list<MovimientoInventario>('MovimientoInventario')),
      firstValueFrom(this.data.list<OrdenCompra>('OrdenCompra')),
      firstValueFrom(this.data.list<LoteProducto>('LoteProducto')),
    ]).then(([productos, existenciasBodega, nivelesMinimoBodega, movimientos, ordenesCompra, lotes]) => {
      this.productos.set(productos);
      this.existenciasBodega.set(existenciasBodega);
      this.nivelesMinimoBodega.set(nivelesMinimoBodega);
      this.movimientos.set(movimientos);
      this.ordenesCompra.set(ordenesCompra);
      this.lotes.set(lotes);
      this.cargando.set(false);
    });
  }
}

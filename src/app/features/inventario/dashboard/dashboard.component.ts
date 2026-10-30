import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { DataClientService, FiltroRango } from '../../../core/services/data-client.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { fuenteDatosActual } from '../../../core/services/fuente-datos';
import { ToastService } from '../../../shared/services/toast.service';
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

/** Cuántos movimientos recientes mostrar en el resumen — ver cargarUltimosMovimientos(). */
const CANTIDAD_MOVIMIENTOS_RECIENTES = 10;
/** Solo usado en modo IndexedDB local (ver cargarTodoLocal()): ahí sí hace
 *  falta acotar el rango antes de ordenar/recortar en memoria, porque esa
 *  tabla no tiene paginación propia. En modo Supabase esto ya no aplica —
 *  fn_movimientos_historial() hace ORDER BY + LIMIT directo en PostgreSQL,
 *  sin necesidad de acotar por fecha primero. */
const DIAS_MOVIMIENTOS_RECIENTES_LOCAL = 14;
/** Mismo umbral que lotes-caducidad.component.ts / fn_lotes_resumen(). */
const UMBRAL_PROXIMOS_DIAS = 30;

/**
 * "¿Cómo está el inventario ahora mismo?" en un solo lugar — antes vivía
 * arriba de la cuadrícula de pantallas en Inicio de Inventario, pero se
 * movió a su propia pantalla (ver backlog de mejoras de Inventario) para
 * que Inicio se quede solo como índice de pantallas.
 *
 * Homologación 30-oct-2026 (rendimiento + aprovechamiento de ancho), mismo
 * estándar ya aplicado a Valor de stock / Lotes y caducidad / Movimientos
 * entre bodegas / Kardex / Órdenes de compra:
 *
 * ANTES: `cargar()` hacía 6 `data.list(...)` sin paginar (Producto,
 * ExistenciaBodega, NivelMinimoBodega, OrdenCompra, LoteProducto completos
 * + MovimientoInventario acotado solo por fecha) y calculaba las 5
 * tarjetas + "Últimos movimientos" (`sort().slice(0,10)`) 100% en Angular.
 * Con 200,000+ productos esto implicaba descargar el catálogo completo
 * varias veces solo para mostrar 5 números y una tabla de 10 filas.
 *
 * AHORA (modo Supabase): cada tarjeta se resuelve con una función RPC ya
 * existente — reutilizada, no reinventada, exactamente como pide el
 * estándar del proyecto — cada una ya validada/medida en su propia
 * homologación:
 *  - Valor total / Stock bajo / Sobre-stock → `fn_valor_stock_resumen()`
 *    (misma fuente que usa Valor de stock: `producto_valor_resumen`,
 *    medida a 200,000 productos reales ~0.6s).
 *  - Lotes próximos a vencer / vencidos → `fn_lotes_resumen()` (misma que
 *    usa Lotes y caducidad, mismo umbral de 30 días).
 *  - Órdenes pendientes/vencidas → `fn_ordenes_compra_resumen()` (única
 *    función nueva de esta homologación: dos `count(*) filter(...)`, misma
 *    regla que ya tenía esta pantalla).
 *  - Últimos movimientos → `fn_movimientos_historial(..., 0, 10)` (misma
 *    que usa Movimientos entre bodegas: `ORDER BY fecha DESC, id DESC
 *    LIMIT 10` ya en PostgreSQL, con producto ya unido — cero N+1).
 * Las 4 se piden en paralelo. Cada una maneja su propio error (toast +
 * valor por defecto) para que un fallo puntual de una sola RPC no deje a
 * las otras tres sin mostrarse ni la pantalla cargando indefinidamente.
 *
 * Modo IndexedDB local (uso sin Supabase): se conserva exactamente el
 * cálculo anterior en memoria (ver cargarTodoLocal()) — por diseño nunca
 * maneja catálogos de 200k productos, así que no tiene el problema que
 * resuelve este cambio.
 */
@Component({
  selector: 'app-inventario-dashboard',
  standalone: true,
  imports: [RouterLink, DatePipe],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InventarioDashboardComponent implements OnInit, OnDestroy {
  // Pantalla a ancho completo (html[data-wide='grid'] en styles.scss) —
  // mismo mecanismo ya usado en Bodegas/Categorías/Kardex/Valor de
  // stock/etc. para dejar de estar limitado por max-width:980px.
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  private readonly data = inject(DataClientService);
  private readonly toast = inject(ToastService);

  private readonly esSupabase = fuenteDatosActual() === 'supabase';
  private readonly sb = this.esSupabase ? inject(SupabaseService).cliente : null;

  protected readonly cargando = signal(true);

  private readonly valorCosto = signal(0);
  protected readonly valorTotalFormateado = computed(() => formatMoneda(this.valorCosto()));
  protected readonly totalStockBajo = signal(0);
  protected readonly totalSobreStock = signal(0);
  protected readonly ordenesPendientes = signal(0);
  protected readonly ordenesVencidas = signal(0);
  protected readonly lotesPorVencer = signal(0);
  protected readonly lotesVencidos = signal(0);
  protected readonly ultimosMovimientos = signal<FilaMovimientoReciente[]>([]);

  ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid'); // ancho completo
    this.cargar();
  }

  private cargar(): void {
    this.cargando.set(true);
    // Cada tarea atrapa su propio error (ver abajo) y nunca rechaza la
    // promesa — así Promise.all siempre resuelve, el loading siempre sale
    // por el finally, y el fallo de una tarjeta no le quita datos a las
    // demás ni deja la pantalla cargando para siempre.
    const tareas = this.esSupabase
      ? [this.cargarValorStock(), this.cargarLotes(), this.cargarOrdenes(), this.cargarUltimosMovimientos()]
      : [this.cargarTodoLocal()];
    Promise.all(tareas).finally(() => this.cargando.set(false));
  }

  /** Valor total del inventario + Stock bajo + Sobre-stock — una sola
   *  llamada a fn_valor_stock_resumen() (reutilizada de Valor de stock). */
  private async cargarValorStock(): Promise<void> {
    const { data, error } = await this.sb!.schema('inventario').rpc('fn_valor_stock_resumen');
    if (error) {
      this.toast.error('No se pudo cargar el valor del inventario: ' + error.message);
      return;
    }
    const fila = ((data ?? []) as Record<string, unknown>[])[0];
    this.valorCosto.set(Number(fila?.['valor_costo'] ?? 0));
    this.totalStockBajo.set(Number(fila?.['stock_bajo'] ?? 0));
    this.totalSobreStock.set(Number(fila?.['sobre_stock'] ?? 0));
  }

  /** Lotes próximos a vencer + vencidos — fn_lotes_resumen() (reutilizada
   *  de Lotes y caducidad). */
  private async cargarLotes(): Promise<void> {
    const { data, error } = await this.sb!.schema('inventario').rpc('fn_lotes_resumen');
    if (error) {
      this.toast.error('No se pudieron cargar los lotes próximos a vencer: ' + error.message);
      return;
    }
    const fila = ((data ?? []) as Record<string, unknown>[])[0];
    this.lotesPorVencer.set(Number(fila?.['total_proximos'] ?? 0));
    this.lotesVencidos.set(Number(fila?.['total_vencidos'] ?? 0));
  }

  /** Órdenes de compra pendientes + vencidas — fn_ordenes_compra_resumen()
   *  (única función nueva de esta homologación, misma regla de siempre). */
  private async cargarOrdenes(): Promise<void> {
    const { data, error } = await this.sb!.schema('inventario').rpc('fn_ordenes_compra_resumen');
    if (error) {
      this.toast.error('No se pudieron cargar las órdenes de compra: ' + error.message);
      return;
    }
    const fila = ((data ?? []) as Record<string, unknown>[])[0];
    this.ordenesPendientes.set(Number(fila?.['total_pendientes'] ?? 0));
    this.ordenesVencidas.set(Number(fila?.['total_vencidas'] ?? 0));
  }

  /** Últimos 10 movimientos — fn_movimientos_historial() sin filtros
   *  (reutilizada de Movimientos entre bodegas): ORDER BY fecha DESC, id
   *  DESC + LIMIT 10 ya en PostgreSQL, con nombre de producto ya unido. */
  private async cargarUltimosMovimientos(): Promise<void> {
    const { data, error } = await this.sb!.schema('inventario').rpc('fn_movimientos_historial', {
      p_producto_id: null,
      p_bodega_id: null,
      p_desde_fecha: null,
      p_hasta_fecha: null,
      p_desde: 0,
      p_cantidad: CANTIDAD_MOVIMIENTOS_RECIENTES,
    });
    if (error) {
      this.toast.error('No se pudieron cargar los últimos movimientos: ' + error.message);
      return;
    }
    const filas = (data ?? []) as Record<string, unknown>[];
    this.ultimosMovimientos.set(
      filas.map((f) => ({
        id: Number(f['id']),
        fecha: String(f['fecha']),
        productoNombre: String(f['producto_nombre'] ?? '—'),
        tipo: f['tipo'] as TipoMovimiento,
        cantidad: Number(f['cantidad']),
      })),
    );
  }

  /** Modo IndexedDB local (sin Supabase): mismo cálculo 100% en memoria que
   *  tenía esta pantalla antes de la homologación — nunca maneja catálogos
   *  de escala real, así que no necesita las RPC de arriba. */
  private async cargarTodoLocal(): Promise<void> {
    const desde = new Date();
    desde.setDate(desde.getDate() - DIAS_MOVIMIENTOS_RECIENTES_LOCAL);
    const rangoReciente: FiltroRango = { gte: desde.toISOString() };
    const [productos, existenciasBodega, nivelesMinimoBodega, movimientos, ordenesCompra, lotes] = await Promise.all([
      firstValueFrom(this.data.list<Producto>('Producto')),
      firstValueFrom(this.data.list<ExistenciaBodega>('ExistenciaBodega')),
      firstValueFrom(this.data.list<NivelMinimoBodega>('NivelMinimoBodega')),
      firstValueFrom(this.data.list<MovimientoInventario>('MovimientoInventario', { fecha: rangoReciente })),
      firstValueFrom(this.data.list<OrdenCompra>('OrdenCompra')),
      firstValueFrom(this.data.list<LoteProducto>('LoteProducto')),
    ]);

    const productosFisicosActivos = productos.filter((p) => p.activo && p.existencia !== null);
    this.valorCosto.set(
      productosFisicosActivos.reduce((acc, p) => acc + existenciaTotal(p, existenciasBodega) * p.costo, 0),
    );
    this.totalStockBajo.set(
      productosFisicosActivos.filter((p) => alertasStockBajo(p, existenciasBodega, nivelesMinimoBodega).length > 0)
        .length,
    );
    this.totalSobreStock.set(productosFisicosActivos.filter((p) => haySobreStock(p, existenciasBodega)).length);

    const hoyTexto = new Date().toISOString().slice(0, 10);
    this.ordenesPendientes.set(
      ordenesCompra.filter((o) => o.estado === 'pendiente' || o.estado === 'recibida_parcial').length,
    );
    this.ordenesVencidas.set(
      ordenesCompra.filter(
        (o) =>
          (o.estado === 'pendiente' || o.estado === 'recibida_parcial') &&
          !!o.fechaEntregaEstimada &&
          o.fechaEntregaEstimada.slice(0, 10) < hoyTexto,
      ).length,
    );

    this.lotesPorVencer.set(
      lotes.filter((l) => {
        if (!l.activo) return false;
        const dias = diasParaCaducar(l.fechaCaducidad);
        return dias !== null && dias >= 0 && dias <= UMBRAL_PROXIMOS_DIAS;
      }).length,
    );
    this.lotesVencidos.set(lotes.filter((l) => l.activo && (diasParaCaducar(l.fechaCaducidad) ?? 1) < 0).length);

    const nombreProducto = (id: number) => productos.find((p) => p.id === id)?.nombre ?? '—';
    this.ultimosMovimientos.set(
      [...movimientos]
        .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id)
        .slice(0, CANTIDAD_MOVIMIENTOS_RECIENTES)
        .map((m) => ({
          id: m.id,
          fecha: m.fecha,
          productoNombre: nombreProducto(m.productoId),
          tipo: m.bodegaOrigenId === null ? 'entrada' : m.bodegaDestinoId === null ? 'salida' : 'traspaso',
          cantidad: m.cantidad,
        })),
    );
  }
}

import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { SupabaseService } from '../../../core/services/supabase.service';
import { ToastService } from '../../../shared/services/toast.service';
import { formatMoneda } from '../productos/producto.util';

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
 * AHORA: cada tarjeta se resuelve con una función RPC ya existente —
 * reutilizada, no reinventada, exactamente como pide el estándar del
 * proyecto — cada una ya validada/medida en su propia homologación:
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

  private readonly toast = inject(ToastService);
  private readonly sb = inject(SupabaseService).cliente;

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
    const tareas = [this.cargarValorStock(), this.cargarLotes(), this.cargarOrdenes(), this.cargarUltimosMovimientos()];
    Promise.all(tareas).finally(() => this.cargando.set(false));
  }

  /** Valor total del inventario + Stock bajo + Sobre-stock — una sola
   *  llamada a fn_valor_stock_resumen() (reutilizada de Valor de stock). */
  private async cargarValorStock(): Promise<void> {
    const { data, error } = await this.sb.schema('inventario').rpc('fn_valor_stock_resumen');
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
    const { data, error } = await this.sb.schema('inventario').rpc('fn_lotes_resumen');
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
    const { data, error } = await this.sb.schema('inventario').rpc('fn_ordenes_compra_resumen');
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
    const { data, error } = await this.sb.schema('inventario').rpc('fn_movimientos_historial', {
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
}

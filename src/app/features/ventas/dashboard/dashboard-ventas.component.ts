import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { SupabaseService } from '../../../core/services/supabase.service';
import { ToastService } from '../../../shared/services/toast.service';
import { exportarCsv } from '../../../shared/utils/csv.util';
import { exportarTablaPdf } from '../../../shared/utils/pdf-tabla.util';
import { formatMoneda } from '../ventas.util';

type Pestana = 'resumen' | 'metodos' | 'canales' | 'top';

interface ResumenDashboard {
  ventasHoy: number;
  numeroVentasHoy: number;
  ticketPromedioHoy: number;
  ventasAyer: number;
  costoVendidoHoy: number;
  margenBrutoHoy: number;
}

interface FilaMetodoPago {
  metodoPago: string;
  total: number;
}

interface FilaCanal {
  canal: string;
  total: number;
  cantidad: number;
}

interface FilaTopProducto {
  posicion: number;
  productoId: number;
  nombre: string;
  codigo: string | null;
  cantidadVendida: number;
  cantidadDevuelta: number;
  cantidadNeta: number;
  importeNeto: number;
}

/** Fijo en 30 días, tal como ya funcionaba — la Fase 7 pide que si algún
 *  filtro global permitiera cambiarlo no se cambie la regla aprobada en
 *  silencio, así que se mantiene como constante, no como filtro de
 *  usuario (ver mandato Fase 7, Parte E). */
const DIAS_TOP_PRODUCTOS = 30;
/** 10 por página dentro de un Top fijo de 50 (ver
 *  ventas.fn_dashboard_ventas_top_productos — el `limit 50` vive en el
 *  propio SQL, no aquí). */
const CANTIDAD_POR_PAGINA_TOP = 10;

/**
 * HOMOLOGACIÓN DE RENDIMIENTO Y REORGANIZACIÓN (Fase 7, nov-2026): el
 * Dashboard descargaba `Venta`/`Producto` COMPLETOS (sin filtro de fecha
 * ni límite) en cada apertura y calculaba todo en memoria — exactamente lo
 * que la auditoría de Fase 7 documentó como el mismo patrón de riesgo ya
 * causante de un 504 (Gateway Timeout) con `VentaItem`/`VentaPago`. Ahora
 * sigue el mismo criterio ya homologado en Historial de ventas (ver
 * HistorialVentasComponent): 4 funciones de PostgreSQL
 * (`ventas.fn_dashboard_ventas_resumen` / `_metodos_pago` / `_canales` /
 * `_top_productos`) hacen toda la agregación en el servidor — Angular solo
 * pide y muestra lo que corresponde a la pestaña abierta, nunca las 4 a la
 * vez (carga diferida, protegida contra respuestas fuera de orden con un
 * contador de secuencia por pestaña, mismo patrón que
 * HistorialVentasComponent.secuenciaListado).
 *
 * Las 4 funciones ya se ejecutaron y tienen EXECUTE otorgado a
 * `authenticated` (sin PUBLIC/anon — ver
 * claude/fase7-migracion-dashboard-ejecucion-2026-11.md), así que este
 * Dashboard ya puede abrirse contra la base real.
 *
 * Reglas de negocio (confirmadas en la auditoría/decisión de Fase 7):
 * "Ventas de hoy/ayer" y "Costo/Margen" se mantienen BRUTOS (no restan
 * devoluciones, igual que antes — decisión explícita del usuario). Solo
 * "Más vendidos" neta devoluciones, con la fórmula exacta del mandato:
 * cantidad neta = cantidad vendida − cantidad devuelta. "Métodos de
 * pago"/"Canales" netean de forma natural porque sumar `VentaPago.monto`
 * ya incluye los movimientos negativos de una devolución — mismo
 * precedente ya en producción en `TurnoCajaService.resumen()`, no una
 * regla nueva.
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
  private readonly sb = inject(SupabaseService).cliente;
  protected readonly toast = inject(ToastService);
  protected readonly formatMoneda = formatMoneda;

  private readonly hoyISO = new Date().toISOString().slice(0, 10);

  protected readonly pestana = signal<Pestana>('resumen');

  // ---- Resumen ----
  protected readonly cargandoResumen = signal(true);
  protected readonly resumen = signal<ResumenDashboard | null>(null);
  private resumenCargado = false;

  protected readonly cambioPctVsAyer = computed<number | null>(() => {
    const r = this.resumen();
    if (!r || r.ventasAyer <= 0) return null;
    return ((r.ventasHoy - r.ventasAyer) / r.ventasAyer) * 100;
  });

  protected readonly margenPctHoy = computed(() => {
    const r = this.resumen();
    if (!r || r.ventasHoy <= 0) return 0;
    return (r.margenBrutoHoy / r.ventasHoy) * 100;
  });

  // ---- Métodos de pago ----
  protected readonly cargandoMetodos = signal(false);
  protected readonly metodosFilas = signal<FilaMetodoPago[]>([]);
  protected readonly metodosDesde = signal(this.hoyISO);
  protected readonly metodosHasta = signal(this.hoyISO);
  private metodosCargado = false;
  private secuenciaMetodos = 0;

  // ---- Canales ----
  protected readonly cargandoCanales = signal(false);
  protected readonly canalesFilas = signal<FilaCanal[]>([]);
  protected readonly canalesDesde = signal(this.hoyISO);
  protected readonly canalesHasta = signal(this.hoyISO);
  private canalesCargado = false;
  private secuenciaCanales = 0;

  // ---- Más vendidos (Top 50, 10 por página) ----
  protected readonly cargandoTop = signal(false);
  protected readonly topFilas = signal<FilaTopProducto[]>([]);
  protected readonly topPaginaActual = signal(1);
  /** Total real de filas del Top (nunca mayor a 50 — el propio SQL limita
   *  el conjunto base a 50 antes de paginar, ver fn_dashboard_ventas_top_productos). */
  protected readonly topTotalFilas = signal(0);
  protected readonly topTotalPaginas = computed(() =>
    Math.max(1, Math.ceil(this.topTotalFilas() / CANTIDAD_POR_PAGINA_TOP)),
  );
  protected readonly diasTopProductos = DIAS_TOP_PRODUCTOS;
  private topCargado = false;
  private secuenciaTop = 0;

  ngOnInit(): void {
    // Resumen es la pestaña inicial — se carga de una vez; las otras 3 se
    // cargan solo la primera vez que el usuario las abre (cambiarPestana()).
    void this.cargarResumen();
  }

  protected cambiarPestana(p: Pestana): void {
    this.pestana.set(p);
    if (p === 'metodos' && !this.metodosCargado) void this.cargarMetodos();
    if (p === 'canales' && !this.canalesCargado) void this.cargarCanales();
    if (p === 'top' && !this.topCargado) void this.cargarTop();
  }

  private async cargarResumen(): Promise<void> {
    this.resumenCargado = true;
    this.cargandoResumen.set(true);
    const { data, error } = await this.sb.schema('ventas').rpc('fn_dashboard_ventas_resumen', { p_hoy: this.hoyISO });
    if (error) {
      this.toast.error('No se pudo cargar el resumen del Dashboard: ' + error.message);
      this.cargandoResumen.set(false);
      return;
    }
    const fila = ((data ?? []) as Record<string, unknown>[])[0];
    this.resumen.set(
      fila
        ? {
            ventasHoy: Number(fila['ventas_hoy']) || 0,
            numeroVentasHoy: Number(fila['numero_ventas_hoy']) || 0,
            ticketPromedioHoy: Number(fila['ticket_promedio_hoy']) || 0,
            ventasAyer: Number(fila['ventas_ayer']) || 0,
            costoVendidoHoy: Number(fila['costo_vendido_hoy']) || 0,
            margenBrutoHoy: Number(fila['margen_bruto_hoy']) || 0,
          }
        : null,
    );
    this.cargandoResumen.set(false);
  }

  /** Único disparador de una consulta nueva para Métodos de pago (botón
   *  "🔍 Buscar") — cambiar las fechas no consulta por sí solo, mismo
   *  criterio que HistorialVentasComponent.cambiarFiltro(). */
  protected buscarMetodos(): void {
    void this.cargarMetodos();
  }

  private async cargarMetodos(): Promise<void> {
    this.metodosCargado = true;
    this.cargandoMetodos.set(true);
    const miSecuencia = ++this.secuenciaMetodos;
    const { data, error } = await this.sb.schema('ventas').rpc('fn_dashboard_ventas_metodos_pago', {
      p_desde_fecha: this.metodosDesde() || null,
      p_hasta_fecha: this.metodosHasta() || null,
    });
    if (miSecuencia !== this.secuenciaMetodos) return; // una búsqueda más nueva ya respondió — descartar esta
    if (error) {
      this.toast.error('No se pudieron cargar los métodos de pago: ' + error.message);
      this.cargandoMetodos.set(false);
      return;
    }
    const filas = (data ?? []) as Record<string, unknown>[];
    this.metodosFilas.set(filas.map((f) => ({ metodoPago: String(f['metodo_pago']), total: Number(f['total']) || 0 })));
    this.cargandoMetodos.set(false);
  }

  protected buscarCanales(): void {
    void this.cargarCanales();
  }

  private async cargarCanales(): Promise<void> {
    this.canalesCargado = true;
    this.cargandoCanales.set(true);
    const miSecuencia = ++this.secuenciaCanales;
    const { data, error } = await this.sb.schema('ventas').rpc('fn_dashboard_ventas_canales', {
      p_desde_fecha: this.canalesDesde() || null,
      p_hasta_fecha: this.canalesHasta() || null,
    });
    if (miSecuencia !== this.secuenciaCanales) return;
    if (error) {
      this.toast.error('No se pudieron cargar los canales: ' + error.message);
      this.cargandoCanales.set(false);
      return;
    }
    const filas = (data ?? []) as Record<string, unknown>[];
    this.canalesFilas.set(
      filas.map((f) => ({ canal: String(f['canal']), total: Number(f['total']) || 0, cantidad: Number(f['cantidad']) || 0 })),
    );
    this.cargandoCanales.set(false);
  }

  private async cargarTop(): Promise<void> {
    this.topCargado = true;
    this.cargandoTop.set(true);
    const miSecuencia = ++this.secuenciaTop;
    const desde = (this.topPaginaActual() - 1) * CANTIDAD_POR_PAGINA_TOP;
    const { data, error } = await this.sb.schema('ventas').rpc('fn_dashboard_ventas_top_productos', {
      p_dias: DIAS_TOP_PRODUCTOS,
      p_desde: desde,
      p_cantidad: CANTIDAD_POR_PAGINA_TOP,
    });
    if (miSecuencia !== this.secuenciaTop) return;
    if (error) {
      this.toast.error('No se pudo cargar "Más vendidos": ' + error.message);
      this.cargandoTop.set(false);
      return;
    }
    const filas = (data ?? []) as Record<string, unknown>[];
    this.topFilas.set(filas.map((f) => this.mapearFilaTop(f)));
    this.topTotalFilas.set(Number(filas[0]?.['total_filas'] ?? 0));
    this.cargandoTop.set(false);
  }

  private mapearFilaTop(f: Record<string, unknown>): FilaTopProducto {
    return {
      posicion: Number(f['posicion']) || 0,
      productoId: Number(f['producto_id']) || 0,
      nombre: String(f['nombre'] ?? '—'),
      codigo: (f['codigo'] as string | null) ?? null,
      cantidadVendida: Number(f['cantidad_vendida']) || 0,
      cantidadDevuelta: Number(f['cantidad_devuelta']) || 0,
      cantidadNeta: Number(f['cantidad_neta']) || 0,
      importeNeto: Number(f['importe_neto']) || 0,
    };
  }

  protected irATopPaginaAnterior(): void {
    if (this.topPaginaActual() <= 1) return;
    this.topPaginaActual.update((p) => p - 1);
    void this.cargarTop();
  }

  protected irATopPaginaSiguiente(): void {
    if (this.topPaginaActual() >= this.topTotalPaginas()) return;
    this.topPaginaActual.update((p) => p + 1);
    void this.cargarTop();
  }

  /** Exporta las 50 filas del Top (no solo las 10 visibles de la página
   *  actual) — se pide de nuevo al servidor con cantidad=50 en vez de
   *  acumular páginas ya traídas, mismo espíritu que
   *  HistorialVentasComponent.exportarCsv() pero en una sola llamada
   *  porque el Top ya está acotado a 50 por el propio SQL. */
  private async obtenerTop50ParaExportar(): Promise<FilaTopProducto[] | null> {
    const { data, error } = await this.sb.schema('ventas').rpc('fn_dashboard_ventas_top_productos', {
      p_dias: DIAS_TOP_PRODUCTOS,
      p_desde: 0,
      p_cantidad: 50,
    });
    if (error) {
      this.toast.error('No se pudo exportar "Más vendidos": ' + error.message);
      return null;
    }
    return ((data ?? []) as Record<string, unknown>[]).map((f) => this.mapearFilaTop(f));
  }

  async exportarTopCsv(): Promise<void> {
    const filas = await this.obtenerTop50ParaExportar();
    if (!filas) return;
    exportarCsv(
      'productos_mas_vendidos.csv',
      [
        { clave: 'posicion', etiqueta: 'Posición' },
        { clave: 'nombre', etiqueta: 'Producto' },
        { clave: 'codigo', etiqueta: 'Código' },
        { clave: 'cantidadVendida', etiqueta: 'Cantidad vendida' },
        { clave: 'cantidadDevuelta', etiqueta: 'Cantidad devuelta' },
        { clave: 'cantidadNeta', etiqueta: 'Cantidad neta' },
        { clave: 'importeNeto', etiqueta: 'Importe neto' },
      ],
      filas.map((f) => ({
        posicion: f.posicion,
        nombre: f.nombre,
        codigo: f.codigo ?? '—',
        cantidadVendida: f.cantidadVendida,
        cantidadDevuelta: f.cantidadDevuelta,
        cantidadNeta: f.cantidadNeta,
        importeNeto: f.importeNeto,
      })),
    );
  }

  async exportarTopPdf(): Promise<void> {
    const filas = await this.obtenerTop50ParaExportar();
    if (!filas) return;
    exportarTablaPdf({
      nombreArchivo: 'productos_mas_vendidos.pdf',
      titulo: 'Dashboard de ventas — Más vendidos (Top 50)',
      subtitulo: `Últimos ${DIAS_TOP_PRODUCTOS} días · cantidad neta = cantidad vendida − cantidad devuelta`,
      columnas: [
        { etiqueta: 'Pos.', ancho: 12 },
        { etiqueta: 'Producto' },
        { etiqueta: 'Código', ancho: 26 },
        { etiqueta: 'Vendida', ancho: 22 },
        { etiqueta: 'Devuelta', ancho: 22 },
        { etiqueta: 'Neta', ancho: 22 },
        { etiqueta: 'Importe neto', ancho: 30 },
      ],
      filas: filas.map((f) => [
        String(f.posicion),
        f.nombre,
        f.codigo ?? '—',
        String(f.cantidadVendida),
        String(f.cantidadDevuelta),
        String(f.cantidadNeta),
        formatMoneda(f.importeNeto),
      ]),
    });
  }
}

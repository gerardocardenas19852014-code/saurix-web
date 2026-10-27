import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe, DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { fuenteDatosActual } from '../../../core/services/fuente-datos';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { SelectBuscableComponent, OpcionBuscable } from '../../../shared/components/select-buscable/select-buscable.component';
import { Producto } from '../productos/producto.model';
import { formatMoneda, existenciaTotal, alertasStockBajo, haySobreStock } from '../productos/producto.util';
import { CategoriaProducto } from '../categorias-producto/categoria-producto.model';
import { Bodega } from '../bodegas/bodega.model';
import { ExistenciaBodega } from '../movimientos-bodega/existencia-bodega.model';
import { NivelMinimoBodega } from '../productos/nivel-minimo-bodega.model';
import { MovimientoInventario } from '../movimientos-bodega/movimiento-inventario.model';
import { exportarCsv } from '../../../shared/utils/csv.util';
import { exportarTablaPdf } from '../../../shared/utils/pdf-tabla.util';

type TabValorStock = 'resumen' | 'productos' | 'rotacion';
type EstadoFiltro = '' | 'sin_existencia' | 'stock_bajo' | 'sobre_stock';
type OrdenProductos = 'nombre' | 'codigo' | 'existencia' | 'costo' | 'valor';
type Direccion = 'asc' | 'desc';

interface FilaProductoValor {
  productoId: number;
  codigo: string;
  nombre: string;
  categoriaId: number;
  categoriaNombre: string;
  existencia: number;
  costo: number;
  valor: number;
  stockBajo: boolean;
  sobreStock: boolean;
}

interface FilaRotacion {
  productoId: number;
  codigo: string;
  nombre: string;
  existencia: number;
  /** ISO 8601 (solo fecha) del movimiento más reciente, o null = nunca. */
  ultimoMovimiento: string | null;
  diasSinMovimiento: number | null;
}

interface ValorCategoria {
  id: number;
  nombre: string;
  valor: number;
  pct: number;
  color: string;
}

interface ValorBodega {
  /** null = "Sin bodega asignada" (ver fn_valor_stock_por_bodega). */
  id: number | null;
  nombre: string;
  valor: number;
  pct: number;
  color: string;
}

/** Misma paleta que PALETA_CATEGORIAS de Presupuesto Personal (wallet.util.ts). */
const PALETA_CATEGORIAS = ['var(--client)', 'var(--danger)', 'var(--amber)', 'var(--indigo)', 'var(--teal)', 'var(--technical)'];

function colorPaleta(indice: number): string {
  return PALETA_CATEGORIAS[indice % PALETA_CATEGORIAS.length];
}

/** Tamaño del lote al exportar CSV en modo Supabase: suficientemente grande
 *  para pocas idas y vueltas, suficientemente chico para no pedir una
 *  página gigante de un jalón (ver exportarCsvProductos()). */
const TAMANO_LOTE_EXPORTAR = 2000;
/** Tope de filas en el PDF (reporte ejecutivo, no un volcado completo — ver
 *  requerimiento 11 de la especificación): el PDF siempre lleva los
 *  totales/por categoría/por bodega completos, más un listado acotado. */
const TOPE_FILAS_PDF = 200;

/**
 * "Monitorea el valor del stock" (costo × existencia), por producto y por
 * categoría. Solo entran productos FÍSICOS (existencia !== null) y ACTIVOS.
 *
 * Pensado para escalar a 200,000+ productos y millones de movimientos de
 * inventario: en modo Supabase (ver fuenteDatosActual()), TODO el filtrado,
 * orden, paginación y agregación ocurre en Postgres (funciones
 * inventario.fn_valor_stock_* — ver supabase/migrations/48 a 52); Angular
 * nunca recibe más que una tarjeta resumen, un desglose por categoría/
 * bodega (unas pocas filas) o UNA página (25-50 filas) a la vez. Las tres
 * secciones (tarjetas+Resumen, Productos, Rotación) cargan de forma
 * independiente: tarjetas+Resumen al entrar a la pantalla, Productos y
 * Rotación solo la primera vez que se visita esa pestaña (ver
 * seleccionarTab()), cada una con su propio estado de carga — cambiar de
 * pestaña nunca vuelve a pedir lo que ya se cargó, solo cambiar un filtro,
 * de página o de orden dispara una nueva petición (acotada a esa sección).
 *
 * En modo IndexedDB (navegador sin backend, ver fuenteDatosActual()) no hay
 * Postgres al que pedirle agregaciones, así que se mantiene el cálculo en
 * memoria de siempre — a esa escala (datos de un solo usuario en su propio
 * navegador) nunca llega a ser un problema de rendimiento real. Por eso casi
 * todo método clave está duplicado en una variante `...Supabase()` y otra
 * `...Local()`, elegida una sola vez por `esSupabase`.
 */
@Component({
  selector: 'app-valor-stock',
  standalone: true,
  imports: [DecimalPipe, DatePipe, SelectBuscableComponent],
  templateUrl: './valor-stock.component.html',
  styleUrl: './valor-stock.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ValorStockComponent implements OnInit {
  private readonly data = inject(DataClientService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);
  protected readonly formatMoneda = formatMoneda;

  private readonly esSupabase = fuenteDatosActual() === 'supabase';
  private readonly sb = this.esSupabase ? inject(SupabaseService).cliente : null;

  // ── Catálogos chicos (categorías/bodegas) — siempre completos, en ambos
  // modos: nunca son el problema de escala (decenas de filas cuando mucho),
  // así que no tienen su propio RPC, se reutiliza DataClientService.list().
  protected readonly categorias = signal<CategoriaProducto[]>([]);
  protected readonly bodegas = signal<Bodega[]>([]);
  // Sin una opción "Todas las categorías/bodegas" artificial: sin selección
  // (campo en blanco) YA significa "todas"; el combo usa
  // [permiteLimpiar]="true" (ver .html) para volver a ese estado con su
  // botón "✕" en vez de tener que elegir una opción explícita de la lista.
  protected readonly opcionesCategoriaFiltro = computed<OpcionBuscable[]>(() =>
    this.categorias().map((c) => ({ valor: c.id, etiqueta: c.nombre })),
  );
  protected readonly opcionesBodegaFiltro = computed<OpcionBuscable[]>(() =>
    this.bodegas().map((b) => ({ valor: b.id, etiqueta: b.nombre })),
  );

  protected readonly tabActiva = signal<TabValorStock>('resumen');
  private readonly rotacionTabCargada = signal(false);

  // ── Tarjetas + Resumen (cargan juntas al entrar a la pantalla) ──────────
  protected readonly cargandoResumen = signal(true);
  protected readonly valorInventario = signal(0);
  protected readonly valorVenta = signal(0);
  protected readonly margenPotencial = signal(0);
  protected readonly totalProductosValorizables = signal(0);
  protected readonly sinExistencia = signal(0);
  protected readonly stockBajo = signal(0);
  protected readonly sobreStock = signal(0);
  protected readonly porCategoria = signal<ValorCategoria[]>([]);
  protected readonly porBodega = signal<ValorBodega[]>([]);
  protected readonly maxCategoria = computed(() => Math.max(1, ...this.porCategoria().map((c) => c.valor)));
  protected readonly maxBodega = computed(() => Math.max(1, ...this.porBodega().map((b) => b.valor)));
  /** true una vez que la primera carga de tarjetas terminó y no hay nada
   *  que valorizar — distingue "cargando" de "vacío de verdad". */
  protected readonly sinNadaQueValorizar = computed(
    () => !this.cargandoResumen() && this.totalProductosValorizables() === 0,
  );

  // ── Pestaña Productos (carga perezosa, server-side) ─────────────────────
  protected readonly cargandoProductos = signal(false);
  protected readonly productosPagina = signal<FilaProductoValor[]>([]);
  protected readonly totalProductosFiltrados = signal(0);
  protected readonly paginaActualProductos = signal(1);
  protected readonly busquedaProductos = signal('');
  protected readonly categoriaIdFiltro = signal(0); // 0 = sin filtrar (campo en blanco)
  protected readonly bodegaIdFiltro = signal(0); // 0 = sin filtrar (campo en blanco)
  protected readonly estadoFiltro = signal<EstadoFiltro>('');
  /** true solo tras el primer click en "Buscar" (o Enter) en la pestaña
   *  Productos — ver cambiarFiltroProductos(). Antes de eso no se pide nada
   *  al servidor al entrar a la pestaña ni se muestra la tabla/paginador,
   *  mismo criterio que busquedaRealizada en productos.component.ts. */
  protected readonly busquedaProductosRealizada = signal(false);
  protected readonly ordenProductos = signal<OrdenProductos>('nombre');
  protected readonly direccionProductos = signal<Direccion>('asc');
  protected readonly totalPaginasProductos = computed(() =>
    Math.max(1, Math.ceil(this.totalProductosFiltrados() / Math.max(1, this.preferenciasGrid.tamanoPagina()))),
  );
  /** Ignora respuestas de peticiones viejas que lleguen después de una más
   *  nueva (p.ej. el usuario encadenó varios clics en "Buscar" seguidos) —
   *  ver requerimiento 12 ("cancelar/ignorar búsquedas obsoletas"). */
  private secuenciaProductos = 0;

  // ── Pestaña Rotación (carga perezosa, server-side) ──────────────────────
  protected readonly cargandoRotacion = signal(false);
  protected readonly rotacionPagina = signal<FilaRotacion[]>([]);
  protected readonly totalRotacionFiltrada = signal(0);
  protected readonly paginaActualRotacion = signal(1);
  /** Umbral de "sin movimiento" — editable, 60 días por default. */
  protected readonly umbralDias = signal(60);
  protected readonly totalPaginasRotacion = computed(() =>
    Math.max(1, Math.ceil(this.totalRotacionFiltrada() / Math.max(1, this.preferenciasGrid.tamanoPagina()))),
  );
  private secuenciaRotacion = 0;

  // ── Modo IndexedDB: caché local cargado una sola vez bajo demanda ───────
  private baseLocalCargada = false;
  private productosLocal: Producto[] = [];
  private existenciasBodegaLocal: ExistenciaBodega[] = [];
  private nivelesMinimoBodegaLocal: NivelMinimoBodega[] = [];
  private movimientosLocal: MovimientoInventario[] | null = null;

  ngOnInit(): void {
    this.cargarCategoriasYBodegas();
    this.cargarResumen();
  }

  seleccionarTab(tab: TabValorStock): void {
    this.tabActiva.set(tab);
    // La pestaña Productos ya NO se carga sola al visitarla por primera vez
    // — espera a que el usuario haga click en "Buscar" (ver
    // busquedaProductosRealizada/cambiarFiltroProductos()).
    if (tab === 'rotacion' && !this.rotacionTabCargada()) {
      this.rotacionTabCargada.set(true);
      this.cargarRotacion();
    }
  }

  // ───────────────────────── Catálogos ─────────────────────────────────────

  private async cargarCategoriasYBodegas(): Promise<void> {
    const [categorias, bodegas] = await Promise.all([
      firstValueFrom(this.data.list<CategoriaProducto>('CategoriaProducto')),
      firstValueFrom(this.data.list<Bodega>('Bodega')),
    ]);
    this.categorias.set(categorias);
    this.bodegas.set(bodegas);
  }

  private async cargarBaseLocal(): Promise<void> {
    if (this.baseLocalCargada) return;
    const [productos, existenciasBodega, nivelesMinimoBodega] = await Promise.all([
      firstValueFrom(this.data.list<Producto>('Producto')),
      firstValueFrom(this.data.list<ExistenciaBodega>('ExistenciaBodega')),
      firstValueFrom(this.data.list<NivelMinimoBodega>('NivelMinimoBodega')),
    ]);
    this.productosLocal = productos;
    this.existenciasBodegaLocal = existenciasBodega;
    this.nivelesMinimoBodegaLocal = nivelesMinimoBodega;
    this.baseLocalCargada = true;
  }

  private productosValorizablesLocal(): Producto[] {
    return this.productosLocal.filter((p) => p.activo && p.existencia !== null);
  }

  // ───────────────────────── Tarjetas + Resumen ────────────────────────────

  private async cargarResumen(): Promise<void> {
    this.cargandoResumen.set(true);
    if (this.esSupabase) {
      await this.cargarResumenSupabase();
    } else {
      await this.cargarResumenLocal();
    }
    this.cargandoResumen.set(false);
  }

  private async cargarResumenSupabase(): Promise<void> {
    const sb = this.sb!.schema('inventario');
    const [resumenRes, porCatRes, porBodRes] = await Promise.all([
      sb.rpc('fn_valor_stock_resumen'),
      sb.rpc('fn_valor_stock_por_categoria'),
      sb.rpc('fn_valor_stock_por_bodega'),
    ]);

    const r = (resumenRes.data as Record<string, unknown>[] | null)?.[0];
    if (!resumenRes.error && r) {
      this.valorInventario.set(Number(r['valor_costo']) || 0);
      this.valorVenta.set(Number(r['valor_venta']) || 0);
      this.margenPotencial.set(Number(r['margen']) || 0);
      this.totalProductosValorizables.set(Number(r['total_productos']) || 0);
      this.sinExistencia.set(Number(r['sin_existencia']) || 0);
      this.stockBajo.set(Number(r['stock_bajo']) || 0);
      this.sobreStock.set(Number(r['sobre_stock']) || 0);
    }

    if (!porCatRes.error) {
      const filas = (porCatRes.data ?? []) as Record<string, unknown>[];
      this.porCategoria.set(
        filas.map((f, i) => ({
          id: Number(f['categoria_id']),
          nombre: String(f['categoria_nombre']),
          valor: Number(f['valor']) || 0,
          pct: Number(f['pct']) || 0,
          color: colorPaleta(i),
        })),
      );
    }

    if (!porBodRes.error) {
      const filas = (porBodRes.data ?? []) as Record<string, unknown>[];
      this.porBodega.set(
        filas.map((f, i) => ({
          id: f['bodega_id'] === null ? null : Number(f['bodega_id']),
          nombre: String(f['bodega_nombre']),
          valor: Number(f['valor']) || 0,
          pct: Number(f['pct']) || 0,
          color: f['bodega_id'] === null ? 'var(--ink-soft)' : colorPaleta(i),
        })),
      );
    }
  }

  private async cargarResumenLocal(): Promise<void> {
    await this.cargarBaseLocal();
    const valorizables = this.productosValorizablesLocal();
    const nombreCategoria = (id: number) => this.categorias().find((c) => c.id === id)?.nombre ?? '—';
    const nombreBodega = (id: number) => this.bodegas().find((b) => b.id === id)?.nombre ?? '—';

    let valorCosto = 0;
    let valorVenta = 0;
    let sinExistencia = 0;
    let stockBajo = 0;
    let sobreStock = 0;
    const valorPorCategoria = new Map<number, { nombre: string; valor: number }>();

    for (const p of valorizables) {
      const existencia = existenciaTotal(p, this.existenciasBodegaLocal);
      const valor = existencia * p.costo;
      valorCosto += valor;
      valorVenta += existencia * p.precioUnitario;
      if (existencia === 0) sinExistencia++;
      if (alertasStockBajo(p, this.existenciasBodegaLocal, this.nivelesMinimoBodegaLocal).length > 0) stockBajo++;
      if (haySobreStock(p, this.existenciasBodegaLocal)) sobreStock++;

      const actual = valorPorCategoria.get(p.categoriaProductoId);
      if (actual) actual.valor += valor;
      else valorPorCategoria.set(p.categoriaProductoId, { nombre: nombreCategoria(p.categoriaProductoId), valor });
    }

    this.valorInventario.set(valorCosto);
    this.valorVenta.set(valorVenta);
    this.margenPotencial.set(valorVenta - valorCosto);
    this.totalProductosValorizables.set(valorizables.length);
    this.sinExistencia.set(sinExistencia);
    this.stockBajo.set(stockBajo);
    this.sobreStock.set(sobreStock);

    this.porCategoria.set(
      Array.from(valorPorCategoria.entries())
        .map(([id, v], i) => ({ id, nombre: v.nombre, valor: v.valor, pct: valorCosto > 0 ? (v.valor / valorCosto) * 100 : 0, color: colorPaleta(i) }))
        .sort((a, b) => b.valor - a.valor),
    );

    const costoPorProducto = new Map(valorizables.map((p) => [p.id, p.costo]));
    const valorPorBodega = new Map<number, number>();
    let asignado = 0;
    for (const e of this.existenciasBodegaLocal) {
      const costo = costoPorProducto.get(e.productoId);
      if (costo === undefined) continue;
      const valor = e.existencia * costo;
      valorPorBodega.set(e.bodegaId, (valorPorBodega.get(e.bodegaId) ?? 0) + valor);
      asignado += valor;
    }
    const sinAsignar = Math.max(0, valorCosto - asignado);
    const filasBodega: ValorBodega[] = Array.from(valorPorBodega.entries()).map(([id, valor], i) => ({
      id,
      nombre: nombreBodega(id),
      valor,
      pct: valorCosto > 0 ? (valor / valorCosto) * 100 : 0,
      color: colorPaleta(i),
    }));
    if (sinAsignar > 0) {
      filasBodega.push({ id: null, nombre: 'Sin bodega asignada', valor: sinAsignar, pct: valorCosto > 0 ? (sinAsignar / valorCosto) * 100 : 0, color: 'var(--ink-soft)' });
    }
    this.porBodega.set(filasBodega.sort((a, b) => b.valor - a.valor));
  }

  // ───────────────────────── Pestaña Productos ─────────────────────────────

  /** Solo actualiza el texto; la búsqueda ya no se dispara sola al teclear
   *  (antes tenía debounce de 300ms) — ahora espera al botón "Buscar" (o
   *  Enter en el campo), para no mandar una petición por cada letra. */
  protected onBusquedaProductosInput(texto: string): void {
    this.busquedaProductos.set(texto);
  }

  protected cambiarFiltroProductos(): void {
    this.busquedaProductosRealizada.set(true);
    this.paginaActualProductos.set(1);
    this.cargarProductos();
  }

  protected cambiarOrdenProductos(orden: OrdenProductos): void {
    if (this.ordenProductos() === orden) {
      this.direccionProductos.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.ordenProductos.set(orden);
      this.direccionProductos.set('asc');
    }
    this.cambiarFiltroProductos();
  }

  protected irAPaginaAnteriorProductos(): void {
    if (this.paginaActualProductos() <= 1) return;
    this.paginaActualProductos.update((p) => p - 1);
    this.cargarProductos();
  }

  protected irAPaginaSiguienteProductos(): void {
    if (this.paginaActualProductos() >= this.totalPaginasProductos()) return;
    this.paginaActualProductos.update((p) => p + 1);
    this.cargarProductos();
  }

  private async cargarProductos(): Promise<void> {
    this.cargandoProductos.set(true);
    const miSecuencia = ++this.secuenciaProductos;
    const filas = this.esSupabase ? await this.cargarProductosSupabase() : await this.cargarProductosLocal();
    if (miSecuencia !== this.secuenciaProductos) return; // llegó una respuesta vieja, se descarta
    this.productosPagina.set(filas.filas);
    this.totalProductosFiltrados.set(filas.total);
    this.cargandoProductos.set(false);
  }

  private async cargarProductosSupabase(): Promise<{ filas: FilaProductoValor[]; total: number }> {
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActualProductos() - 1) * tamanio;
    const { data, error } = await this.sb!.schema('inventario').rpc('fn_valor_stock_productos', {
      p_busqueda: this.busquedaProductos().trim() || null,
      p_categoria_id: this.categoriaIdFiltro() || null,
      p_bodega_id: this.bodegaIdFiltro() || null,
      p_estado: this.estadoFiltro() || null,
      p_orden: this.ordenProductos(),
      p_direccion: this.direccionProductos(),
      p_desde: desde,
      p_cantidad: tamanio,
    });
    if (error) return { filas: [], total: 0 };
    const filas = (data ?? []) as Record<string, unknown>[];
    return {
      filas: filas.map((f) => this.mapearFilaProducto(f)),
      total: Number(filas[0]?.['total'] ?? 0),
    };
  }

  private mapearFilaProducto(f: Record<string, unknown>): FilaProductoValor {
    return {
      productoId: Number(f['producto_id']),
      codigo: String(f['codigo'] ?? ''),
      nombre: String(f['nombre'] ?? ''),
      categoriaId: Number(f['categoria_id']),
      categoriaNombre: String(f['categoria_nombre'] ?? ''),
      existencia: Number(f['existencia']) || 0,
      costo: Number(f['costo']) || 0,
      valor: Number(f['valor']) || 0,
      stockBajo: Boolean(f['stock_bajo']),
      sobreStock: Boolean(f['sobre_stock']),
    };
  }

  /** Filtra/ordena TODOS los productos valorizables en memoria — sin
   *  paginar. Única fuente de la lógica de filtrado en modo IndexedDB:
   *  cargarProductosLocal() le aplica el slice() de la página actual,
   *  cargarProductosLocalCompleto() (export) la usa tal cual. */
  private filasProductosLocalFiltradas(): FilaProductoValor[] {
    const nombreCategoria = (id: number) => this.categorias().find((c) => c.id === id)?.nombre ?? '—';
    const texto = this.busquedaProductos().trim().toLowerCase();
    const categoriaId = this.categoriaIdFiltro();
    const bodegaId = this.bodegaIdFiltro();
    const estado = this.estadoFiltro();

    let todas: FilaProductoValor[] = this.productosValorizablesLocal().map((p) => {
      const existencia = existenciaTotal(p, this.existenciasBodegaLocal);
      return {
        productoId: p.id,
        codigo: p.codigo ?? '',
        nombre: p.nombre,
        categoriaId: p.categoriaProductoId,
        categoriaNombre: nombreCategoria(p.categoriaProductoId),
        existencia,
        costo: p.costo,
        valor: existencia * p.costo,
        stockBajo: alertasStockBajo(p, this.existenciasBodegaLocal, this.nivelesMinimoBodegaLocal).length > 0,
        sobreStock: haySobreStock(p, this.existenciasBodegaLocal),
      };
    });

    if (texto) todas = todas.filter((f) => f.nombre.toLowerCase().includes(texto) || f.codigo.toLowerCase().includes(texto));
    if (categoriaId) todas = todas.filter((f) => f.categoriaId === categoriaId);
    if (bodegaId) {
      const idsEnBodega = new Set(this.existenciasBodegaLocal.filter((e) => e.bodegaId === bodegaId).map((e) => e.productoId));
      todas = todas.filter((f) => idsEnBodega.has(f.productoId));
    }
    if (estado === 'sin_existencia') todas = todas.filter((f) => f.existencia === 0);
    else if (estado === 'stock_bajo') todas = todas.filter((f) => f.stockBajo);
    else if (estado === 'sobre_stock') todas = todas.filter((f) => f.sobreStock);

    const orden = this.ordenProductos();
    const dir = this.direccionProductos() === 'desc' ? -1 : 1;
    const clave = (f: FilaProductoValor): string | number => (orden === 'nombre' ? f.nombre : orden === 'codigo' ? f.codigo : f[orden]);
    todas.sort((a, b) => {
      const va = clave(a);
      const vb = clave(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return a.productoId - b.productoId;
    });
    return todas;
  }

  private async cargarProductosLocal(): Promise<{ filas: FilaProductoValor[]; total: number }> {
    await this.cargarBaseLocal();
    const todas = this.filasProductosLocalFiltradas();
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActualProductos() - 1) * tamanio;
    return { filas: todas.slice(desde, desde + tamanio), total: todas.length };
  }

  // ───────────────────────── Pestaña Rotación ──────────────────────────────

  protected cambiarUmbralDias(valor: number): void {
    this.umbralDias.set(Math.max(1, Math.floor(valor) || 1));
    this.paginaActualRotacion.set(1);
    this.cargarRotacion();
  }

  protected irAPaginaAnteriorRotacion(): void {
    if (this.paginaActualRotacion() <= 1) return;
    this.paginaActualRotacion.update((p) => p - 1);
    this.cargarRotacion();
  }

  protected irAPaginaSiguienteRotacion(): void {
    if (this.paginaActualRotacion() >= this.totalPaginasRotacion()) return;
    this.paginaActualRotacion.update((p) => p + 1);
    this.cargarRotacion();
  }

  private async cargarRotacion(): Promise<void> {
    this.cargandoRotacion.set(true);
    const miSecuencia = ++this.secuenciaRotacion;
    const resultado = this.esSupabase ? await this.cargarRotacionSupabase() : await this.cargarRotacionLocal();
    if (miSecuencia !== this.secuenciaRotacion) return;
    this.rotacionPagina.set(resultado.filas);
    this.totalRotacionFiltrada.set(resultado.total);
    this.cargandoRotacion.set(false);
  }

  private async cargarRotacionSupabase(): Promise<{ filas: FilaRotacion[]; total: number }> {
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActualRotacion() - 1) * tamanio;
    const { data, error } = await this.sb!.schema('inventario').rpc('fn_valor_stock_rotacion', {
      p_umbral_dias: this.umbralDias(),
      p_desde: desde,
      p_cantidad: tamanio,
    });
    if (error) return { filas: [], total: 0 };
    const filas = (data ?? []) as Record<string, unknown>[];
    return {
      filas: filas.map((f) => ({
        productoId: Number(f['producto_id']),
        codigo: String(f['codigo'] ?? ''),
        nombre: String(f['nombre'] ?? ''),
        existencia: Number(f['existencia']) || 0,
        ultimoMovimiento: (f['ultimo_movimiento'] as string | null) ?? null,
        diasSinMovimiento: f['dias_sin_movimiento'] === null ? null : Number(f['dias_sin_movimiento']),
      })),
      total: Number(filas[0]?.['total'] ?? 0),
    };
  }

  private async cargarRotacionLocal(): Promise<{ filas: FilaRotacion[]; total: number }> {
    await this.cargarBaseLocal();
    if (this.movimientosLocal === null) {
      const idsValorizables = this.productosValorizablesLocal().map((p) => p.id);
      this.movimientosLocal = idsValorizables.length
        ? await firstValueFrom(this.data.list<MovimientoInventario>('MovimientoInventario', { productoId: idsValorizables }))
        : [];
    }
    const ahora = Date.now();
    const todas: FilaRotacion[] = this.productosValorizablesLocal()
      .map((p) => {
        const propios = this.movimientosLocal!.filter((m) => m.productoId === p.id);
        const ultimoMovimiento = propios.length > 0 ? propios.reduce((max, m) => (m.fecha > max ? m.fecha : max), propios[0].fecha) : null;
        const diasSinMovimiento = ultimoMovimiento ? Math.floor((ahora - new Date(ultimoMovimiento).getTime()) / 86400000) : null;
        return {
          productoId: p.id,
          codigo: p.codigo ?? '',
          nombre: p.nombre,
          existencia: existenciaTotal(p, this.existenciasBodegaLocal),
          ultimoMovimiento,
          diasSinMovimiento,
        };
      })
      .filter((f) => f.diasSinMovimiento === null || f.diasSinMovimiento >= this.umbralDias())
      .sort((a, b) => (b.diasSinMovimiento ?? Infinity) - (a.diasSinMovimiento ?? Infinity));

    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActualRotacion() - 1) * tamanio;
    return { filas: todas.slice(desde, desde + tamanio), total: todas.length };
  }

  // ───────────────────────── Exportar ──────────────────────────────────────

  private etiquetaAlerta(fila: FilaProductoValor): string {
    if (fila.existencia === 0) return 'Sin existencia';
    if (fila.stockBajo) return 'Stock bajo';
    if (fila.sobreStock) return 'Sobre-stock';
    return '';
  }

  /** CSV respeta los filtros/orden actuales de la pestaña Productos. En modo
   *  Supabase nunca descarga todo el catálogo a la vez: pide páginas de
   *  TAMANO_LOTE_EXPORTAR en secuencia hasta agotar el total filtrado (igual
   *  de ligero sea cual sea el tamaño real de la empresa, porque el filtro
   *  ya acotó qué tan grande es el export). */
  async exportarCsvProductos(): Promise<void> {
    const columnas = [
      { clave: 'codigo' as const, etiqueta: 'Código' },
      { clave: 'nombre' as const, etiqueta: 'Nombre' },
      { clave: 'categoriaNombre' as const, etiqueta: 'Categoría' },
      { clave: 'existencia' as const, etiqueta: 'Existencia' },
      { clave: 'costo' as const, etiqueta: 'Costo' },
      { clave: 'valor' as const, etiqueta: 'Valor' },
      { clave: 'alerta' as const, etiqueta: 'Alerta' },
    ];

    if (!this.esSupabase) {
      await this.cargarBaseLocal();
      const { filas } = await this.cargarProductosLocalCompleto();
      exportarCsv('valor_stock.csv', columnas, filas.map((f) => ({ ...f, alerta: this.etiquetaAlerta(f) })));
      return;
    }

    const todas: Record<string, unknown>[] = [];
    let desde = 0;
    let total = Infinity;
    while (desde < total) {
      const { data, error } = await this.sb!.schema('inventario').rpc('fn_valor_stock_productos', {
        p_busqueda: this.busquedaProductos().trim() || null,
        p_categoria_id: this.categoriaIdFiltro() || null,
        p_bodega_id: this.bodegaIdFiltro() || null,
        p_estado: this.estadoFiltro() || null,
        p_orden: this.ordenProductos(),
        p_direccion: this.direccionProductos(),
        p_desde: desde,
        p_cantidad: TAMANO_LOTE_EXPORTAR,
      });
      if (error) break;
      const filas = (data ?? []) as Record<string, unknown>[];
      if (filas.length === 0) break;
      total = Number(filas[0]?.['total'] ?? 0);
      for (const f of filas) {
        const fila = this.mapearFilaProducto(f);
        todas.push({ ...fila, alerta: this.etiquetaAlerta(fila) });
      }
      desde += TAMANO_LOTE_EXPORTAR;
    }
    exportarCsv('valor_stock.csv', columnas, todas);
  }

  /** Igual que filasProductosLocalFiltradas() pero async (carga la base local
   *  si todavía no está en caché) — usado solo para export en modo
   *  IndexedDB, donde no hay de otra (ya está todo en memoria, nunca a
   *  escala real de 200k). */
  private async cargarProductosLocalCompleto(): Promise<{ filas: FilaProductoValor[] }> {
    await this.cargarBaseLocal();
    return { filas: this.filasProductosLocalFiltradas() };
  }

  /** PDF = reporte ejecutivo (requerimiento 11): totales + desglose por
   *  categoría/bodega + filtros aplicados + un listado acotado a
   *  TOPE_FILAS_PDF — nunca un volcado del catálogo completo (eso es lo que
   *  es el CSV). */
  async exportarPdfProductos(): Promise<void> {
    const filtrosTexto: string[] = [];
    if (this.busquedaProductos().trim()) filtrosTexto.push(`búsqueda "${this.busquedaProductos().trim()}"`);
    if (this.categoriaIdFiltro()) filtrosTexto.push(`categoría "${this.categorias().find((c) => c.id === this.categoriaIdFiltro())?.nombre ?? ''}"`);
    if (this.bodegaIdFiltro()) filtrosTexto.push(`bodega "${this.bodegas().find((b) => b.id === this.bodegaIdFiltro())?.nombre ?? ''}"`);
    if (this.estadoFiltro()) filtrosTexto.push(`estado "${this.estadoFiltro()}"`);
    const subtitulo =
      `Valor total: ${formatMoneda(this.valorInventario())} · ${this.totalProductosValorizables()} producto(s)` +
      (filtrosTexto.length ? ` · Filtros: ${filtrosTexto.join(', ')}` : '');

    let filasListado: FilaProductoValor[];
    let totalFiltrado: number;
    if (this.esSupabase) {
      const { data, error } = await this.sb!.schema('inventario').rpc('fn_valor_stock_productos', {
        p_busqueda: this.busquedaProductos().trim() || null,
        p_categoria_id: this.categoriaIdFiltro() || null,
        p_bodega_id: this.bodegaIdFiltro() || null,
        p_estado: this.estadoFiltro() || null,
        p_orden: this.ordenProductos(),
        p_direccion: this.direccionProductos(),
        p_desde: 0,
        p_cantidad: TOPE_FILAS_PDF,
      });
      const filas = !error ? ((data ?? []) as Record<string, unknown>[]) : [];
      filasListado = filas.map((f) => this.mapearFilaProducto(f));
      totalFiltrado = Number(filas[0]?.['total'] ?? filasListado.length);
    } else {
      const { filas } = await this.cargarProductosLocalCompleto();
      totalFiltrado = filas.length;
      filasListado = filas.slice(0, TOPE_FILAS_PDF);
    }

    const notaListado =
      totalFiltrado > filasListado.length
        ? `Mostrando los primeros ${filasListado.length} de ${totalFiltrado} productos filtrados (exporta CSV para el detalle completo).`
        : undefined;

    exportarTablaPdf({
      nombreArchivo: 'valor_stock.pdf',
      titulo: 'Valor de stock',
      subtitulo,
      columnas: [
        { etiqueta: 'Código', ancho: 26 },
        { etiqueta: 'Nombre' },
        { etiqueta: 'Categoría', ancho: 36 },
        { etiqueta: 'Existencia', ancho: 24 },
        { etiqueta: 'Costo', ancho: 26 },
        { etiqueta: 'Valor', ancho: 26 },
        { etiqueta: 'Alerta', ancho: 28 },
      ],
      filas: [
        ...(notaListado ? [[notaListado, '', '', '', '', '', '']] : []),
        ...filasListado.map((f) => [
          f.codigo || '—',
          f.nombre,
          f.categoriaNombre,
          String(f.existencia),
          formatMoneda(f.costo),
          formatMoneda(f.valor),
          this.etiquetaAlerta(f),
        ]),
      ],
    });
  }
}

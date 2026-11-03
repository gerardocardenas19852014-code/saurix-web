import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe, DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { SelectBuscableComponent, OpcionBuscable } from '../../../shared/components/select-buscable/select-buscable.component';
import { formatMoneda } from '../productos/producto.util';
import { CategoriaProducto } from '../categorias-producto/categoria-producto.model';
import { Bodega } from '../bodegas/bodega.model';
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
 * inventario: TODO el filtrado, orden, paginación y agregación ocurre en
 * Postgres (funciones inventario.fn_valor_stock_* — ver
 * supabase/migrations/48 a 52); Angular nunca recibe más que una tarjeta
 * resumen, un desglose por categoría/bodega (unas pocas filas) o UNA página
 * (25-50 filas) a la vez. Las tres secciones (tarjetas+Resumen, Productos,
 * Rotación) cargan de forma independiente: tarjetas+Resumen al entrar a la
 * pantalla, Productos y Rotación solo la primera vez que se visita esa
 * pestaña (ver seleccionarTab()), cada una con su propio estado de carga —
 * cambiar de pestaña nunca vuelve a pedir lo que ya se cargó, solo cambiar
 * un filtro, de página o de orden dispara una nueva petición (acotada a esa
 * sección).
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

  private readonly sb = inject(SupabaseService).cliente;

  // ── Catálogos chicos (categorías/bodegas) — siempre completos: nunca son
  // el problema de escala (decenas de filas cuando mucho), así que no
  // tienen su propio RPC, se reutiliza DataClientService.list().
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

  // ───────────────────────── Tarjetas + Resumen ────────────────────────────

  private async cargarResumen(): Promise<void> {
    this.cargandoResumen.set(true);
    await this.cargarResumenSupabase();
    this.cargandoResumen.set(false);
  }

  private async cargarResumenSupabase(): Promise<void> {
    const sb = this.sb.schema('inventario');
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
    const filas = await this.cargarProductosSupabase();
    if (miSecuencia !== this.secuenciaProductos) return; // llegó una respuesta vieja, se descarta
    this.productosPagina.set(filas.filas);
    this.totalProductosFiltrados.set(filas.total);
    this.cargandoProductos.set(false);
  }

  private async cargarProductosSupabase(): Promise<{ filas: FilaProductoValor[]; total: number }> {
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActualProductos() - 1) * tamanio;
    const { data, error } = await this.sb.schema('inventario').rpc('fn_valor_stock_productos', {
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
    const resultado = await this.cargarRotacionSupabase();
    if (miSecuencia !== this.secuenciaRotacion) return;
    this.rotacionPagina.set(resultado.filas);
    this.totalRotacionFiltrada.set(resultado.total);
    this.cargandoRotacion.set(false);
  }

  private async cargarRotacionSupabase(): Promise<{ filas: FilaRotacion[]; total: number }> {
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActualRotacion() - 1) * tamanio;
    const { data, error } = await this.sb.schema('inventario').rpc('fn_valor_stock_rotacion', {
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

    const todas: Record<string, unknown>[] = [];
    let desde = 0;
    let total = Infinity;
    while (desde < total) {
      const { data, error } = await this.sb.schema('inventario').rpc('fn_valor_stock_productos', {
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

    const { data, error } = await this.sb.schema('inventario').rpc('fn_valor_stock_productos', {
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
    const filasListado = filas.map((f) => this.mapearFilaProducto(f));
    const totalFiltrado = Number(filas[0]?.['total'] ?? filasListado.length);

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

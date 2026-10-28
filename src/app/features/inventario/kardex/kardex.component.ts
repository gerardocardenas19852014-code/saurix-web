import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { fuenteDatosActual } from '../../../core/services/fuente-datos';
import { SelectBuscableComponent, OpcionBuscable } from '../../../shared/components/select-buscable/select-buscable.component';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { ToastService } from '../../../shared/services/toast.service';
import { Producto } from '../productos/producto.model';
import { Bodega } from '../bodegas/bodega.model';
import { ExistenciaBodega } from '../movimientos-bodega/existencia-bodega.model';
import { MovimientoInventario } from '../movimientos-bodega/movimiento-inventario.model';
import { exportarCsv } from '../../../shared/utils/csv.util';
import { exportarTablaPdf } from '../../../shared/utils/pdf-tabla.util';

type TipoMovimiento = 'entrada' | 'traspaso' | 'salida';

interface FilaKardex {
  id: number;
  fecha: string;
  tipo: TipoMovimiento;
  origenNombre: string | null;
  destinoNombre: string | null;
  cantidad: number;
  /** + o - según se suma o resta al saldo que se está mostrando (total del
   *  producto, o de una bodega concreta si hay filtro — ver filtroBodegaId). */
  delta: number;
  /** Acumulado después de este movimiento, en el orden cronológico real —
   *  ver fn_kardex_listar(): SIEMPRE se calcula sobre el historial
   *  cronológico completo del producto (nunca solo sobre la página visible
   *  ni se ve afectado por el filtro de Tipo/Desde/Hasta), para que el
   *  Saldo mostrado sea matemáticamente correcto sin importar qué página o
   *  filtro se esté viendo. */
  saldo: number;
  nota: string | null;
}

/** Ver movimientos-bodega.component.ts → exportarCsvHistorial()/
 *  exportarPdfHistorial() — mismo criterio aquí: CSV nunca descarga todo el
 *  historial de un jalón (pide páginas de este tamaño en secuencia hasta
 *  agotar el total filtrado); PDF es un reporte acotado (no un volcado
 *  completo). */
const TAMANO_LOTE_EXPORTAR = 2000;
const TOPE_FILAS_PDF = 200;

/**
 * "Estado de cuenta" de un producto: todos sus movimientos (entradas,
 * traspasos, salidas/ajustes — incluye recepciones de Órdenes de compra y
 * ajustes de Conteo físico, porque TODOS pasan por
 * MovimientoInventarioService.registrar(), ver ese archivo) en orden
 * cronológico con saldo acumulado.
 *
 * Homologación 28-oct-2026: antes esta pantalla cargaba TODO el catálogo de
 * productos/bodegas/existencias/movimientos de la empresa completa al
 * entrar, sin importar qué producto se fuera a ver — inviable con
 * 200,000+ productos y cientos de miles de movimientos por producto. Ahora
 * (modo Supabase):
 *  - El selector de Producto es un autocomplete remoto con debounce (ver
 *    buscarProductosRemoto() y el modo remoto de SelectBuscableComponent,
 *    mismo patrón ya usado en Movimientos entre bodegas → Historial →
 *    Producto) — nunca descarga el catálogo completo.
 *  - Nada de Kardex se consulta hasta elegir un producto (ver elegirProducto()).
 *  - Bodega/Tipo de movimiento/Desde/Hasta quedan en memoria hasta
 *    presionar "🔍 Buscar" (cambiarFiltro()) — igual que Órdenes de compra/
 *    Productos y servicios: ningún filtro dispara una consulta por sí solo.
 *  - El listado se pide paginado contra fn_kardex_listar() (OFFSET/LIMIT,
 *    mismo tamaño de página que el resto de Saurix vía PreferenciasGridService):
 *    un producto con 185,430 movimientos nunca manda más de una página a la
 *    vez. El Saldo de cada fila se calcula en PostgreSQL con una suma de
 *    ventana sobre el historial CRONOLÓGICO COMPLETO del producto (no sobre
 *    la página visible), así que es correcto sin importar la página o los
 *    filtros de Tipo/Desde/Hasta activos — ver el comentario de la función.
 *  - "Movimientos registrados" muestra el total YA FILTRADO (el mismo
 *    `total` que trae la página, de count(*) over() en fn_kardex_listar) —
 *    así refleja los filtros activos, igual que pide el diseño.
 *  - Existencia actual se lee de fn_kardex_resumen(), que a su vez solo lee
 *    ExistenciaBodega/Producto.existencia (la MISMA fuente de verdad que
 *    existenciaTotal() en producto.util.ts) — nunca se deriva sumando el
 *    historial de movimientos, para no modificar ninguna regla contable
 *    existente. Solo se ve afectada por el filtro de Bodega (no por
 *    Tipo/Desde/Hasta), así que solo se vuelve a pedir junto con el
 *    listado al elegir producto o presionar "Buscar" — no en cada cambio
 *    de página.
 *  - Exportar CSV/PDF respeta los filtros activos y nunca depende de lo que
 *    ya esté cargado en Angular — ver exportarCsv()/exportarPdf() más abajo.
 *
 * Modo IndexedDB local (catálogos de prueba, chicos): se mantiene el cálculo
 * en memoria de siempre, cargado una sola vez bajo demanda
 * (cargarBaseLocal()) — a esa escala nunca es un problema real de
 * rendimiento, pero ahora sí respeta los mismos filtros/paginación que el
 * modo Supabase para que el comportamiento visual sea idéntico en ambos.
 */
@Component({
  selector: 'app-kardex',
  standalone: true,
  imports: [SelectBuscableComponent, DatePipe],
  templateUrl: './kardex.component.html',
  styleUrl: './kardex.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KardexComponent implements OnInit, OnDestroy {
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);

  private readonly esSupabase = fuenteDatosActual() === 'supabase';
  private readonly sb = this.esSupabase ? inject(SupabaseService).cliente : null;

  // ── Catálogo de bodegas (chico, siempre completo en ambos modos — igual
  // que en Movimientos entre bodegas/Órdenes de compra) ───────────────────
  protected readonly bodegas = signal<Bodega[]>([]);
  protected readonly bodegasActivas = computed(() => this.bodegas().filter((b) => b.activo !== false));
  private nombreBodega(id: number | null): string | null {
    if (id === null) return null;
    return this.bodegas().find((b) => b.id === id)?.nombre ?? '—';
  }

  // ── Producto elegido — nunca se carga el catálogo completo (ver
  // buscarProductosRemoto()); el nombre/código se guardan aparte porque el
  // propio SelectBuscableComponent en modo remoto no expone la opción
  // completa al elegir, solo el id (ver catalogoAutocomplete). ────────────
  protected readonly productoId = signal(0);
  protected readonly productoNombre = signal('');
  protected readonly productoCodigo = signal('');
  private readonly catalogoAutocomplete = new Map<number, { codigo: string; nombre: string }>();

  // ── Filtros — igual que Órdenes de compra: son los mismos signals que
  // lee la consulta, pero NINGUNO dispara una consulta por sí solo; solo
  // cambiarFiltro() (botón "🔍 Buscar") o elegir un producto nuevo. ───────
  protected readonly filtroBodegaId = signal(0);
  protected readonly filtroTipo = signal<'' | TipoMovimiento>('');
  protected readonly filtroDesde = signal('');
  protected readonly filtroHasta = signal('');
  protected readonly paginaActual = signal(1);

  protected readonly totalPaginas = computed(() =>
    Math.max(1, Math.ceil(this.totalFilasFiltradas() / this.tamanioPagina())),
  );

  // ── Resultado de la última consulta — ver cargarResumen()/cargarListado() ─
  protected readonly cargandoResumen = signal(false);
  protected readonly cargandoListado = signal(false);
  protected readonly existenciaActual = signal(0);
  protected readonly filasListado = signal<FilaKardex[]>([]);
  protected readonly totalFilasFiltradas = signal(0);

  // Protección contra respuestas fuera de orden (ver
  // MovimientosBodegaComponent.secuenciaHistorial/
  // OrdenesCompraComponent.secuenciaListado): si el usuario elige Producto A
  // y luego, antes de que responda, elige Producto B, la respuesta de A
  // (si llega después) nunca debe pisar los datos de B.
  private secuenciaResumen = 0;
  private secuenciaListado = 0;

  ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid'); // ancho completo
    this.cargarBodegas();
  }

  private cargarBodegas(): void {
    if (this.esSupabase) {
      firstValueFrom(this.data.list<Bodega>('Bodega')).then((bodegas) => this.bodegas.set(bodegas));
    } else {
      this.cargarBaseLocal().then(() => this.bodegas.set(this.bodegasLocal));
    }
  }

  /** Autocomplete remoto de Producto (ver comentario de clase) — referencia
   *  estable de clase para pasarla como [busquedaRemota] sin recrearla en
   *  cada detección de cambios. Guarda cada resultado en
   *  catalogoAutocomplete para que elegirProducto() pueda resolver el
   *  nombre/código sin otra consulta. */
  protected readonly buscarProductosRemoto = async (texto: string): Promise<OpcionBuscable[]> => {
    const limite = 15;
    if (this.esSupabase) {
      const { data, error } = await this.sb!.schema('inventario').rpc('fn_kardex_productos_autocomplete', {
        p_busqueda: texto || null,
        p_limite: limite,
      });
      if (error) return [];
      const filas = (data ?? []) as Record<string, unknown>[];
      for (const f of filas) {
        this.catalogoAutocomplete.set(Number(f['id']), { codigo: String(f['codigo'] ?? ''), nombre: String(f['nombre']) });
      }
      return filas.map((f) => {
        const codigo = f['codigo'] ? String(f['codigo']) : null;
        const unidad = f['unidad_nombre'] ? String(f['unidad_nombre']) : null;
        const etiqueta = [codigo, String(f['nombre']), unidad].filter((p) => !!p).join(' — ');
        return { valor: Number(f['id']), etiqueta };
      });
    }
    await this.cargarBaseLocal();
    const termino = texto.trim().toLowerCase();
    const candidatos = this.productosLocal.filter((p) => p.activo && p.existencia !== null);
    const filtrados = termino
      ? candidatos.filter((p) => p.nombre.toLowerCase().includes(termino) || (p.codigo ?? '').toLowerCase().includes(termino))
      : candidatos;
    const unidadNombre = (id: number) => this.unidadesLocal.find((u) => u.id === id)?.nombre ?? null;
    for (const p of filtrados.slice(0, limite)) {
      this.catalogoAutocomplete.set(p.id, { codigo: p.codigo ?? '', nombre: p.nombre });
    }
    return filtrados.slice(0, limite).map((p) => {
      const etiqueta = [p.codigo || null, p.nombre, unidadNombre(p.unidadMedidaId)].filter((v) => !!v).join(' — ');
      return { valor: p.id, etiqueta };
    });
  };

  /** Elegir un producto nuevo reinicia todos los filtros/página — quedarse
   *  en, digamos, Bodega=Tienda del producto anterior casi nunca aplica al
   *  nuevo. Dispara resumen + primera página de inmediato (sin esperar a
   *  "Buscar"): "Elige un producto para ver su kardex" → estadísticas +
   *  primera página. */
  elegirProducto(productoId: number): void {
    this.productoId.set(productoId);
    const info = this.catalogoAutocomplete.get(productoId);
    this.productoNombre.set(info?.nombre ?? '');
    this.productoCodigo.set(info?.codigo ?? '');
    this.filtroBodegaId.set(0);
    this.filtroTipo.set('');
    this.filtroDesde.set('');
    this.filtroHasta.set('');
    this.paginaActual.set(1);
    this.cargarResumen();
    this.cargarListado();
  }

  /** Cualquier cambio de filtro vuelve a la página 1. Solo se llama desde el
   *  botón "🔍 Buscar" — ningún filtro dispara una consulta por sí solo. La
   *  Bodega SÍ afecta la Existencia actual, así que también recarga el
   *  resumen (Tipo/Desde/Hasta no lo afectan — ver fn_kardex_resumen()). */
  protected cambiarFiltro(): void {
    this.paginaActual.set(1);
    this.cargarResumen();
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

  private tamanioPagina(): number {
    return Math.max(1, this.preferenciasGrid.tamanoPagina());
  }

  /** Existencia actual (total o de la bodega filtrada) — ver
   *  fn_kardex_resumen(): lee ExistenciaBodega/Producto.existencia
   *  directamente, igual que existenciaTotal() en producto.util.ts, nunca
   *  derivada del historial de movimientos. */
  private async cargarResumen(): Promise<void> {
    const productoId = this.productoId();
    if (!productoId) return;
    this.cargandoResumen.set(true);
    const miSecuencia = ++this.secuenciaResumen;
    const bodegaId = this.filtroBodegaId() || null;
    const existencia = this.esSupabase
      ? await this.cargarResumenSupabase(productoId, bodegaId)
      : await this.cargarResumenLocal(productoId, bodegaId);
    if (miSecuencia !== this.secuenciaResumen) return; // respuesta vieja — descartar
    this.existenciaActual.set(existencia);
    this.cargandoResumen.set(false);
  }

  private async cargarResumenSupabase(productoId: number, bodegaId: number | null): Promise<number> {
    const { data, error } = await this.sb!.schema('inventario').rpc('fn_kardex_resumen', {
      p_producto_id: productoId,
      p_bodega_id: bodegaId,
    });
    if (error) {
      this.toast.error('No se pudo cargar la existencia actual: ' + error.message);
      return 0;
    }
    const fila = ((data ?? []) as Record<string, unknown>[])[0];
    return Number(fila?.['existencia_actual'] ?? 0);
  }

  private async cargarResumenLocal(productoId: number, bodegaId: number | null): Promise<number> {
    await this.cargarBaseLocal();
    if (bodegaId) {
      return this.existenciasBodegaLocal.find((e) => e.productoId === productoId && e.bodegaId === bodegaId)?.existencia ?? 0;
    }
    const propias = this.existenciasBodegaLocal.filter((e) => e.productoId === productoId);
    if (propias.length === 0) return this.productosLocal.find((p) => p.id === productoId)?.existencia ?? 0;
    return propias.reduce((acc, e) => acc + e.existencia, 0);
  }

  /** Página del Kardex, según paginaActual()/preferenciasGrid.tamanoPagina()
   *  — ver fn_kardex_listar(). */
  private async cargarListado(): Promise<void> {
    const productoId = this.productoId();
    if (!productoId) return;
    this.cargandoListado.set(true);
    const miSecuencia = ++this.secuenciaListado;
    const resultado = this.esSupabase
      ? await this.cargarListadoSupabase(productoId, null, null)
      : await this.cargarListadoLocal(productoId);
    if (miSecuencia !== this.secuenciaListado) return; // respuesta vieja — descartar
    // Si la página en la que estábamos quedó vacía (filtro nuevo con menos
    // páginas que la posición actual), retrocede a la última página real —
    // mismo criterio que ProductosComponent/OrdenesCompraComponent.
    if (resultado.filas.length === 0 && this.paginaActual() > 1 && resultado.total > 0) {
      this.paginaActual.set(Math.max(1, Math.ceil(resultado.total / this.tamanioPagina())));
      this.cargandoListado.set(false);
      await this.cargarListado();
      return;
    }
    this.filasListado.set(resultado.filas);
    this.totalFilasFiltradas.set(resultado.total);
    this.cargandoListado.set(false);
  }

  /** p_desde/p_cantidad explícitos (usados por exportarCsv()/exportarPdf()
   *  para pedir lotes grandes o acotados) — null en ambos usa la página y
   *  tamaño de página actuales (uso normal de la pantalla). */
  private async cargarListadoSupabase(
    productoId: number,
    desdeExplicito: number | null,
    cantidadExplicita: number | null,
  ): Promise<{ filas: FilaKardex[]; total: number }> {
    const tamanio = cantidadExplicita ?? this.tamanioPagina();
    const desde = desdeExplicito ?? (this.paginaActual() - 1) * tamanio;
    const { data, error } = await this.sb!.schema('inventario').rpc('fn_kardex_listar', {
      p_producto_id: productoId,
      p_bodega_id: this.filtroBodegaId() || null,
      p_tipo: this.filtroTipo() || null,
      p_desde_fecha: this.filtroDesde() || null,
      p_hasta_fecha: this.filtroHasta() || null,
      p_desde: desde,
      p_cantidad: tamanio,
    });
    if (error) {
      this.toast.error('No se pudo cargar el kardex: ' + error.message);
      return { filas: [], total: 0 };
    }
    const filas = (data ?? []) as Record<string, unknown>[];
    return {
      filas: filas.map((f) => this.mapearFilaSupabase(f)),
      total: Number(filas[0]?.['total'] ?? 0),
    };
  }

  private mapearFilaSupabase(f: Record<string, unknown>): FilaKardex {
    return {
      id: Number(f['id']),
      fecha: String(f['fecha']),
      tipo: f['tipo'] as TipoMovimiento,
      origenNombre: f['origen_nombre'] ? String(f['origen_nombre']) : null,
      destinoNombre: f['destino_nombre'] ? String(f['destino_nombre']) : null,
      cantidad: Number(f['cantidad']),
      delta: Number(f['delta']),
      saldo: Number(f['saldo']),
      nota: f['nota'] ? String(f['nota']) : null,
    };
  }

  /** Mismo cálculo de siempre en modo IndexedDB local (tipo/delta/saldo
   *  cronológico sobre TODO el historial del producto), filtrado por
   *  Bodega/Tipo/Desde/Hasta y YA en orden "más reciente primero" — sin
   *  paginar. Fuente única para la pantalla (cargarListadoLocal() pagina un
   *  slice) y para exportar (CSV/PDF toman esta misma lista completa). */
  private calcularFilasLocalFiltradas(productoId: number): FilaKardex[] {
    const bodegaFiltroId = this.filtroBodegaId();
    const propios = this.movimientosLocal
      .filter((m) => m.productoId === productoId)
      .filter((m) => !bodegaFiltroId || m.bodegaOrigenId === bodegaFiltroId || m.bodegaDestinoId === bodegaFiltroId)
      .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id);

    let saldo = 0;
    const todas: FilaKardex[] = [];
    for (const m of propios) {
      const tipo: TipoMovimiento = m.bodegaOrigenId === null ? 'entrada' : m.bodegaDestinoId === null ? 'salida' : 'traspaso';
      let delta: number;
      if (!bodegaFiltroId) {
        delta = m.bodegaOrigenId === null ? m.cantidad : m.bodegaDestinoId === null ? -m.cantidad : 0;
      } else {
        const entra = m.bodegaDestinoId === bodegaFiltroId;
        const sale = m.bodegaOrigenId === bodegaFiltroId;
        delta = entra ? m.cantidad : sale ? -m.cantidad : 0;
      }
      saldo += delta;
      todas.push({
        id: m.id,
        fecha: m.fecha,
        tipo,
        origenNombre: this.nombreBodega(m.bodegaOrigenId),
        destinoNombre: this.nombreBodega(m.bodegaDestinoId),
        cantidad: m.cantidad,
        delta,
        saldo,
        nota: m.nota,
      });
    }

    const tipoFiltro = this.filtroTipo();
    const desde = this.filtroDesde();
    const hasta = this.filtroHasta();
    return todas
      .filter((f) => !tipoFiltro || f.tipo === tipoFiltro)
      .filter((f) => !desde || f.fecha.slice(0, 10) >= desde)
      .filter((f) => !hasta || f.fecha.slice(0, 10) <= hasta)
      .reverse(); // más reciente primero, aunque el cálculo fue cronológico
  }

  /** Modo IndexedDB local — respeta Bodega/Tipo/Desde/Hasta y pagina en
   *  memoria, para que el comportamiento sea idéntico al modo Supabase. Sin
   *  problema de escala real a este tamaño de catálogo. */
  private async cargarListadoLocal(productoId: number): Promise<{ filas: FilaKardex[]; total: number }> {
    await this.cargarBaseLocal();
    const filtradas = this.calcularFilasLocalFiltradas(productoId);
    const tamanio = this.tamanioPagina();
    const inicioPagina = (this.paginaActual() - 1) * tamanio;
    return { filas: filtradas.slice(inicioPagina, inicioPagina + tamanio), total: filtradas.length };
  }

  private nombreTipo(tipo: TipoMovimiento): string {
    return tipo === 'entrada' ? 'Entrada' : tipo === 'salida' ? 'Salida/Ajuste' : 'Traspaso';
  }

  private nombreArchivoBase(): string {
    return `kardex_${(this.productoNombre() || 'producto').replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`;
  }

  private filaParaExportar(f: FilaKardex): Record<string, unknown> {
    return {
      fecha: f.fecha,
      tipo: this.nombreTipo(f.tipo),
      origenNombre: f.origenNombre ?? '',
      destinoNombre: f.destinoNombre ?? '',
      cantidad: f.cantidad,
      delta: f.delta,
      saldo: f.saldo,
      nota: f.nota ?? '',
    };
  }

  private readonly columnasCsv = [
    { clave: 'fecha' as const, etiqueta: 'Fecha' },
    { clave: 'tipo' as const, etiqueta: 'Tipo' },
    { clave: 'origenNombre' as const, etiqueta: 'Origen' },
    { clave: 'destinoNombre' as const, etiqueta: 'Destino' },
    { clave: 'cantidad' as const, etiqueta: 'Cantidad' },
    { clave: 'delta' as const, etiqueta: 'Movimiento' },
    { clave: 'saldo' as const, etiqueta: 'Saldo' },
    { clave: 'nota' as const, etiqueta: 'Nota' },
  ];

  /** CSV respeta los filtros activos y NUNCA depende de lo que ya esté
   *  cargado en Angular: en modo Supabase pide páginas de
   *  TAMANO_LOTE_EXPORTAR en secuencia hasta agotar el total filtrado (igual
   *  que MovimientosBodegaComponent.exportarCsvHistorial()) — un producto
   *  con 50,000 movimientos filtrados nunca se descarga de un jalón más
   *  grande que ese lote, y la UI no se bloquea entre lotes (await dentro
   *  del ciclo, nunca Promise.all). */
  async exportarCsv(): Promise<void> {
    const productoId = this.productoId();
    if (!productoId) return;

    if (!this.esSupabase) {
      await this.cargarBaseLocal();
      const todas = this.calcularFilasLocalFiltradas(productoId);
      exportarCsv(`${this.nombreArchivoBase()}.csv`, this.columnasCsv, todas.map((f) => this.filaParaExportar(f)));
      return;
    }

    const todas: Record<string, unknown>[] = [];
    let desde = 0;
    let total = Infinity;
    while (desde < total) {
      const { filas, total: totalRespuesta } = await this.cargarListadoSupabase(productoId, desde, TAMANO_LOTE_EXPORTAR);
      if (filas.length === 0) break;
      total = totalRespuesta;
      for (const f of filas) todas.push(this.filaParaExportar(f));
      desde += TAMANO_LOTE_EXPORTAR;
    }
    exportarCsv(`${this.nombreArchivoBase()}.csv`, this.columnasCsv, todas);
  }

  /** PDF acotado a TOPE_FILAS_PDF (reporte, no un volcado completo) — mismo
   *  criterio que MovimientosBodegaComponent.exportarPdfHistorial()/
   *  ValorStockComponent.exportarPdfProductos(). */
  async exportarPdf(): Promise<void> {
    const productoId = this.productoId();
    if (!productoId) return;

    let filasListado: FilaKardex[];
    let totalFiltrado: number;
    if (this.esSupabase) {
      const resultado = await this.cargarListadoSupabase(productoId, 0, TOPE_FILAS_PDF);
      filasListado = resultado.filas;
      totalFiltrado = resultado.total;
    } else {
      await this.cargarBaseLocal();
      const todas = this.calcularFilasLocalFiltradas(productoId);
      totalFiltrado = todas.length;
      filasListado = todas.slice(0, TOPE_FILAS_PDF);
    }

    const bodega = this.bodegas().find((b) => b.id === this.filtroBodegaId());
    const notaListado =
      totalFiltrado > filasListado.length
        ? `Mostrando los primeros ${filasListado.length} de ${totalFiltrado} movimientos filtrados (exporta CSV para el detalle completo).`
        : undefined;

    exportarTablaPdf({
      nombreArchivo: `${this.nombreArchivoBase()}.pdf`,
      titulo: `Kardex — ${this.productoCodigo() ? this.productoCodigo() + ' — ' : ''}${this.productoNombre()}`,
      subtitulo: bodega ? `Bodega: ${bodega.nombre}` : 'Todas las bodegas (saldo total)',
      columnas: [
        { etiqueta: 'Fecha', ancho: 28 },
        { etiqueta: 'Tipo', ancho: 24 },
        { etiqueta: 'Origen', ancho: 32 },
        { etiqueta: 'Destino', ancho: 32 },
        { etiqueta: 'Cantidad', ancho: 20 },
        { etiqueta: 'Movimiento', ancho: 22 },
        { etiqueta: 'Saldo', ancho: 18 },
        { etiqueta: 'Nota' },
      ],
      filas: [
        ...(notaListado ? [[notaListado, '', '', '', '', '', '', '']] : []),
        ...filasListado.map((f) => [
          new Date(f.fecha).toLocaleDateString('es-MX'),
          this.nombreTipo(f.tipo),
          f.origenNombre ?? '—',
          f.destinoNombre ?? '—',
          String(f.cantidad),
          (f.delta > 0 ? '+' : '') + String(f.delta),
          String(f.saldo),
          f.nota ?? '',
        ]),
      ],
    });
  }

  // ── Catálogos locales (solo IndexedDB) — cargados una sola vez bajo
  // demanda, nunca al abrir la pantalla (mismo patrón que
  // MovimientosBodegaComponent.cargarBaseLocal()). ───────────────────────
  private baseLocalCargada = false;
  private productosLocal: Producto[] = [];
  private bodegasLocal: Bodega[] = [];
  private existenciasBodegaLocal: ExistenciaBodega[] = [];
  private movimientosLocal: MovimientoInventario[] = [];
  private unidadesLocal: { id: number; nombre: string }[] = [];

  private async cargarBaseLocal(): Promise<void> {
    if (this.baseLocalCargada) return;
    const [productos, bodegas, existencias, movimientos, unidades] = await Promise.all([
      firstValueFrom(this.data.list<Producto>('Producto')),
      firstValueFrom(this.data.list<Bodega>('Bodega')),
      firstValueFrom(this.data.list<ExistenciaBodega>('ExistenciaBodega')),
      firstValueFrom(this.data.list<MovimientoInventario>('MovimientoInventario')),
      firstValueFrom(this.data.list<{ id: number; nombre: string }>('UnidadMedida')),
    ]);
    this.productosLocal = productos;
    this.bodegasLocal = bodegas;
    this.existenciasBodegaLocal = existencias;
    this.movimientosLocal = movimientos;
    this.unidadesLocal = unidades;
    this.baseLocalCargada = true;
  }
}

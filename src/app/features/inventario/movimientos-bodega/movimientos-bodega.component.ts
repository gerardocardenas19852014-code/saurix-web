import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Subscription, firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { ToastService } from '../../../shared/services/toast.service';
import { SelectBuscableComponent, OpcionBuscable } from '../../../shared/components/select-buscable/select-buscable.component';
import { EscaneoCodigoComponent } from '../../../shared/components/escaneo-codigo/escaneo-codigo.component';
import { Producto } from '../productos/producto.model';
import { Bodega } from '../bodegas/bodega.model';
import { ExistenciaBodega } from './existencia-bodega.model';
import { MovimientoInventarioService } from './movimiento-inventario.service';
import { MovimientoMasivoComponent } from './movimiento-masivo/movimiento-masivo.component';
import { exportarCsv } from '../../../shared/utils/csv.util';
import { exportarTablaPdf } from '../../../shared/utils/pdf-tabla.util';

type TipoMovimiento = 'entrada' | 'traspaso' | 'salida';
type TabMovimientosBodega = 'existencia' | 'historial' | 'transito';

interface FilaExistencia {
  existenciaId: number;
  productoId: number;
  productoCodigo: string;
  productoNombre: string;
  bodegaId: number;
  bodegaNombre: string;
  existencia: number;
  ubicacion: string | null;
}

interface FilaHistorial {
  id: number;
  /** Solo fecha (sin hora) — ver columna inventario.movimiento_inventario.fecha. */
  fecha: string;
  productoId: number;
  productoNombre: string;
  productoCodigo: string;
  bodegaOrigenId: number | null;
  origenNombre: string | null;
  bodegaDestinoId: number | null;
  destinoNombre: string | null;
  tipo: TipoMovimiento;
  cantidad: number;
  nota: string | null;
  enTransito: boolean;
  fechaRecepcion: string | null;
}

interface FilaTransito {
  id: number;
  fecha: string;
  productoId: number;
  productoNombre: string;
  productoCodigo: string;
  bodegaOrigenId: number;
  origenNombre: string;
  bodegaDestinoId: number;
  destinoNombre: string;
  cantidad: number;
  nota: string | null;
}

/** Tamaño del lote al exportar CSV en modo Supabase — mismo criterio que
 *  TAMANO_LOTE_EXPORTAR de valor-stock.component.ts: nunca una petición
 *  gigante de un jalón. */
const TAMANO_LOTE_EXPORTAR = 2000;
/** Tope de filas en el PDF (reporte acotado, no un volcado completo). */
const TOPE_FILAS_PDF = 200;

/**
 * "Opera fácilmente con distintas bodegas": entradas (mercancía nueva, o la
 * asignación inicial de la existencia que un producto ya traía antes de
 * este módulo), traspasos de cantidad entre
 * bodegas, y salidas/ajustes (mermas, daños, correcciones de conteo), con
 * su historial completo — filtrable por producto, bodega y fecha.
 *
 * La fuente real de "cuánto hay de qué, en dónde" es ExistenciaBodega (ver
 * ese modelo) — Producto.existencia solo se sigue usando como respaldo
 * mientras un producto no tenga todavía ningún registro aquí.
 *
 * Homologación visual + escalabilidad (27-oct, ver auditoría del proyecto):
 * pensado para 200,000+ productos y millones de movimientos — las 3
 * pestañas usan RPC paginadas (inventario.fn_movimientos_* — ver migración
 * movimientos_bodega_rpc_*), nunca cargan el catálogo de productos ni el
 * historial completo. Al abrir la pantalla solo se carga "Existencia por
 * bodega"; Historial y En tránsito
 * cargan hasta que se visita esa pestaña por primera vez (igual que
 * Rotación en valor-stock.component.ts). El selector de Producto (filtro
 * de Historial y el campo del modal "Nuevo movimiento") es un autocomplete
 * remoto con debounce (ver buscarProductosAutocomplete() y el modo remoto
 * nuevo de SelectBuscableComponent) — nunca descarga el catálogo completo.
 */
@Component({
  selector: 'app-movimientos-bodega',
  standalone: true,
  imports: [ReactiveFormsModule, SelectBuscableComponent, EscaneoCodigoComponent, DatePipe, MovimientoMasivoComponent],
  templateUrl: './movimientos-bodega.component.html',
  styleUrl: './movimientos-bodega.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MovimientosBodegaComponent implements OnInit, OnDestroy {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly movimientoService = inject(MovimientoInventarioService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);

  private readonly sb = inject(SupabaseService).cliente;

  // ── Catálogo de bodegas (chico, siempre completo) ──────────────────────
  protected readonly bodegas = signal<Bodega[]>([]);
  protected readonly bodegasActivas = computed(() => this.bodegas().filter((b) => b.activo !== false));
  protected readonly opcionesBodega = computed<OpcionBuscable[]>(() =>
    this.bodegasActivas().map((b) => ({ valor: b.id, etiqueta: b.nombre })),
  );

  protected readonly tabActiva = signal<TabMovimientosBodega>('existencia');
  private readonly transitoTabCargada = signal(false);

  // ── "Movimiento masivo" (requerimiento nuevo, nov-2026) — pantalla ancha
  // integrada en el módulo (NUNCA un modal), alterna con el contenido de
  // las pestañas de arriba sin afectar en nada el modal "Nuevo movimiento"
  // existente (mismas guardas de entrada que nuevoMovimiento()). ───────────
  protected readonly vistaMasiva = signal(false);

  async abrirMovimientoMasivo(): Promise<void> {
    if (this.bodegasActivas().length === 0) {
      this.toast.advertencia('Antes crea al menos una Bodega activa (Inventario → Bodegas).');
      return;
    }
    if (!(await this.hayProductosFisicosActivos())) {
      this.toast.advertencia('No hay productos físicos activos — da de alta alguno en Productos y servicios.');
      return;
    }
    this.vistaMasiva.set(true);
  }

  cancelarMasiva(): void {
    this.vistaMasiva.set(false);
  }

  alCompletarMasiva(): void {
    this.vistaMasiva.set(false);
    this.refrescarTrasGuardar();
  }

  seleccionarTab(tab: TabMovimientosBodega): void {
    this.tabActiva.set(tab);
    // Historial ya no se auto-carga al entrar a la pestaña — arranca vacío
    // hasta el primer "Buscar", igual que Existencia (ver cambiarFiltroHistorial()).
    if (tab === 'transito' && !this.transitoTabCargada()) {
      this.transitoTabCargada.set(true);
      this.cargarTransito();
    }
  }

  // ── Autocomplete remoto de Producto (requerimiento 7) — usado por el
  // filtro "Producto" de Historial y por el campo "Producto" del modal
  // "Nuevo movimiento". Referencia estable (campo de clase) para pasarla
  // como [busquedaRemota] sin recrear la función en cada detección de
  // cambios — llama a fn_productos_autocomplete. ──────────────────────────
  protected readonly buscarProductosAutocomplete = async (texto: string): Promise<OpcionBuscable[]> => {
    const limite = 15;
    const { data, error } = await this.sb.schema('inventario').rpc('fn_productos_autocomplete', {
      p_busqueda: texto || null,
      p_limite: limite,
    });
    if (error) return [];
    return ((data ?? []) as Record<string, unknown>[]).map((f) => ({
      valor: Number(f['id']),
      etiqueta: f['codigo'] ? `${f['codigo']} — ${f['nombre']}` : String(f['nombre']),
    }));
  };

  // ── Pestaña "Existencia por bodega" (carga automática al abrir, ver
  // requerimiento 15) ──────────────────────────────────────────────────────
  protected readonly cargandoExistencia = signal(true);
  protected readonly existenciaPagina = signal<FilaExistencia[]>([]);
  protected readonly totalExistenciaFiltrada = signal(0);
  protected readonly paginaActualExistencia = signal(1);
  protected readonly busquedaExistencia = signal('');
  protected readonly bodegaIdFiltroExistencia = signal(0); // 0 = todas (campo en blanco)
  protected readonly soloConExistencia = signal(true); // mismo comportamiento que tenía el filtro fijo >0 de antes
  /** Antes del primer click en "Buscar" (o Enter), la tabla no se carga ni
   *  se muestra — mismo patrón que Productos y servicios (busquedaRealizada). */
  protected readonly busquedaRealizadaExistencia = signal(false);
  protected readonly totalPaginasExistencia = computed(() =>
    Math.max(1, Math.ceil(this.totalExistenciaFiltrada() / Math.max(1, this.preferenciasGrid.tamanoPagina()))),
  );
  private secuenciaExistencia = 0;

  protected onBusquedaExistenciaInput(texto: string): void {
    this.busquedaExistencia.set(texto);
  }

  protected cambiarFiltroExistencia(): void {
    this.busquedaRealizadaExistencia.set(true);
    this.paginaActualExistencia.set(1);
    this.cargarExistencia();
  }

  protected irAPaginaAnteriorExistencia(): void {
    if (this.paginaActualExistencia() <= 1) return;
    this.paginaActualExistencia.update((p) => p - 1);
    this.cargarExistencia();
  }

  protected irAPaginaSiguienteExistencia(): void {
    if (this.paginaActualExistencia() >= this.totalPaginasExistencia()) return;
    this.paginaActualExistencia.update((p) => p + 1);
    this.cargarExistencia();
  }

  private async cargarExistencia(): Promise<void> {
    this.cargandoExistencia.set(true);
    const miSecuencia = ++this.secuenciaExistencia;
    const resultado = await this.cargarExistenciaSupabase();
    if (miSecuencia !== this.secuenciaExistencia) return; // respuesta vieja, se descarta
    this.existenciaPagina.set(resultado.filas);
    this.totalExistenciaFiltrada.set(resultado.total);
    this.cargandoExistencia.set(false);
  }

  private async cargarExistenciaSupabase(): Promise<{ filas: FilaExistencia[]; total: number }> {
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActualExistencia() - 1) * tamanio;
    const { data, error } = await this.sb.schema('inventario').rpc('fn_movimientos_existencia_bodega', {
      p_busqueda: this.busquedaExistencia().trim() || null,
      p_bodega_id: this.bodegaIdFiltroExistencia() || null,
      p_solo_con_existencia: this.soloConExistencia(),
      p_desde: desde,
      p_cantidad: tamanio,
    });
    if (error) return { filas: [], total: 0 };
    const filas = (data ?? []) as Record<string, unknown>[];
    return { filas: filas.map((f) => this.mapearFilaExistencia(f)), total: Number(filas[0]?.['total'] ?? 0) };
  }

  private mapearFilaExistencia(f: Record<string, unknown>): FilaExistencia {
    return {
      existenciaId: Number(f['existencia_id']),
      productoId: Number(f['producto_id']),
      productoCodigo: String(f['producto_codigo'] ?? ''),
      productoNombre: String(f['producto_nombre'] ?? ''),
      bodegaId: Number(f['bodega_id']),
      bodegaNombre: String(f['bodega_nombre'] ?? ''),
      existencia: Number(f['existencia']) || 0,
      ubicacion: (f['ubicacion'] as string | null) ?? null,
    };
  }

  /** Guarda la ubicación física (pasillo/anaquel, texto libre) de una fila
   *  de ExistenciaBodega ya existente — se edita inline en la tabla, sin
   *  modal. Solo guarda al perder foco (ver (change) en el .html, no
   *  (input)) y solo si el texto de verdad cambió — igual que antes.
   *  Actualiza SOLO esa fila, tanto en el servidor (un update puntual por
   *  id) como en memoria (la página ya cargada) — nunca refresca ni
   *  recarga la colección completa (requerimiento 5). */
  async actualizarUbicacion(fila: FilaExistencia, texto: string): Promise<void> {
    const nuevaUbicacion = texto.trim() || null;
    if (nuevaUbicacion === (fila.ubicacion ?? null)) return;
    await firstValueFrom(
      this.data.modificacion<ExistenciaBodega>('ExistenciaBodega', {
        id: fila.existenciaId,
        productoId: fila.productoId,
        bodegaId: fila.bodegaId,
        existencia: fila.existencia,
        ubicacion: nuevaUbicacion,
      }),
    );
    this.existenciaPagina.update((filas) =>
      filas.map((f) => (f.existenciaId === fila.existenciaId ? { ...f, ubicacion: nuevaUbicacion } : f)),
    );
  }

  // ── Pestaña "Historial de movimientos" (carga perezosa) ─────────────────
  protected readonly cargandoHistorial = signal(true);
  protected readonly historialPagina = signal<FilaHistorial[]>([]);
  protected readonly totalHistorialFiltrado = signal(0);
  protected readonly paginaActualHistorial = signal(1);
  protected readonly filtroProductoId = signal(0); // 0 = todos
  protected readonly filtroBodegaId = signal(0);
  protected readonly filtroDesde = signal('');
  protected readonly filtroHasta = signal('');
  /** Mismo patrón que Existencia/Productos: nada se carga ni se muestra
   *  hasta el primer click en "Buscar" (o Enter). */
  protected readonly busquedaRealizadaHistorial = signal(false);
  protected readonly hayFiltrosActivosHistorial = computed(
    () => this.filtroProductoId() !== 0 || this.filtroBodegaId() !== 0 || this.filtroDesde() !== '' || this.filtroHasta() !== '',
  );
  protected readonly totalPaginasHistorial = computed(() =>
    Math.max(1, Math.ceil(this.totalHistorialFiltrado() / Math.max(1, this.preferenciasGrid.tamanoPagina()))),
  );
  private secuenciaHistorial = 0;

  protected cambiarFiltroHistorial(): void {
    this.busquedaRealizadaHistorial.set(true);
    this.paginaActualHistorial.set(1);
    this.cargarHistorial();
  }

  protected irAPaginaAnteriorHistorial(): void {
    if (this.paginaActualHistorial() <= 1) return;
    this.paginaActualHistorial.update((p) => p - 1);
    this.cargarHistorial();
  }

  protected irAPaginaSiguienteHistorial(): void {
    if (this.paginaActualHistorial() >= this.totalPaginasHistorial()) return;
    this.paginaActualHistorial.update((p) => p + 1);
    this.cargarHistorial();
  }

  private async cargarHistorial(): Promise<void> {
    this.cargandoHistorial.set(true);
    const miSecuencia = ++this.secuenciaHistorial;
    const resultado = await this.cargarHistorialSupabase();
    if (miSecuencia !== this.secuenciaHistorial) return;
    this.historialPagina.set(resultado.filas);
    this.totalHistorialFiltrado.set(resultado.total);
    this.cargandoHistorial.set(false);
  }

  private parametrosHistorial(desde: number, cantidad: number) {
    return {
      p_producto_id: this.filtroProductoId() || null,
      p_bodega_id: this.filtroBodegaId() || null,
      p_desde_fecha: this.filtroDesde() || null,
      p_hasta_fecha: this.filtroHasta() || null,
      p_desde: desde,
      p_cantidad: cantidad,
    };
  }

  private async cargarHistorialSupabase(): Promise<{ filas: FilaHistorial[]; total: number }> {
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActualHistorial() - 1) * tamanio;
    const { data, error } = await this.sb.schema('inventario').rpc('fn_movimientos_historial', this.parametrosHistorial(desde, tamanio));
    if (error) return { filas: [], total: 0 };
    const filas = (data ?? []) as Record<string, unknown>[];
    return { filas: filas.map((f) => this.mapearFilaHistorial(f)), total: Number(filas[0]?.['total'] ?? 0) };
  }

  private mapearFilaHistorial(f: Record<string, unknown>): FilaHistorial {
    return {
      id: Number(f['id']),
      fecha: String(f['fecha']),
      productoId: Number(f['producto_id']),
      productoNombre: String(f['producto_nombre'] ?? ''),
      productoCodigo: String(f['producto_codigo'] ?? ''),
      bodegaOrigenId: f['bodega_origen_id'] === null ? null : Number(f['bodega_origen_id']),
      origenNombre: (f['origen_nombre'] as string | null) ?? null,
      bodegaDestinoId: f['bodega_destino_id'] === null ? null : Number(f['bodega_destino_id']),
      destinoNombre: (f['destino_nombre'] as string | null) ?? null,
      tipo: f['tipo'] as TipoMovimiento,
      cantidad: Number(f['cantidad']) || 0,
      nota: (f['nota'] as string | null) ?? null,
      enTransito: Boolean(f['en_transito']),
      fechaRecepcion: (f['fecha_recepcion'] as string | null) ?? null,
    };
  }

  private nombreTipoHistorial(fila: FilaHistorial): string {
    if (fila.tipo === 'traspaso') return fila.enTransito ? 'Traspaso (en tránsito)' : 'Traspaso';
    return fila.tipo === 'entrada' ? 'Entrada' : 'Salida/Ajuste';
  }

  /** CSV respeta los filtros actuales de Historial. En modo Supabase nunca
   *  descarga todo el historial de un jalón: pide páginas de
   *  TAMANO_LOTE_EXPORTAR en secuencia hasta agotar el total filtrado. */
  async exportarCsvHistorial(): Promise<void> {
    const columnas = [
      { clave: 'fecha' as const, etiqueta: 'Fecha' },
      { clave: 'productoNombre' as const, etiqueta: 'Producto' },
      { clave: 'tipo' as const, etiqueta: 'Tipo' },
      { clave: 'origenNombre' as const, etiqueta: 'Origen' },
      { clave: 'destinoNombre' as const, etiqueta: 'Destino' },
      { clave: 'cantidad' as const, etiqueta: 'Cantidad' },
      { clave: 'nota' as const, etiqueta: 'Nota' },
    ];

    const todas: Record<string, unknown>[] = [];
    let desde = 0;
    let total = Infinity;
    while (desde < total) {
      const { data, error } = await this.sb.schema('inventario').rpc('fn_movimientos_historial', this.parametrosHistorial(desde, TAMANO_LOTE_EXPORTAR));
      if (error) break;
      const filas = (data ?? []) as Record<string, unknown>[];
      if (filas.length === 0) break;
      total = Number(filas[0]?.['total'] ?? 0);
      for (const f of filas) {
        const fila = this.mapearFilaHistorial(f);
        todas.push({
          fecha: fila.fecha,
          productoNombre: fila.productoNombre,
          tipo: this.nombreTipoHistorial(fila),
          origenNombre: fila.origenNombre ?? '',
          destinoNombre: fila.destinoNombre ?? '',
          cantidad: fila.cantidad,
          nota: fila.nota ?? '',
        });
      }
      desde += TAMANO_LOTE_EXPORTAR;
    }
    exportarCsv('movimientos_bodega.csv', columnas, todas);
  }

  /** PDF acotado a TOPE_FILAS_PDF (reporte, no un volcado completo) —
   *  mismo criterio que valor-stock.component.ts → exportarPdfProductos(). */
  async exportarPdfHistorial(): Promise<void> {
    const { data, error } = await this.sb.schema('inventario').rpc('fn_movimientos_historial', this.parametrosHistorial(0, TOPE_FILAS_PDF));
    const filas = !error ? ((data ?? []) as Record<string, unknown>[]) : [];
    const filasListado = filas.map((f) => this.mapearFilaHistorial(f));
    const totalFiltrado = Number(filas[0]?.['total'] ?? filasListado.length);

    const notaListado =
      totalFiltrado > filasListado.length
        ? `Mostrando los primeros ${filasListado.length} de ${totalFiltrado} movimientos filtrados (exporta CSV para el detalle completo).`
        : undefined;

    exportarTablaPdf({
      nombreArchivo: 'movimientos_bodega.pdf',
      titulo: 'Historial de movimientos entre bodegas',
      subtitulo: this.hayFiltrosActivosHistorial() ? 'Con filtros aplicados' : undefined,
      columnas: [
        { etiqueta: 'Fecha', ancho: 32 },
        { etiqueta: 'Producto' },
        { etiqueta: 'Tipo', ancho: 38 },
        { etiqueta: 'Origen', ancho: 32 },
        { etiqueta: 'Destino', ancho: 32 },
        { etiqueta: 'Cantidad', ancho: 20 },
        { etiqueta: 'Nota', ancho: 40 },
      ],
      filas: [
        ...(notaListado ? [[notaListado, '', '', '', '', '', '']] : []),
        ...filasListado.map((f) => [
          new Date(f.fecha).toLocaleDateString('es-MX'),
          f.productoNombre,
          this.nombreTipoHistorial(f),
          f.origenNombre ?? '—',
          f.destinoNombre ?? '—',
          String(f.cantidad),
          f.nota ?? '',
        ]),
      ],
    });
  }

  // ── Pestaña "En tránsito" (carga perezosa, solo pendientes) ─────────────
  protected readonly cargandoTransito = signal(true);
  protected readonly transitoPagina = signal<FilaTransito[]>([]);
  protected readonly totalTransitoFiltrado = signal(0);
  protected readonly paginaActualTransito = signal(1);
  protected readonly filtroBodegaOrigenTransito = signal(0);
  protected readonly filtroBodegaDestinoTransito = signal(0);
  protected readonly totalPaginasTransito = computed(() =>
    Math.max(1, Math.ceil(this.totalTransitoFiltrado() / Math.max(1, this.preferenciasGrid.tamanoPagina()))),
  );
  private secuenciaTransito = 0;
  protected readonly confirmandoRecepcionId = signal<number | null>(null);

  protected cambiarFiltroTransito(): void {
    this.paginaActualTransito.set(1);
    this.cargarTransito();
  }

  protected irAPaginaAnteriorTransito(): void {
    if (this.paginaActualTransito() <= 1) return;
    this.paginaActualTransito.update((p) => p - 1);
    this.cargarTransito();
  }

  protected irAPaginaSiguienteTransito(): void {
    if (this.paginaActualTransito() >= this.totalPaginasTransito()) return;
    this.paginaActualTransito.update((p) => p + 1);
    this.cargarTransito();
  }

  private async cargarTransito(): Promise<void> {
    this.cargandoTransito.set(true);
    const miSecuencia = ++this.secuenciaTransito;
    const resultado = await this.cargarTransitoSupabase();
    if (miSecuencia !== this.secuenciaTransito) return;
    this.transitoPagina.set(resultado.filas);
    this.totalTransitoFiltrado.set(resultado.total);
    this.cargandoTransito.set(false);
  }

  private async cargarTransitoSupabase(): Promise<{ filas: FilaTransito[]; total: number }> {
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActualTransito() - 1) * tamanio;
    const { data, error } = await this.sb.schema('inventario').rpc('fn_movimientos_transito', {
      p_bodega_origen_id: this.filtroBodegaOrigenTransito() || null,
      p_bodega_destino_id: this.filtroBodegaDestinoTransito() || null,
      p_desde: desde,
      p_cantidad: tamanio,
    });
    if (error) return { filas: [], total: 0 };
    const filas = (data ?? []) as Record<string, unknown>[];
    return {
      filas: filas.map((f) => ({
        id: Number(f['id']),
        fecha: String(f['fecha']),
        productoId: Number(f['producto_id']),
        productoNombre: String(f['producto_nombre'] ?? ''),
        productoCodigo: String(f['producto_codigo'] ?? ''),
        bodegaOrigenId: Number(f['bodega_origen_id']),
        origenNombre: String(f['origen_nombre'] ?? ''),
        bodegaDestinoId: Number(f['bodega_destino_id']),
        destinoNombre: String(f['destino_nombre'] ?? ''),
        cantidad: Number(f['cantidad']) || 0,
        nota: (f['nota'] as string | null) ?? null,
      })),
      total: Number(filas[0]?.['total'] ?? 0),
    };
  }

  /** Suma a la bodega destino lo que ya se restó de origen al enviarlo, y
   *  marca el traspaso como recibido — misma lógica de siempre
   *  (MovimientoInventarioService.confirmarRecepcionTransito(), sin tocar).
   *  Solo refresca la pestaña "En tránsito" (la que se está viendo); si el
   *  usuario vuelve a "Existencia por bodega" la verá al día la próxima vez
   *  que haga click en Buscar — no se dispara una petición a una pestaña
   *  que no se está viendo. */
  async confirmarRecepcion(movimientoId: number): Promise<void> {
    this.confirmandoRecepcionId.set(movimientoId);
    await this.movimientoService.confirmarRecepcionTransito(movimientoId);
    this.confirmandoRecepcionId.set(null);
    this.toast.exito('Recepción confirmada — se sumó a la bodega destino.');
    this.cargarTransito();
  }

  // ── Modal "Nuevo movimiento" (reglas de negocio SIN CAMBIOS — ver
  // MovimientoInventarioService) ───────────────────────────────────────────
  protected readonly modalAbierto = signal(false);
  protected readonly guardando = signal(false);
  /** Etiqueta a mostrar en el campo remoto de Producto cuando se precarga
   *  un valor programáticamente (seleccionarPorCodigo())
   *  — en modo remoto, SelectBuscableComponent no tiene el catálogo
   *  completo para resolver la etiqueta de un id por sí solo. */
  protected readonly productoPreseleccionadoEtiqueta = signal<string | null>(null);
  /** Existencia disponible en la bodega de origen elegida, para el producto
   *  elegido — se recalcula con un query puntual (ver actualizarDisponibleOrigen()),
   *  nunca desde una colección completa cargada en memoria. */
  protected readonly disponibleOrigen = signal<number | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    tipo: ['traspaso' as TipoMovimiento, Validators.required],
    productoId: [0, [Validators.required, Validators.min(1)]],
    bodegaOrigenId: [0],
    bodegaDestinoId: [0],
    cantidad: [1, [Validators.required, Validators.min(1)]],
    nota: [''],
    enTransito: [false],
  });

  private readonly formSubscription: Subscription;

  constructor() {
    this.formSubscription = this.form.valueChanges.subscribe(() => this.actualizarDisponibleOrigen());
  }

  private actualizarDisponibleOrigen(): void {
    const { tipo, productoId, bodegaOrigenId } = this.form.getRawValue();
    if ((tipo !== 'traspaso' && tipo !== 'salida') || !productoId || !bodegaOrigenId) {
      this.disponibleOrigen.set(null);
      return;
    }
    this.movimientoService.existenciaEnBodega(productoId, bodegaOrigenId).then((valor) => this.disponibleOrigen.set(valor));
  }

  ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid'); // ancho completo
    this.cargarBodegas();
    // Ninguna pestaña carga datos sola al abrir — igual que Productos y
    // servicios, la tabla arranca vacía hasta el primer click en "Buscar"
    // (ver busquedaRealizadaExistencia/busquedaRealizadaHistorial).
  }

  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
    this.formSubscription.unsubscribe();
  }

  private async cargarBodegas(): Promise<void> {
    const bodegas = await firstValueFrom(this.data.list<Bodega>('Bodega'));
    this.bodegas.set(bodegas);
  }

  /** Existencia de al menos un producto físico activo — un query acotado
   *  (1 fila), nunca el catálogo completo, solo para decidir si vale la
   *  pena abrir el modal (mismo mensaje de advertencia que antes). */
  private async hayProductosFisicosActivos(): Promise<boolean> {
    const { data, error } = await this.sb.schema('inventario').rpc('fn_productos_autocomplete', { p_busqueda: null, p_limite: 1 });
    return !error && ((data as unknown[]) ?? []).length > 0;
  }

  /** Busca el producto cuyo código coincida (exacto, sin distinguir
   *  mayúsculas) con lo escaneado/capturado en app-escaneo-codigo y lo
   *  selecciona en el formulario — el usuario sigue siendo quien revisa el
   *  resto del formulario antes de guardar. Solo busca entre productos físicos
   *  activos. Consulta puntual por código (índice existente), nunca el
   *  catálogo completo. */
  async seleccionarPorCodigo(codigo: string): Promise<void> {
    const limpio = codigo.trim();
    if (!limpio) return;
    const { filas } = await firstValueFrom(this.data.listarPagina<Producto>('Producto', { codigo: limpio, activo: true }, 0, 5));
    const encontrado = filas.find((p) => (p.codigo ?? '').trim().toLowerCase() === limpio.toLowerCase());
    if (!encontrado) {
      this.toast.advertencia(`No se encontró ningún producto activo con el código "${codigo}".`);
      return;
    }
    this.form.patchValue({ productoId: encontrado.id });
    this.productoPreseleccionadoEtiqueta.set(encontrado.codigo ? `${encontrado.codigo} — ${encontrado.nombre}` : encontrado.nombre);
    this.toast.exito(`Producto seleccionado: ${encontrado.nombre}.`);
  }

  async nuevoMovimiento(tipo: TipoMovimiento = 'traspaso'): Promise<void> {
    if (this.bodegasActivas().length === 0) {
      this.toast.advertencia('Antes crea al menos una Bodega activa (Inventario → Bodegas).');
      return;
    }
    if (!(await this.hayProductosFisicosActivos())) {
      this.toast.advertencia('No hay productos físicos activos — da de alta alguno en Productos y servicios.');
      return;
    }
    this.form.reset({ tipo, productoId: 0, bodegaOrigenId: 0, bodegaDestinoId: 0, cantidad: 1, nota: '', enTransito: false });
    this.productoPreseleccionadoEtiqueta.set(null);
    this.disponibleOrigen.set(null);
    this.modalAbierto.set(true);
  }

  async guardar(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const valor = this.form.getRawValue();

    if (valor.tipo === 'entrada') {
      if (!valor.bodegaDestinoId) {
        this.toast.advertencia('Elige la bodega de destino.');
        return;
      }
    } else {
      // Traspaso o Salida/Ajuste: ambos restan de una bodega de origen.
      if (!valor.bodegaOrigenId) {
        this.toast.advertencia('Elige la bodega de origen.');
        return;
      }
      if (valor.tipo === 'traspaso') {
        if (!valor.bodegaDestinoId) {
          this.toast.advertencia('Elige la bodega de destino.');
          return;
        }
        if (valor.bodegaOrigenId === valor.bodegaDestinoId) {
          this.toast.advertencia('La bodega de origen y destino no pueden ser la misma.');
          return;
        }
      }
      const disponible = await this.movimientoService.existenciaEnBodega(valor.productoId, valor.bodegaOrigenId);
      if (valor.cantidad > disponible) {
        this.toast.advertencia(`Esa bodega solo tiene ${disponible} de existencia disponible para ese producto.`);
        return;
      }
    }

    const bodegaOrigenId = valor.tipo === 'traspaso' || valor.tipo === 'salida' ? valor.bodegaOrigenId : null;
    const bodegaDestinoId = valor.tipo === 'salida' ? null : valor.bodegaDestinoId;
    const enTransito = valor.tipo === 'traspaso' && valor.enTransito;

    const registro = {
      productoId: valor.productoId,
      bodegaOrigenId,
      bodegaDestinoId,
      cantidad: valor.cantidad,
      nota: valor.nota || null,
    };

    this.guardando.set(true);
    // "Marcar como en tránsito" solo aplica a Traspaso — resta de origen
    // ahora, pero el destino se abona después al confirmar la recepción.
    // Cualquier otro caso sigue igual que siempre, con registrar().
    await (enTransito ? this.movimientoService.enviarEnTransito(registro) : this.movimientoService.registrar(registro));
    this.guardando.set(false);
    this.toast.exito(enTransito ? 'Traspaso enviado — pendiente de confirmar recepción.' : 'Movimiento registrado.');
    this.modalAbierto.set(false);
    this.refrescarTrasGuardar();
  }

  /** Tras crear un movimiento: refresca solo la pestaña que se está viendo
   *  (nunca las otras dos, que ni siquiera tienen por qué estar cargadas). */
  private refrescarTrasGuardar(): void {
    if (this.tabActiva() === 'existencia') this.cargarExistencia();
    else if (this.tabActiva() === 'historial') this.cargarHistorial();
    else this.cargarTransito();
  }
}

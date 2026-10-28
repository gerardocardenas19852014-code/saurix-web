import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { fuenteDatosActual } from '../../../core/services/fuente-datos';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { ToastService } from '../../../shared/services/toast.service';
import { AuthService } from '../../../core/services/auth.service';
import { Producto } from '../productos/producto.model';
import { Bodega } from '../bodegas/bodega.model';
import { ExistenciaBodega } from '../movimientos-bodega/existencia-bodega.model';
import { MovimientoInventarioService } from '../movimientos-bodega/movimiento-inventario.service';
import { Usuario, nombreCompletoUsuario } from '../../seguridad/usuarios/usuario.model';
import { ConteoFisico, ConteoFisicoDetalle } from './conteo-fisico.model';
import { EscaneoCodigoComponent } from '../../../shared/components/escaneo-codigo/escaneo-codigo.component';
import { exportarCsv } from '../../../shared/utils/csv.util';
import { exportarTablaPdf } from '../../../shared/utils/pdf-tabla.util';

type TabConteoFisico = 'nuevo' | 'historial';

/** Una fila de la página actual del buscador de "Nuevo conteo" — SOLO lo
 *  que acaba de llegar del servidor para la bodega/filtro actuales, nunca
 *  el catálogo completo (ver cargar()/cargarSupabase()). */
interface FilaConteo {
  productoId: number;
  codigo: string;
  nombre: string;
  /** Existencia en sistema para ESA bodega al momento de consultarla. */
  sistema: number;
}

/** Lo que el usuario capturó de verdad para un producto, en esta sesión de
 *  conteo — sobrevive cambios de página y de filtro (ver capturas() más
 *  abajo). Independiente de qué página esté mostrando la tabla en este
 *  momento: por eso guarda su propio snapshot de `sistema` (el que tenía
 *  la fila la última vez que se tocó), no depende de que esa fila siga
 *  visible para calcular la diferencia al guardar.
 *
 *  CRÍTICO (requerimiento 13 de la homologación 27-oct): la existencia de
 *  una entrada aquí ES el marcador de "esto sí se contó" — un producto que
 *  solo se vio en la tabla pero nunca se tocó NO entra aquí y por lo tanto
 *  nunca se guarda como si fuera 0. "No consultado" y "consultado pero no
 *  contado" nunca se confunden con "contado como 0" (ver contadoDe()). */
interface CapturaConteo {
  sistema: number;
  contado: number;
  codigo: string;
  nombre: string;
}

/** Una sesión de conteo ya guardada, para el historial de abajo — ver
 *  ConteoFisico en conteo-fisico.model.ts. */
interface FilaHistorialConteo {
  id: number;
  fecha: string;
  bodegaId: number;
  bodegaNombre: string;
  usuarioNombre: string;
  totalProductos: number;
  totalDiferencias: number;
  notas: string | null;
}

/** Una línea del detalle de una sesión, para cuando se expande en el
 *  historial — ver ConteoFisicoDetalle en conteo-fisico.model.ts. */
interface FilaDetalleHistorial {
  productoNombre: string;
  sistema: number;
  contado: number;
  diferencia: number;
}

/** Tamaño del lote al exportar CSV en modo Supabase — mismo criterio que
 *  movimientos-bodega.component.ts/valor-stock.component.ts: nunca una
 *  petición gigante de un jalón. */
const TAMANO_LOTE_EXPORTAR = 2000;
/** Tope de filas en el PDF (reporte acotado, no un volcado completo). */
const TOPE_FILAS_PDF = 200;

/**
 * Cuadre de inventario: capturas lo que de verdad contaste en una bodega y
 * el sistema calcula la diferencia contra lo que dice ExistenciaBodega —
 * sin que tengas que calcular tú el ajuste a mano como tocaría hacer con
 * Movimientos entre bodegas (Salida/Ajuste) si encontraras una diferencia.
 *
 * Reutiliza MovimientoInventarioService.registrar() (ver ese archivo) para
 * aplicar los ajustes — mismo mecanismo que ya usa Movimientos entre
 * bodegas — y deja la sesión completa como su propio registro en
 * ConteoFisico + ConteoFisicoDetalle (ver ese modelo), con quién la hizo,
 * cuándo, en qué bodega y el detalle de todos los productos contados (no
 * solo los que tuvieron diferencia). Se puede guardar aunque no haya
 * ninguna diferencia.
 *
 * Homologación visual + escalabilidad (27-oct, ver auditoría del
 * proyecto): pensado para 200,000+ productos — "Nuevo conteo" ya NO carga
 * sola la bodega completa al elegirla; usa el mismo patrón de búsqueda
 * server-side paginada que Productos y servicios / Movimientos entre
 * bodegas (ver busquedaRealizada/cargarSupabase(), que llama a
 * inventario.fn_conteo_fisico_productos). Como la tabla ya no mantiene en
 * memoria el catálogo completo de la bodega, lo que el usuario captura
 * (capturas(), ver CapturaConteo arriba) se guarda APARTE de qué página se
 * está mostrando — así cambiar de página nunca pierde lo ya tecleado, y
 * "Guardar conteo" procesa TODO lo capturado en la sesión, sin importar en
 * qué página se haya tecleado cada cosa (requerimientos 10/12/13).
 *
 * "Historial de conteos" sigue el mismo criterio que Historial de
 * movimientos: nada se carga hasta el primer click en 🔍 Buscar (ni
 * siquiera al entrar a esa pestaña), y usa su propia RPC paginada
 * (fn_conteo_fisico_historial). "Ver detalle" consulta SOLO esa sesión
 * (fn_conteo_fisico_detalle), nunca junto con el listado principal.
 *
 * En modo IndexedDB (navegador sin backend) se mantiene un cálculo en
 * memoria equivalente, cargado una sola vez bajo demanda (cargarBaseLocal())
 * — a esa escala nunca es un problema real de rendimiento.
 */
@Component({
  selector: 'app-conteo-fisico',
  standalone: true,
  imports: [DatePipe, EscaneoCodigoComponent],
  templateUrl: './conteo-fisico.component.html',
  styleUrl: './conteo-fisico.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConteoFisicoComponent implements OnInit, OnDestroy {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly movimientoService = inject(MovimientoInventarioService);
  private readonly auth = inject(AuthService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);

  private readonly esSupabase = fuenteDatosActual() === 'supabase';
  private readonly sb = this.esSupabase ? inject(SupabaseService).cliente : null;

  ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid'); // ancho completo
    this.cargarBodegas();
    // Ninguna pestaña carga productos/historial sola al abrir — igual que
    // Productos y servicios / Movimientos entre bodegas, todo arranca
    // vacío hasta el primer click en 🔍 Buscar (ver busquedaRealizada/
    // busquedaRealizadaHistorial).
  }

  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  protected readonly tabActiva = signal<TabConteoFisico>('nuevo');
  seleccionarTab(tab: TabConteoFisico): void {
    this.tabActiva.set(tab);
  }

  // ── Catálogo de bodegas (chico, siempre completo en ambos modos) ───────
  protected readonly bodegas = signal<Bodega[]>([]);
  protected readonly bodegasActivas = computed(() => this.bodegas().filter((b) => b.activo !== false));
  private nombreBodega(id: number): string {
    return this.bodegas().find((b) => b.id === id)?.nombre ?? '—';
  }

  private async cargarBodegas(): Promise<void> {
    const bodegas = await firstValueFrom(this.data.list<Bodega>('Bodega'));
    this.bodegas.set(bodegas);
  }

  // ── Pestaña "Nuevo conteo" ───────────────────────────────────────────────
  protected readonly bodegaId = signal(0);
  protected readonly busquedaNombre = signal('');
  protected readonly busquedaCodigo = signal('');
  protected readonly cargando = signal(false);
  protected readonly guardando = signal(false);
  protected readonly notas = signal('');

  protected readonly filasPagina = signal<FilaConteo[]>([]);
  protected readonly totalFilasFiltradas = signal(0);
  protected readonly paginaActual = signal(1);
  /** Igual que Productos y servicios: nada se consulta ni se muestra hasta
   *  el primer click en "Buscar" (o Enter) con una bodega ya elegida. */
  protected readonly busquedaRealizada = signal(false);
  protected readonly totalPaginas = computed(() =>
    Math.max(1, Math.ceil(this.totalFilasFiltradas() / Math.max(1, this.preferenciasGrid.tamanoPagina()))),
  );
  private secuencia = 0;

  /** Lo capturado en ESTA sesión de conteo, independiente de qué página se
   *  esté mostrando — ver CapturaConteo arriba. Se reinicia solo al elegir
   *  una bodega distinta (nueva sesión) o tras guardar. */
  protected readonly capturas = signal<Record<number, CapturaConteo>>({});
  protected readonly totalCapturados = computed(() => Object.keys(this.capturas()).length);
  protected readonly totalDiferenciasCapturadas = computed(
    () => Object.values(this.capturas()).filter((c) => c.contado !== c.sistema).length,
  );

  /** Valor a mostrar en "Cantidad contada": lo capturado si ya se tocó este
   *  producto en la sesión; si no, el valor del sistema SOLO como default
   *  visual (no como si ya se hubiera contado — ver actualizarContado()). */
  protected contadoDe(fila: FilaConteo): number {
    return this.capturas()[fila.productoId]?.contado ?? fila.sistema;
  }

  protected diferencia(fila: FilaConteo): number {
    return this.contadoDe(fila) - fila.sistema;
  }

  protected actualizarContado(fila: FilaConteo, valor: string): void {
    const numero = Number(valor);
    const contado = Number.isNaN(numero) ? 0 : Math.max(0, numero);
    this.capturas.update((actual) => ({
      ...actual,
      [fila.productoId]: { sistema: fila.sistema, contado, codigo: fila.codigo, nombre: fila.nombre },
    }));
  }

  seleccionarBodega(id: number): void {
    this.bodegaId.set(id);
    // Nueva sesión de conteo — descarta lo capturado para la bodega
    // anterior y obliga a volver a dar Buscar antes de ver nada.
    this.capturas.set({});
    this.notas.set('');
    this.busquedaRealizada.set(false);
    this.busquedaNombre.set('');
    this.busquedaCodigo.set('');
    this.filasPagina.set([]);
    this.totalFilasFiltradas.set(0);
    this.paginaActual.set(1);
  }

  protected cambiarFiltro(): void {
    if (!this.bodegaId()) {
      this.toast.advertencia('Primero elige una bodega.');
      return;
    }
    this.busquedaRealizada.set(true);
    this.paginaActual.set(1);
    this.cargar();
  }

  protected irAPaginaAnterior(): void {
    if (this.paginaActual() <= 1) return;
    this.paginaActual.update((p) => p - 1);
    this.cargar();
  }

  protected irAPaginaSiguiente(): void {
    if (this.paginaActual() >= this.totalPaginas()) return;
    this.paginaActual.update((p) => p + 1);
    this.cargar();
  }

  private async cargar(): Promise<void> {
    this.cargando.set(true);
    const miSecuencia = ++this.secuencia;
    const resultado = this.esSupabase ? await this.cargarSupabase() : await this.cargarLocal();
    if (miSecuencia !== this.secuencia) return; // respuesta vieja, se descarta
    this.filasPagina.set(resultado.filas);
    this.totalFilasFiltradas.set(resultado.total);
    this.cargando.set(false);
  }

  private mapearFilaConteo(f: Record<string, unknown>): FilaConteo {
    return {
      productoId: Number(f['producto_id']),
      codigo: String(f['codigo'] ?? ''),
      nombre: String(f['nombre'] ?? ''),
      sistema: Number(f['existencia']) || 0,
    };
  }

  private async cargarSupabase(): Promise<{ filas: FilaConteo[]; total: number }> {
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActual() - 1) * tamanio;
    const { data, error } = await this.sb!.schema('inventario').rpc('fn_conteo_fisico_productos', {
      p_bodega_id: this.bodegaId(),
      p_busqueda_nombre: this.busquedaNombre().trim() || null,
      p_busqueda_codigo: this.busquedaCodigo().trim() || null,
      p_desde: desde,
      p_cantidad: tamanio,
    });
    if (error) return { filas: [], total: 0 };
    const filas = (data ?? []) as Record<string, unknown>[];
    return { filas: filas.map((f) => this.mapearFilaConteo(f)), total: Number(filas[0]?.['total'] ?? 0) };
  }

  private filasLocalFiltradas(): FilaConteo[] {
    const bodegaId = this.bodegaId();
    if (!bodegaId) return [];
    const nombre = this.busquedaNombre().trim().toLowerCase();
    const codigo = this.busquedaCodigo().trim().toLowerCase();
    const productosPorId = new Map(this.productosLocal.filter((p) => p.activo && p.existencia !== null).map((p) => [p.id, p]));
    return this.existenciasBodegaLocal
      .filter((e) => e.bodegaId === bodegaId && productosPorId.has(e.productoId))
      .map((e) => {
        const p = productosPorId.get(e.productoId)!;
        return { productoId: e.productoId, codigo: p.codigo ?? '', nombre: p.nombre, sistema: e.existencia };
      })
      .filter((f) => (!nombre || f.nombre.toLowerCase().includes(nombre)) && (!codigo || f.codigo.toLowerCase().includes(codigo)))
      .sort((a, b) => a.nombre.localeCompare(b.nombre) || a.productoId - b.productoId);
  }

  private async cargarLocal(): Promise<{ filas: FilaConteo[]; total: number }> {
    await this.cargarBaseLocal();
    const todas = this.filasLocalFiltradas();
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActual() - 1) * tamanio;
    return { filas: todas.slice(desde, desde + tamanio), total: todas.length };
  }

  /** Atajo para contar escaneando (lector USB/Bluetooth o cámara — ver
   *  app-escaneo-codigo): cada escaneo SUMA 1 al contado de ese producto,
   *  en vez de reemplazarlo — así contar 5 piezas iguales es escanearlas 5
   *  veces. La primera vez que se escanea un producto en la sesión empieza
   *  en 1, no en "lo que ya decía el sistema + 1".
   *
   *  A diferencia de antes, esto YA NO busca solo entre las filas de la
   *  página actual (con paginación real, el producto escaneado puede no
   *  estar en la página visible) — consulta directo al servidor por ese
   *  código EXACTO dentro de la bodega elegida (mismo criterio que
   *  asignarCodigoEscaneado()/seleccionarPorCodigo() en Productos y
   *  Movimientos entre bodegas: una consulta puntual, nunca el catálogo
   *  completo). No exige haber dado "Buscar" antes ni espera a que la
   *  tabla muestre algo — se puede escanear producto tras producto a toda
   *  velocidad sin tocar el botón Buscar (requerimiento 6/7). */
  async escanearProducto(codigoCrudo: string): Promise<void> {
    if (!this.bodegaId()) {
      this.toast.advertencia('Primero elige una bodega.');
      return;
    }
    const codigo = codigoCrudo.trim();
    if (!codigo) return;
    this.busquedaCodigo.set(codigo); // también deja el código listo por si luego se da "Buscar" a mano

    const encontrado = this.esSupabase ? await this.buscarPorCodigoExactoSupabase(codigo) : await this.buscarPorCodigoExactoLocal(codigo);
    if (!encontrado) {
      this.toast.advertencia(`No se encontró ningún producto con el código "${codigo}" en esta bodega.`);
      return;
    }

    const actual = this.capturas()[encontrado.productoId];
    const nuevoContado = (actual?.contado ?? 0) + 1;
    this.capturas.update((c) => ({
      ...c,
      [encontrado.productoId]: { sistema: encontrado.sistema, contado: nuevoContado, codigo: encontrado.codigo, nombre: encontrado.nombre },
    }));
    this.toast.info(`${encontrado.nombre}: ${nuevoContado} contado(s).`);
  }

  private async buscarPorCodigoExactoSupabase(codigo: string): Promise<FilaConteo | undefined> {
    const { data, error } = await this.sb!.schema('inventario').rpc('fn_conteo_fisico_productos', {
      p_bodega_id: this.bodegaId(),
      p_busqueda_codigo: codigo,
      p_desde: 0,
      p_cantidad: 5,
    });
    if (error) return undefined;
    const filas = ((data ?? []) as Record<string, unknown>[]).map((f) => this.mapearFilaConteo(f));
    return filas.find((f) => f.codigo.trim().toLowerCase() === codigo.toLowerCase());
  }

  private async buscarPorCodigoExactoLocal(codigo: string): Promise<FilaConteo | undefined> {
    await this.cargarBaseLocal();
    const normalizado = codigo.toLowerCase();
    return this.filasLocalFiltradasSinTexto().find((f) => f.codigo.trim().toLowerCase() === normalizado);
  }

  private filasLocalFiltradasSinTexto(): FilaConteo[] {
    const bodegaId = this.bodegaId();
    const productosPorId = new Map(this.productosLocal.filter((p) => p.activo && p.existencia !== null).map((p) => [p.id, p]));
    return this.existenciasBodegaLocal
      .filter((e) => e.bodegaId === bodegaId && productosPorId.has(e.productoId))
      .map((e) => {
        const p = productosPorId.get(e.productoId)!;
        return { productoId: e.productoId, codigo: p.codigo ?? '', nombre: p.nombre, sistema: e.existencia };
      });
  }

  /** Guarda la sesión completa: el encabezado ConteoFisico + una línea de
   *  ConteoFisicoDetalle por cada producto CAPTURADO en la sesión (tenga
   *  diferencia o no), sin importar en qué página se haya tecleado cada
   *  uno (ver capturas()) — y, solo para los que sí tuvieron diferencia,
   *  el ajuste de existencia de siempre (MovimientoInventarioService.registrar()).
   *
   *  A diferencia de la versión anterior (que guardaba TODA la bodega,
   *  porque la tenía completa en memoria), ahora solo se guardan los
   *  productos que de verdad se tocaron (se tecleó una cantidad o se
   *  escanearon) — con 200,000 productos por bodega ya no existe "toda la
   *  bodega" en memoria para guardar de un jalón, y guardar algo que
   *  nunca se contó como si fuera 0 sería exactamente el "faltante masivo
   *  accidental" que el requerimiento 13 pide evitar. */
  async guardarCuadre(): Promise<void> {
    const bodegaId = this.bodegaId();
    if (!bodegaId) {
      this.toast.advertencia('Primero elige una bodega.');
      return;
    }
    const usuarioId = this.auth.usuarioActual()?.id;
    if (!usuarioId) {
      this.toast.error('No se pudo identificar al usuario actual.');
      return;
    }
    const capturados = Object.entries(this.capturas()).map(([id, c]) => ({ productoId: Number(id), ...c }));
    if (capturados.length === 0) {
      this.toast.advertencia('Todavía no has contado ningún producto.');
      return;
    }

    const ajustes = capturados.map((c) => ({ ...c, diferencia: c.contado - c.sistema })).filter((c) => c.diferencia !== 0);

    this.guardando.set(true);
    try {
      for (const a of ajustes) {
        const nota = `Ajuste por conteo físico (sistema: ${a.sistema}, contado: ${a.contado})`;
        if (a.diferencia > 0) {
          await this.movimientoService.registrar({
            productoId: a.productoId,
            bodegaOrigenId: null,
            bodegaDestinoId: bodegaId,
            cantidad: a.diferencia,
            nota,
          });
        } else {
          await this.movimientoService.registrar({
            productoId: a.productoId,
            bodegaOrigenId: bodegaId,
            bodegaDestinoId: null,
            cantidad: -a.diferencia,
            nota,
          });
        }
      }

      const conteo = await firstValueFrom(
        this.data.alta<ConteoFisico>('ConteoFisico', {
          bodegaId,
          usuarioId,
          fecha: new Date().toISOString(),
          totalProductos: capturados.length,
          totalDiferencias: ajustes.length,
          notas: this.notas().trim() || null,
        }),
      );

      for (const c of capturados) {
        await firstValueFrom(
          this.data.alta<ConteoFisicoDetalle>('ConteoFisicoDetalle', {
            conteoFisicoId: conteo.id,
            productoId: c.productoId,
            sistema: c.sistema,
            contado: c.contado,
            diferencia: c.contado - c.sistema,
          }),
        );
      }

      this.toast.exito(
        ajustes.length > 0
          ? `Conteo guardado: ${capturados.length} producto(s), ${ajustes.length} ajuste${ajustes.length === 1 ? '' : 's'}.`
          : `Conteo guardado: ${capturados.length} producto(s), sin diferencias.`,
      );
      this.capturas.set({});
      this.notas.set('');
      if (this.busquedaRealizada()) this.cargar(); // refresca la página visible (la existencia pudo cambiar)
    } finally {
      this.guardando.set(false);
    }
  }

  // ── Pestaña "Historial de conteos" (carga perezosa — nada hasta el
  // primer "Buscar", igual que Historial de movimientos) ──────────────────
  protected readonly cargandoHistorial = signal(false);
  protected readonly historialPagina = signal<FilaHistorialConteo[]>([]);
  protected readonly totalHistorialFiltrado = signal(0);
  protected readonly paginaActualHistorial = signal(1);
  protected readonly filtroHistorialBodegaId = signal(0);
  protected readonly filtroHistorialDesde = signal('');
  protected readonly filtroHistorialHasta = signal('');
  protected readonly busquedaRealizadaHistorial = signal(false);
  protected readonly hayFiltrosHistorialActivos = computed(
    () => this.filtroHistorialBodegaId() !== 0 || this.filtroHistorialDesde() !== '' || this.filtroHistorialHasta() !== '',
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

  limpiarFiltrosHistorial(): void {
    this.filtroHistorialBodegaId.set(0);
    this.filtroHistorialDesde.set('');
    this.filtroHistorialHasta.set('');
  }

  private async cargarHistorial(): Promise<void> {
    this.cargandoHistorial.set(true);
    const miSecuencia = ++this.secuenciaHistorial;
    const resultado = this.esSupabase ? await this.cargarHistorialSupabase() : await this.cargarHistorialLocal();
    if (miSecuencia !== this.secuenciaHistorial) return;
    this.historialPagina.set(resultado.filas);
    this.totalHistorialFiltrado.set(resultado.total);
    this.cargandoHistorial.set(false);
  }

  private parametrosHistorial(desde: number, cantidad: number) {
    return {
      p_bodega_id: this.filtroHistorialBodegaId() || null,
      p_desde_fecha: this.filtroHistorialDesde() || null,
      p_hasta_fecha: this.filtroHistorialHasta() || null,
      p_desde: desde,
      p_cantidad: cantidad,
    };
  }

  private mapearFilaHistorial(f: Record<string, unknown>): FilaHistorialConteo {
    return {
      id: Number(f['id']),
      fecha: String(f['fecha']),
      bodegaId: Number(f['bodega_id']),
      bodegaNombre: String(f['bodega_nombre'] ?? ''),
      usuarioNombre: String(f['usuario_nombre'] ?? '') || '—',
      totalProductos: Number(f['total_productos']) || 0,
      totalDiferencias: Number(f['total_diferencias']) || 0,
      notas: (f['notas'] as string | null) ?? null,
    };
  }

  private async cargarHistorialSupabase(): Promise<{ filas: FilaHistorialConteo[]; total: number }> {
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActualHistorial() - 1) * tamanio;
    const { data, error } = await this.sb!.schema('inventario').rpc('fn_conteo_fisico_historial', this.parametrosHistorial(desde, tamanio));
    if (error) return { filas: [], total: 0 };
    const filas = (data ?? []) as Record<string, unknown>[];
    return { filas: filas.map((f) => this.mapearFilaHistorial(f)), total: Number(filas[0]?.['total'] ?? 0) };
  }

  private historialFilasLocalFiltradas(): FilaHistorialConteo[] {
    const bodegaId = this.filtroHistorialBodegaId();
    const desde = this.filtroHistorialDesde();
    const hasta = this.filtroHistorialHasta();
    return this.conteosLocal
      .map((c) => ({
        id: c.id,
        fecha: c.fecha,
        bodegaId: c.bodegaId,
        bodegaNombre: this.nombreBodega(c.bodegaId),
        usuarioNombre: this.nombreUsuarioLocal(c.usuarioId),
        totalProductos: c.totalProductos,
        totalDiferencias: c.totalDiferencias,
        notas: c.notas,
      }))
      .filter((f) => {
        if (bodegaId && f.bodegaId !== bodegaId) return false;
        if (desde && f.fecha.slice(0, 10) < desde) return false;
        if (hasta && f.fecha.slice(0, 10) > hasta) return false;
        return true;
      })
      .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id);
  }

  private async cargarHistorialLocal(): Promise<{ filas: FilaHistorialConteo[]; total: number }> {
    await this.cargarBaseLocal();
    const todas = this.historialFilasLocalFiltradas();
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActualHistorial() - 1) * tamanio;
    return { filas: todas.slice(desde, desde + tamanio), total: todas.length };
  }

  // ── "Ver detalle" — SOLO la sesión elegida, nunca junto al listado ──────
  protected readonly detalleAbiertoId = signal<number | null>(null);
  protected readonly detalleAbierto = signal<FilaDetalleHistorial[]>([]);
  protected readonly cargandoDetalle = signal(false);

  async toggleDetalle(conteoId: number): Promise<void> {
    if (this.detalleAbiertoId() === conteoId) {
      this.detalleAbiertoId.set(null);
      this.detalleAbierto.set([]);
      return;
    }
    this.detalleAbiertoId.set(conteoId);
    this.cargandoDetalle.set(true);
    const filas = this.esSupabase ? await this.cargarDetalleSupabase(conteoId) : await this.cargarDetalleLocal(conteoId);
    this.cargandoDetalle.set(false);
    // Si mientras cargaba se cerró o se abrió otra, no pisar esa decisión.
    if (this.detalleAbiertoId() !== conteoId) return;
    this.detalleAbierto.set(filas);
  }

  private async cargarDetalleSupabase(conteoId: number): Promise<FilaDetalleHistorial[]> {
    const { data, error } = await this.sb!.schema('inventario').rpc('fn_conteo_fisico_detalle', { p_conteo_fisico_id: conteoId });
    if (error) return [];
    return ((data ?? []) as Record<string, unknown>[]).map((f) => ({
      productoNombre: String(f['producto_nombre'] ?? '—'),
      sistema: Number(f['sistema']) || 0,
      contado: Number(f['contado']) || 0,
      diferencia: Number(f['diferencia']) || 0,
    }));
  }

  private async cargarDetalleLocal(conteoId: number): Promise<FilaDetalleHistorial[]> {
    const detalles = await firstValueFrom(this.data.list<ConteoFisicoDetalle>('ConteoFisicoDetalle', { conteoFisicoId: conteoId }));
    await this.cargarBaseLocal();
    const productosPorId = new Map(this.productosLocal.map((p) => [p.id, p]));
    return detalles
      .map((d) => ({
        productoNombre: productosPorId.get(d.productoId)?.nombre ?? '—',
        sistema: d.sistema,
        contado: d.contado,
        diferencia: d.diferencia,
      }))
      .sort((a, b) => a.productoNombre.localeCompare(b.productoNombre));
  }

  // ── Exportaciones (respetan Bodega/Desde/Hasta — nunca bajan el
  // historial completo solo para exportarlo, ver movimientos-bodega) ─────
  private columnasExportHistorial() {
    return [
      { clave: 'fecha' as const, etiqueta: 'Fecha' },
      { clave: 'bodegaNombre' as const, etiqueta: 'Bodega' },
      { clave: 'usuarioNombre' as const, etiqueta: 'Usuario' },
      { clave: 'totalProductos' as const, etiqueta: 'Productos contados' },
      { clave: 'totalDiferencias' as const, etiqueta: 'Diferencias' },
      { clave: 'notas' as const, etiqueta: 'Notas' },
    ];
  }

  async exportarCsvHistorial(): Promise<void> {
    const columnas = this.columnasExportHistorial();

    if (!this.esSupabase) {
      await this.cargarBaseLocal();
      const filas = this.historialFilasLocalFiltradas();
      exportarCsv('conteo_fisico.csv', columnas, filas.map((f) => ({ ...f, notas: f.notas ?? '' })));
      return;
    }

    const todas: Record<string, unknown>[] = [];
    let desde = 0;
    let total = Infinity;
    while (desde < total) {
      const { data, error } = await this.sb!.schema('inventario').rpc('fn_conteo_fisico_historial', this.parametrosHistorial(desde, TAMANO_LOTE_EXPORTAR));
      if (error) break;
      const filas = (data ?? []) as Record<string, unknown>[];
      if (filas.length === 0) break;
      total = Number(filas[0]?.['total'] ?? 0);
      for (const f of filas) {
        const fila = this.mapearFilaHistorial(f);
        todas.push({ ...fila, notas: fila.notas ?? '' });
      }
      desde += TAMANO_LOTE_EXPORTAR;
    }
    exportarCsv('conteo_fisico.csv', columnas, todas);
  }

  async exportarPdfHistorial(): Promise<void> {
    let filasListado: FilaHistorialConteo[];
    let totalFiltrado: number;
    if (this.esSupabase) {
      const { data, error } = await this.sb!.schema('inventario').rpc('fn_conteo_fisico_historial', this.parametrosHistorial(0, TOPE_FILAS_PDF));
      const filas = !error ? ((data ?? []) as Record<string, unknown>[]) : [];
      filasListado = filas.map((f) => this.mapearFilaHistorial(f));
      totalFiltrado = Number(filas[0]?.['total'] ?? filasListado.length);
    } else {
      await this.cargarBaseLocal();
      const todas = this.historialFilasLocalFiltradas();
      totalFiltrado = todas.length;
      filasListado = todas.slice(0, TOPE_FILAS_PDF);
    }

    const notaListado =
      totalFiltrado > filasListado.length
        ? `Mostrando los primeros ${filasListado.length} de ${totalFiltrado} conteos filtrados (exporta CSV para el detalle completo).`
        : undefined;

    exportarTablaPdf({
      nombreArchivo: 'conteo_fisico.pdf',
      titulo: 'Historial de conteo físico',
      subtitulo: this.hayFiltrosHistorialActivos() ? 'Con filtros aplicados' : undefined,
      columnas: [
        { etiqueta: 'Fecha', ancho: 32 },
        { etiqueta: 'Bodega', ancho: 36 },
        { etiqueta: 'Usuario', ancho: 40 },
        { etiqueta: 'Productos', ancho: 24 },
        { etiqueta: 'Diferencias', ancho: 26 },
        { etiqueta: 'Notas' },
      ],
      filas: [
        ...(notaListado ? [[notaListado, '', '', '', '', '']] : []),
        ...filasListado.map((f) => [
          new Date(f.fecha).toLocaleString('es-MX'),
          f.bodegaNombre,
          f.usuarioNombre,
          String(f.totalProductos),
          String(f.totalDiferencias),
          f.notas ?? '',
        ]),
      ],
    });
  }

  // ── Catálogos locales (solo IndexedDB) — cargados una sola vez bajo
  // demanda, nunca al abrir la pantalla. ──────────────────────────────────
  private baseLocalCargada = false;
  private productosLocal: Producto[] = [];
  private existenciasBodegaLocal: ExistenciaBodega[] = [];
  private usuariosLocal: Usuario[] = [];
  private conteosLocal: ConteoFisico[] = [];

  private nombreUsuarioLocal(id: number): string {
    const usuario = this.usuariosLocal.find((u) => u.id === id);
    return usuario ? nombreCompletoUsuario(usuario) : '—';
  }

  private async cargarBaseLocal(): Promise<void> {
    if (this.baseLocalCargada) return;
    const [productos, existencias, usuarios, conteos] = await Promise.all([
      firstValueFrom(this.data.list<Producto>('Producto')),
      firstValueFrom(this.data.list<ExistenciaBodega>('ExistenciaBodega')),
      firstValueFrom(this.data.list<Usuario>('Usuario')),
      firstValueFrom(this.data.list<ConteoFisico>('ConteoFisico')),
    ]);
    this.productosLocal = productos;
    this.existenciasBodegaLocal = existencias;
    this.usuariosLocal = usuarios;
    this.conteosLocal = conteos;
    this.baseLocalCargada = true;
  }
}

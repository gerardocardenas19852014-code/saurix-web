import { ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output, ViewChild, computed, inject, signal } from '@angular/core';
import { EscaneoGlobalService } from '../../../../shared/services/escaneo-global.service';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../../core/services/data-client.service';
import { SupabaseService } from '../../../../core/services/supabase.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { SelectBuscableComponent, OpcionBuscable } from '../../../../shared/components/select-buscable/select-buscable.component';
import { EscaneoCodigoComponent } from '../../../../shared/components/escaneo-codigo/escaneo-codigo.component';
import { Producto } from '../../productos/producto.model';
import { Bodega } from '../../bodegas/bodega.model';
import { ExistenciaBodega } from '../existencia-bodega.model';

type TipoMovimientoMasivo = 'entrada' | 'traspaso' | 'salida';
type PasoMasivo = 'captura' | 'revision' | 'confirmacion';

/** Una fila de la tabla editable — "existenciaActual" siempre se refiere a
 *  la bodega "correspondiente" según el tipo (ver bodegaRelevanteId()):
 *  origen para Traspaso/Salida (el lado que se descuenta, el que puede
 *  quedarse sin stock) y destino para Entrada (su único lado). */
interface FilaMasiva {
  productoId: number;
  codigo: string;
  nombre: string;
  fotoThumbUrl: string | null;
  existenciaActual: number;
  cantidadTexto: string;
}

interface InfoProductoBusqueda {
  id: number;
  codigo: string;
  nombre: string;
  fotoThumbUrl: string | null;
}

interface ResultadoConfirmacion {
  exito: boolean;
  mensaje: string;
}

/** Mismo tope que valida inventario.fn_movimiento_masivo_registrar — se
 *  repite aquí para avisar ANTES del viaje de red, no solo después de que
 *  el servidor lo rechace. */
const TOPE_LINEAS_MAXIMO = 10000;
/** Puramente informativo (sección 7 del mandato: "si existe un límite
 *  operativo real, comunicarlo antes de confirmar") — no bloquea, solo
 *  sugiere dividir la operación; no hay evidencia todavía de un límite real
 *  de rendimiento más estricto que éste. */
const TOPE_LINEAS_ADVERTENCIA = 500;

/**
 * "Movimiento masivo" de Movimientos entre bodegas — registra en una sola
 * operación Entrada/Traspaso/Salida-Ajuste de muchos productos a la vez
 * (nació de una necesidad real: asignar existencia inicial a 28 productos
 * uno por uno era demasiado lento). Vive como pantalla ancha integrada en
 * el mismo módulo (ver vistaMasiva() en movimientos-bodega.component.ts),
 * NUNCA en un modal pequeño — el formulario individual (modal "Nuevo
 * movimiento") sigue existiendo sin cambios para una sola línea.
 *
 * Reutiliza al máximo infraestructura ya homologada en vez de reconstruirla:
 * - Catálogo de bodegas: lo pasa el padre (@Input bodegas), ya cargado ahí.
 * - Autocomplete por nombre: inventario.fn_productos_autocomplete (la misma
 *   RPC que ya usaba el modal individual y el filtro de Historial — se le
 *   agregó foto_thumb_url, cambio aditivo, para la miniatura de la tabla).
 * - Código exacto (teclado/escáner): mismo patrón que
 *   MovimientosBodegaComponent.seleccionarPorCodigo() — listarPagina()
 *   acotado por código, nunca el catálogo completo.
 * - "Agregar producto repetido": mismo criterio que
 *   OrdenesCompraComponent.agregarProductoALaOrden() — acumula cantidad en
 *   la fila existente en vez de crear una duplicada.
 * - Existencia por bodega para las filas visibles: una sola consulta
 *   agrupada (ExistenciaBodega filtrada por productoId IN [...] + bodegaId),
 *   igual que el patrón ya usado en Cobro — nunca una petición por producto.
 * - Registro atómico: RPC nueva inventario.fn_movimiento_masivo_registrar
 *   (ver migración movimiento_masivo_rpc) — una sola transacción de
 *   Postgres para todas las líneas, con idempotencia por operacion_id.
 */
@Component({
  selector: 'app-movimiento-masivo',
  standalone: true,
  imports: [SelectBuscableComponent, EscaneoCodigoComponent],
  templateUrl: './movimiento-masivo.component.html',
  styleUrl: './movimiento-masivo.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MovimientoMasivoComponent implements OnInit, OnDestroy {
  @Input({ required: true }) bodegas: Bodega[] = [];
  /** El usuario cerró la pantalla sin terminar (botón Cancelar en Captura). */
  @Output() readonly cancelar = new EventEmitter<void>();
  /** La operación se registró con éxito y el usuario presionó Finalizar —
   *  el padre debe refrescar existencia/historial/sin-asignar. */
  @Output() readonly completado = new EventEmitter<void>();

  private readonly data = inject(DataClientService);
  private readonly sb = inject(SupabaseService).cliente;
  protected readonly toast = inject(ToastService);
  private readonly escaneoGlobal = inject(EscaneoGlobalService);
  private detenerEscaneoGlobal: (() => void) | null = null;

  ngOnInit(): void {
    this.detenerEscaneoGlobal = this.escaneoGlobal.activar({
      habilitado: () => this.paso() === 'captura',
      alDetectar: (codigo) => this.agregarPorCodigo(codigo),
    });
  }

  ngOnDestroy(): void {
    this.detenerEscaneoGlobal?.();
  }

  @ViewChild('escaneoCodigoBarra') private escaneoCodigoBarra?: EscaneoCodigoComponent;

  protected readonly opcionesBodega = computed<OpcionBuscable[]>(() => this.bodegas.map((b) => ({ valor: b.id, etiqueta: b.nombre })));

  protected readonly paso = signal<PasoMasivo>('captura');
  protected readonly tipo = signal<TipoMovimientoMasivo>('entrada');
  protected readonly bodegaOrigenId = signal(0);
  protected readonly bodegaDestinoId = signal(0);
  protected readonly enTransito = signal(false);
  protected readonly nota = signal('');

  protected readonly filas = signal<FilaMasiva[]>([]);
  protected readonly totalProductos = computed(() => this.filas().length);
  protected readonly totalUnidades = computed(() => this.filas().reduce((acc, f) => acc + (Number(f.cantidadTexto) || 0), 0));

  /** true si alguna fila pide más de lo disponible en la bodega relevante —
   *  Traspaso/Salida solamente (Entrada no tiene de dónde quedarse sin
   *  stock). Puramente informativo en Captura/Revisión: la validación
   *  definitiva ocurre en Postgres al confirmar (ver confirmar()). */
  protected readonly hayAdvertenciasStock = computed(
    () => this.tipo() !== 'entrada' && this.filas().some((f) => (Number(f.cantidadTexto) || 0) > f.existenciaActual),
  );

  protected readonly nombreBodegaOrigen = computed(() => this.bodegas.find((b) => b.id === this.bodegaOrigenId())?.nombre ?? '—');
  protected readonly nombreBodegaDestino = computed(() => this.bodegas.find((b) => b.id === this.bodegaDestinoId())?.nombre ?? '—');

  // ── Barra de captura (código/escaneo + autocomplete por nombre + cantidad) ─
  protected readonly cantidadCapturaTexto = signal('1');
  protected readonly productoSeleccionadoId = signal<number | null>(null);
  private productoSeleccionadoInfo: InfoProductoBusqueda | null = null;
  private resultadosAutocompleteActual: InfoProductoBusqueda[] = [];

  protected readonly confirmando = signal(false);
  protected readonly resultadoConfirmacion = signal<ResultadoConfirmacion | null>(null);
  /** Un solo UUID por "viaje" a Revisión/Confirmación — se reutiliza en
   *  cada reintento de ESA misma operación (ver confirmar()) y solo se
   *  genera uno nuevo al entrar de nuevo a Revisión desde Captura, para que
   *  un doble clic o un reintento tras una red caída nunca registre dos
   *  veces (ver inventario.fn_movimiento_masivo_registrar). */
  private operacionId: string | null = null;

  // ── Tipo de movimiento ──────────────────────────────────────────────────
  seleccionarTipo(tipo: TipoMovimientoMasivo): void {
    if (this.tipo() === tipo) return;
    this.tipo.set(tipo);
    this.refrescarExistenciasVisibles();
  }

  /** La bodega contra la que se muestra/evalúa "Existencia actual": origen
   *  para Traspaso/Salida, destino para Entrada — ver comentario de
   *  FilaMasiva. */
  private bodegaRelevanteId(): number {
    return this.tipo() === 'entrada' ? this.bodegaDestinoId() : this.bodegaOrigenId();
  }

  cambiarBodegaOrigen(id: number | string | null): void {
    const nuevo = Number(id) || 0;
    if (this.tipo() === 'traspaso' && nuevo === this.bodegaDestinoId() && nuevo !== 0) {
      this.toast.advertencia('La bodega de origen y destino no pueden ser la misma.');
      return;
    }
    this.bodegaOrigenId.set(nuevo);
    this.refrescarExistenciasVisibles();
  }

  cambiarBodegaDestino(id: number | string | null): void {
    const nuevo = Number(id) || 0;
    if (this.tipo() === 'traspaso' && nuevo === this.bodegaOrigenId() && nuevo !== 0) {
      this.toast.advertencia('La bodega de origen y destino no pueden ser la misma.');
      return;
    }
    this.bodegaDestinoId.set(nuevo);
    this.refrescarExistenciasVisibles();
  }

  /** Única consulta agrupada (producto_id IN [...] + bodega_id = X) para
   *  refrescar "Existencia actual" de TODAS las filas visibles — nunca una
   *  petición por producto (sección 7 del mandato: evitar N+1). Se llama al
   *  cambiar de bodega/tipo y después de agregar un producto nuevo. */
  private async refrescarExistenciasVisibles(): Promise<void> {
    const bodegaId = this.bodegaRelevanteId();
    const ids = this.filas().map((f) => f.productoId);
    if (!bodegaId || ids.length === 0) {
      if (!bodegaId) this.filas.update((filas) => filas.map((f) => ({ ...f, existenciaActual: 0 })));
      return;
    }
    const existencias = await firstValueFrom(
      this.data.list<ExistenciaBodega>('ExistenciaBodega', { productoId: ids, bodegaId }),
    );
    const mapa = new Map(existencias.map((e) => [e.productoId, e.existencia]));
    this.filas.update((filas) => filas.map((f) => ({ ...f, existenciaActual: mapa.get(f.productoId) ?? 0 })));
  }

  // ── Búsqueda por nombre (autocomplete remoto, server-side, debounce 300ms
  // — mismo patrón ya usado en esta misma pantalla para el modal individual
  // y el filtro de Historial) ──────────────────────────────────────────────
  protected buscarProductoAutocomplete = async (texto: string): Promise<OpcionBuscable[]> => {
    const { data, error } = await this.sb.schema('inventario').rpc('fn_productos_autocomplete', {
      p_busqueda: texto || null,
      p_limite: 15,
    });
    if (error) return [];
    const resultados = ((data ?? []) as Record<string, unknown>[]).map((f) => ({
      id: Number(f['id']),
      codigo: String(f['codigo'] ?? ''),
      nombre: String(f['nombre'] ?? ''),
      fotoThumbUrl: f['foto_thumb_url'] != null ? String(f['foto_thumb_url']) : null,
    }));
    this.resultadosAutocompleteActual = resultados;
    return resultados.map((r) => ({ valor: r.id, etiqueta: r.codigo ? `${r.codigo} — ${r.nombre}` : r.nombre }));
  };

  protected onSeleccionarProductoAutocomplete(id: number | string | null): void {
    if (id == null) {
      this.productoSeleccionadoId.set(null);
      this.productoSeleccionadoInfo = null;
      return;
    }
    const encontrado = this.resultadosAutocompleteActual.find((r) => r.id === Number(id));
    this.productoSeleccionadoId.set(encontrado ? encontrado.id : null);
    this.productoSeleccionadoInfo = encontrado ?? null;
  }

  protected agregarDesdeBarra(): void {
    if (!this.productoSeleccionadoInfo) return;
    this.agregarProductoALaLista(this.productoSeleccionadoInfo);
  }

  /** Código exacto (teclado + Enter, o escáner USB/Bluetooth/cámara vía
   *  app-escaneo-codigo) — mismo patrón que
   *  MovimientosBodegaComponent.seleccionarPorCodigo(): consulta puntual,
   *  nunca el catálogo completo. A diferencia de esa función (que solo
   *  selecciona un campo), aquí agrega directo a la tabla. */
  async agregarPorCodigo(codigoCrudo: string): Promise<void> {
    const codigo = codigoCrudo.trim();
    if (!codigo) return;
    const { filas } = await firstValueFrom(this.data.listarPagina<Producto>('Producto', { codigo, activo: true }, 0, 5));
    const encontrado = filas.find((p) => (p.codigo ?? '').trim().toLowerCase() === codigo.toLowerCase());
    if (!encontrado) {
      this.toast.advertencia(`No se encontró ningún producto activo con el código "${codigo}".`);
      return;
    }
    if (encontrado.existencia === null) {
      this.toast.advertencia(`"${encontrado.nombre}" es un servicio — no maneja existencia por bodega.`);
      return;
    }
    this.agregarProductoALaLista({ id: encontrado.id, codigo: encontrado.codigo ?? '', nombre: encontrado.nombre, fotoThumbUrl: null });
    this.escaneoCodigoBarra?.limpiarTexto();
  }

  /** Núcleo común de "agregar un producto" (código exacto o autocomplete) —
   *  mismo criterio que OrdenesCompraComponent.agregarProductoALaOrden():
   *  si el producto YA está en la tabla, se le ACUMULA la cantidad en vez
   *  de crear una fila duplicada (sección 4 del mandato: "no crear dos
   *  movimientos involuntarios para el mismo producto"). */
  private agregarProductoALaLista(info: InfoProductoBusqueda): void {
    if (this.filas().length >= TOPE_LINEAS_MAXIMO) {
      this.toast.advertencia(`Esta operación ya tiene ${TOPE_LINEAS_MAXIMO.toLocaleString('es-MX')} productos — es el máximo por operación. Confirma esta y empieza una nueva.`);
      return;
    }
    const cantidadCapturada = Math.max(1, Number(this.cantidadCapturaTexto()) || 1);
    const indiceExistente = this.filas().findIndex((f) => f.productoId === info.id);
    if (indiceExistente >= 0) {
      const actual = this.filas()[indiceExistente];
      const nuevaCantidad = (Number(actual.cantidadTexto) || 0) + cantidadCapturada;
      this.cambiarCantidad(indiceExistente, String(nuevaCantidad));
      this.toast.info(`${info.nombre} — cantidad actualizada a ${nuevaCantidad}.`);
    } else {
      this.filas.update((filas) => [
        ...filas,
        {
          productoId: info.id,
          codigo: info.codigo,
          nombre: info.nombre,
          fotoThumbUrl: info.fotoThumbUrl,
          existenciaActual: 0,
          cantidadTexto: String(cantidadCapturada),
        },
      ]);
      this.toast.info(`${info.nombre} agregado.`);
      this.refrescarExistenciaUnaFila(info.id);
    }
    this.limpiarBarraCaptura();
  }

  private async refrescarExistenciaUnaFila(productoId: number): Promise<void> {
    const bodegaId = this.bodegaRelevanteId();
    if (!bodegaId) return;
    const existencias = await firstValueFrom(this.data.list<ExistenciaBodega>('ExistenciaBodega', { productoId, bodegaId }));
    const existencia = existencias[0]?.existencia ?? 0;
    this.filas.update((filas) => filas.map((f) => (f.productoId === productoId ? { ...f, existenciaActual: existencia } : f)));
  }

  private limpiarBarraCaptura(): void {
    this.cantidadCapturaTexto.set('1');
    this.productoSeleccionadoId.set(null);
    this.productoSeleccionadoInfo = null;
    this.escaneoCodigoBarra?.enfocar();
  }

  cambiarCantidad(index: number, texto: string): void {
    this.filas.update((filas) => filas.map((f, i) => (i === index ? { ...f, cantidadTexto: texto } : f)));
  }

  quitarFila(index: number): void {
    this.filas.update((filas) => filas.filter((_, i) => i !== index));
  }

  // ── Validación de Paso 1 → Paso 2 ───────────────────────────────────────
  protected readonly erroresCaptura = computed<string[]>(() => {
    const errores: string[] = [];
    if (this.tipo() === 'entrada' && !this.bodegaDestinoId()) errores.push('Elige la bodega de destino.');
    if (this.tipo() !== 'entrada' && !this.bodegaOrigenId()) errores.push('Elige la bodega de origen.');
    if (this.tipo() === 'traspaso' && !this.bodegaDestinoId()) errores.push('Elige la bodega de destino.');
    if (this.tipo() === 'traspaso' && this.bodegaOrigenId() && this.bodegaOrigenId() === this.bodegaDestinoId()) {
      errores.push('La bodega de origen y destino no pueden ser la misma.');
    }
    if (this.filas().length === 0) errores.push('Agrega al menos un producto.');
    if (this.filas().some((f) => !(Number(f.cantidadTexto) > 0))) errores.push('Hay productos con cantidad inválida (debe ser mayor a cero).');
    return errores;
  });

  irARevision(): void {
    const errores = this.erroresCaptura();
    if (errores.length > 0) {
      this.toast.advertencia(errores[0]);
      return;
    }
    if (this.filas().length > TOPE_LINEAS_ADVERTENCIA) {
      this.toast.info(`Operación grande (${this.filas().length} productos) — puede tardar unos segundos al confirmar.`);
    }
    this.operacionId = crypto.randomUUID(); // una sola vez por "viaje" a Revisión -- ver comentario de la propiedad.
    this.resultadoConfirmacion.set(null);
    this.refrescarExistenciasVisibles(); // snapshot fresco, no el que quedó de cuando se capturó cada fila.
    this.paso.set('revision');
  }

  volverACaptura(): void {
    this.paso.set('captura');
  }

  // ── Paso 3 — Confirmación ───────────────────────────────────────────────
  async confirmar(): Promise<void> {
    if (this.confirmando()) return; // doble clic/Enter repetido -- necesario pero no suficiente (ver operacionId).
    if (!this.operacionId) this.operacionId = crypto.randomUUID();

    this.confirmando.set(true);
    this.paso.set('confirmacion');
    this.resultadoConfirmacion.set(null);

    const lineas = this.filas().map((f) => ({ producto_id: f.productoId, cantidad: Number(f.cantidadTexto) || 0 }));

    try {
      const { data, error } = await this.sb.schema('inventario').rpc('fn_movimiento_masivo_registrar', {
        p_tipo: this.tipo(),
        p_bodega_origen_id: this.tipo() === 'entrada' ? null : this.bodegaOrigenId(),
        p_bodega_destino_id: this.tipo() === 'salida' ? null : this.bodegaDestinoId(),
        p_en_transito: this.tipo() === 'traspaso' && this.enTransito(),
        p_nota: this.nota().trim() || null,
        p_lineas: lineas,
        p_operacion_id: this.operacionId,
      });

      if (error) throw error;

      const resultado = data as { duplicada: boolean; movimientos_registrados: number };
      const mensaje = resultado.duplicada
        ? `Esta operación ya se había registrado (${resultado.movimientos_registrados} movimientos) — no se volvió a aplicar.`
        : `${resultado.movimientos_registrados} movimiento${resultado.movimientos_registrados === 1 ? '' : 's'} registrado${resultado.movimientos_registrados === 1 ? '' : 's'} correctamente.`;
      this.resultadoConfirmacion.set({ exito: true, mensaje });
    } catch (error) {
      // Nunca se muestra éxito si Postgres no confirmó -- el operacionId NO
      // se regenera aquí a propósito: un "Reintentar" manda la MISMA
      // operación (ver plantilla), nunca una nueva.
      this.resultadoConfirmacion.set({ exito: false, mensaje: (error as Error)?.message ?? 'No se pudo registrar la operación.' });
    } finally {
      this.confirmando.set(false);
    }
  }

  reintentar(): void {
    this.confirmar();
  }

  volverARevisionDesdeError(): void {
    this.paso.set('revision');
    this.resultadoConfirmacion.set(null);
  }

  finalizar(): void {
    this.completado.emit();
  }

  cancelarDesdeCaptura(): void {
    this.cancelar.emit();
  }
}

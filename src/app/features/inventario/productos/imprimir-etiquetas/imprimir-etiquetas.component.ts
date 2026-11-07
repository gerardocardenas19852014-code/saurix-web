import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DataClientService, FILTRO_BUSQUEDA } from '../../../../core/services/data-client.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { SelectBuscableComponent, OpcionBuscable } from '../../../../shared/components/select-buscable/select-buscable.component';
import { Producto } from '../producto.model';
import { CategoriaProducto } from '../../categorias-producto/categoria-producto.model';
import { formatMoneda } from '../producto.util';
import { ConfiguracionImpresionEtiquetasComponent, ProductoParaImprimir } from './configuracion-impresion-etiquetas.component';

/** Solo los campos que esta pantalla necesita mostrar/imprimir — nunca el
 *  Producto completo (evita acarrear campos irrelevantes como descripcion,
 *  factorConversionCompra, etc. en el caché de "productos vistos"). */
interface FilaEtiqueta {
  id: number;
  codigo: string | null;
  nombre: string;
  categoriaProductoId: number;
  precioUnitario: number;
}

type ModoSeleccion = 'ninguno' | 'ids' | 'todos-filtrados';


/** Filtro de búsqueda congelado en el momento de "Seleccionar todos los
 *  resultados" — ver comentario de clase, sección "SEMÁNTICA DE SELECCIÓN
 *  GLOBAL". */
interface FiltroCongelado {
  texto: string;
  categoriaId: number;
}

const TAMANO_PAGINA = 30;
/** Tope de productos que "Seleccionar todos los resultados" puede resolver
 *  en servidor al confirmar la impresión — evita materializar una selección
 *  de 50,000+ productos de un jalón. Si el filtro trae más que esto, se
 *  avisa y se pide acotar el filtro (sección 7 del mandato: "informar al
 *  usuario antes de imprimir y ofrecer dividir la operación"). Valor
 *  elegido por ser generoso para el caso real (catálogos de cientos a pocos
 *  miles de SKUs por categoría), no por evidencia de un límite medido. */
const TOPE_RESOLUCION_SELECCION_GLOBAL = 2000;
/** Tope de ETIQUETAS totales (productos × copias) materializables en una
 *  sola impresión — protege contra un numero de copias global alto
 *  combinado con una selección grande (p.ej. 2000 productos × 50 copias).
 *  Mismo criterio de "límite de seguridad razonable" pedido en el mandato,
 *  no una regla de negocio nueva. */
const TOPE_ETIQUETAS_IMPRESION = 1000;
/** Tope de copias para UN solo producto — protege contra un error de
 *  tecleo (p.ej. "2000000"). */
const TOPE_COPIAS_POR_PRODUCTO = 200;

/**
 * "Imprimir etiquetas" — homologación integral (nov-2026, ver claude/
 * imprimir-etiquetas-homologacion-2026-11.md para el reporte completo).
 * Extraído de ProductosComponent (antes vivía como modal angosto embebido
 * ahí) a su propio componente standalone: el padre solo controla si está
 * abierto (igual que ya hace con MovimientoMasivoComponent en
 * Movimientos entre bodegas) y le pasa el catálogo de categorías, ya
 * cargado ahí mismo.
 *
 * AUDITORÍA (antes de tocar nada): el modal YA hacía búsqueda server-side
 * (listarPagina(), nunca el catálogo completo) y YA abría sin ningún
 * producto preseleccionado — ninguno de los dos se cambió, solo se
 * reforzó/documentó. Lo que SÍ era nuevo: selección masiva por
 * página/categoría/resultados filtrados, copias globales con excepciones,
 * paginación real (antes era una ventana fija de 200 resultados), filtro
 * por categoría, y la homologación visual (modal angosto → amplio,
 * acciones duplicadas arriba/abajo → una sola zona). La impresión en sí
 * (iframe oculto + JsBarcode CODE128 en SVG + el layout/tamaño de la
 * etiqueta) NO se tocó — ver imprimir(), copiada tal cual de
 * ProductosComponent.imprimirEtiquetas(), con una sola optimización real:
 * el código de barras de un producto con N copias ya no se dibuja N veces
 * (ver el caché `cacheBarras`/`svgDe()` dentro de imprimir()).
 *
 * SEMÁNTICA DE SELECCIÓN GLOBAL ("Seleccionar todos los resultados"):
 * nunca se enumeran en el navegador los ids de los productos que cumplen el
 * filtro (podrían ser miles) — en vez de eso, se "congela" el filtro activo
 * en ese momento (filtroCongelado) junto con el total que reportó el
 * servidor (totalCongelado). Un producto está seleccionado si: (a) el
 * usuario lo agregó explícitamente como "extra" (idsIncluidos, para un
 * producto que NO cumple filtroCongelado — p.ej. el usuario cambió de
 * filtro después y marcó algo nuevo a mano) y no lo ha quitado; o (b) SÍ
 * cumple filtroCongelado y no está en idsExcluidos (lo quitó a mano después
 * de seleccionar todos). Cambiar la búsqueda/categoría DESPUÉS de
 * "seleccionar todos" nunca amplía la selección por sí solo — los
 * checkboxes de productos que no estaban en el filtro original aparecen
 * SIN marcar hasta que el usuario los marque a mano (eso sí los agrega,
 * como "extra"). "Limpiar selección" vuelve todo a 'ninguno' sin tocar la
 * búsqueda/categoría activas. Al confirmar la impresión con este modo
 * activo, se vuelve a consultar el servidor con filtroCongelado (acotado a
 * TOPE_RESOLUCION_SELECCION_GLOBAL) para resolver la lista real — así
 * cualquier producto borrado/dado de baja/cambiado de empresa mientras
 * tanto queda fuera automáticamente (RLS + el propio filtro "activo").
 *
 * FORMATO DE ETIQUETA (código de barras / QR): el QR codifica EXACTAMENTE
 * el mismo identificador que ya usa el código de barras (`producto.codigo`,
 * p.ej. "SKU-001") -- nada más. Se auditó explícitamente que esto no puede
 * confundirse con el QR de pedidos de la Tienda pública: Cobro distingue un
 * pedido por el prefijo `/^SAURIX:ORDER:[0-9a-f]{32}$/i` (ver
 * `extraerTokenOrdenSaurix` en cobro.component.ts) y Movimientos entre
 * bodegas no tiene ninguna lógica de pedidos -- un código de producto
 * plano como "SKU-001" jamás calza con ese patrón.
 *
 * VENTANA DE CONFIGURACIÓN DE IMPRESIÓN (nov-2026, "Optimización de
 * impresión de etiquetas"): al confirmar la impresión, este componente ya
 * NO imprime directamente -- resuelve la lista real de productos (igual
 * que siempre) y se la pasa a ConfiguracionImpresionEtiquetasComponent
 * (pasoConfiguracion()), que es quien ahora elige papel/tamaño/tipo de
 * código/distribución/información a mostrar, con vista previa, y hace la
 * impresión real. El selector de formato (barras/QR) y la vista previa de
 * un solo producto que vivían aquí se MOVIERON a esa ventana (ahora es ahí
 * donde se elige el tipo de código, junto con el resto de las opciones de
 * impresión) -- este componente ya no genera ningún SVG ni HTML de
 * impresión. La selección/paginación/copias de abajo no cambiaron en nada.
 */
@Component({
  selector: 'app-imprimir-etiquetas',
  standalone: true,
  imports: [SelectBuscableComponent, ConfiguracionImpresionEtiquetasComponent],
  templateUrl: './imprimir-etiquetas.component.html',
  styleUrl: './imprimir-etiquetas.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImprimirEtiquetasComponent {
  @Input({ required: true }) categorias: CategoriaProducto[] = [];
  @Output() readonly cerrar = new EventEmitter<void>();

  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);

  protected readonly categoriasOpciones = computed<OpcionBuscable[]>(() =>
    this.categorias.filter((c) => c.activo !== false).map((c) => ({ valor: c.id, etiqueta: c.nombre })),
  );

  protected nombreCategoria(id: number): string {
    return this.categorias.find((c) => c.id === id)?.nombre ?? '—';
  }
  protected formatMoneda = formatMoneda;

  // ── Búsqueda + filtro + paginación server-side ──────────────────────────
  protected readonly busqueda = signal('');
  protected readonly categoriaId = signal(0);
  protected readonly pagina = signal(1);
  protected readonly cargando = signal(false);
  protected readonly filas = signal<FilaEtiqueta[]>([]);
  protected readonly totalFiltrado = signal(0);
  protected readonly totalPaginas = computed(() => Math.max(1, Math.ceil(this.totalFiltrado() / TAMANO_PAGINA)));

  private debounceHandle: ReturnType<typeof setTimeout> | null = null;
  private secuenciaBusqueda = 0;

  /** Caché de toda fila vista en esta sesión del modal (cualquier página,
   *  cualquier búsqueda) — mismo patrón que `productosConocidos` en
   *  cobro.component.ts. Nunca se vacía mientras el modal está abierto;
   *  permite resolver los datos completos de un producto "extra" (ver
   *  comentario de clase) sin volver a pedirlo al servidor. */
  private readonly productosVistos = new Map<number, FilaEtiqueta>();

  constructor() {
    this.buscar();
  }

  protected onBuscarInput(texto: string): void {
    this.busqueda.set(texto);
    if (this.debounceHandle) clearTimeout(this.debounceHandle);
    this.debounceHandle = setTimeout(() => {
      this.pagina.set(1);
      this.buscar();
    }, 300);
  }

  protected onCambiarCategoria(id: number | string | null): void {
    this.categoriaId.set(Number(id) || 0);
    this.pagina.set(1);
    this.buscar();
  }

  protected irAPaginaAnterior(): void {
    if (this.pagina() <= 1) return;
    this.pagina.update((p) => p - 1);
    this.buscar();
  }

  protected irAPaginaSiguiente(): void {
    if (this.pagina() >= this.totalPaginas()) return;
    this.pagina.update((p) => p + 1);
    this.buscar();
  }

  /** Única función que consulta Producto — nombre/código (OR, vía
   *  FILTRO_BUSQUEDA) + categoría, todo del lado del servidor
   *  (listarPagina, misma infraestructura ya usada en Cobro), nunca
   *  descargando el catálogo completo. La tabla visible nunca se vacía
   *  mientras llega una página nueva (solo cambia cuando la respuesta
   *  realmente llega) — así paginar/filtrar no parpadea a vacío. */
  private buscar(): void {
    const miSecuencia = ++this.secuenciaBusqueda;
    this.cargando.set(true);
    const desde = (this.pagina() - 1) * TAMANO_PAGINA;
    const texto = this.busqueda().trim();
    const filtro: Record<string, unknown> = { activo: true };
    if (this.categoriaId()) filtro['categoriaProductoId'] = this.categoriaId();
    if (texto) filtro[FILTRO_BUSQUEDA] = { columnas: ['nombre', 'codigo'], texto };

    this.data.listarPagina<Producto>('Producto', filtro, desde, TAMANO_PAGINA, { columna: 'nombre' }).subscribe({
      next: ({ filas, total }) => {
        if (miSecuencia !== this.secuenciaBusqueda) return; // respuesta vieja, se descarta
        const mapeadas = filas.map((p) => this.aFila(p));
        for (const f of mapeadas) this.productosVistos.set(f.id, f);
        this.filas.set(mapeadas);
        this.totalFiltrado.set(total);
        this.cargando.set(false);
      },
      error: () => {
        if (miSecuencia !== this.secuenciaBusqueda) return;
        this.cargando.set(false);
        this.toast.error('No se pudo buscar productos.');
      },
    });
  }

  private aFila(p: Producto): FilaEtiqueta {
    return { id: p.id, codigo: p.codigo, nombre: p.nombre, categoriaProductoId: p.categoriaProductoId, precioUnitario: p.precioUnitario };
  }

  // ── Selección (ver semántica completa en el comentario de clase) ───────
  protected readonly modoSeleccion = signal<ModoSeleccion>('ninguno');
  /** modo 'ids': TODA la selección. modo 'todos-filtrados': solo los
   *  productos "extra" agregados a mano que NO cumplen filtroCongelado. */
  private readonly idsIncluidos = signal<Set<number>>(new Set());
  /** Solo tiene sentido en modo 'todos-filtrados': productos que SÍ cumplen
   *  filtroCongelado pero el usuario quitó a mano. */
  private readonly idsExcluidos = signal<Set<number>>(new Set());
  private readonly filtroCongelado = signal<FiltroCongelado | null>(null);
  private readonly totalCongelado = signal(0);

  protected readonly etiquetaFiltroCongelado = computed(() => {
    const f = this.filtroCongelado();
    if (!f) return '';
    const partes: string[] = [];
    if (f.texto) partes.push(`"${f.texto}"`);
    if (f.categoriaId) partes.push(this.nombreCategoria(f.categoriaId));
    return partes.length > 0 ? partes.join(' · ') : 'todos los productos';
  });

  private filaCumpleFiltroCongelado(fila: FilaEtiqueta, filtro: FiltroCongelado): boolean {
    if (filtro.categoriaId && fila.categoriaProductoId !== filtro.categoriaId) return false;
    if (filtro.texto) {
      const t = filtro.texto.toLowerCase();
      const enNombre = fila.nombre.toLowerCase().includes(t);
      const enCodigo = (fila.codigo ?? '').toLowerCase().includes(t);
      if (!enNombre && !enCodigo) return false;
    }
    return true;
  }

  estaSeleccionado(id: number): boolean {
    const modo = this.modoSeleccion();
    if (modo === 'ninguno') return false;
    if (modo === 'ids') return this.idsIncluidos().has(id);
    // 'todos-filtrados'
    if (this.idsIncluidos().has(id)) return true; // extra agregado a mano
    if (this.idsExcluidos().has(id)) return false; // quitado a mano
    const fila = this.productosVistos.get(id);
    const congelado = this.filtroCongelado();
    return !!fila && !!congelado && this.filaCumpleFiltroCongelado(fila, congelado);
  }

  toggleSeleccion(fila: FilaEtiqueta): void {
    if (!fila.codigo) return; // sin código no es elegible -- mismo criterio de siempre.
    const modo = this.modoSeleccion();
    if (modo === 'ninguno') {
      this.modoSeleccion.set('ids');
      this.idsIncluidos.set(new Set([fila.id]));
      return;
    }
    if (modo === 'ids') {
      this.idsIncluidos.update((actual) => {
        const nuevo = new Set(actual);
        if (nuevo.has(fila.id)) nuevo.delete(fila.id);
        else nuevo.add(fila.id);
        return nuevo;
      });
      return;
    }
    // 'todos-filtrados'
    const congelado = this.filtroCongelado();
    const cumpleCongelado = !!congelado && this.filaCumpleFiltroCongelado(fila, congelado);
    const yaSeleccionado = this.estaSeleccionado(fila.id);
    if (yaSeleccionado) {
      if (this.idsIncluidos().has(fila.id)) {
        this.idsIncluidos.update((actual) => {
          const nuevo = new Set(actual);
          nuevo.delete(fila.id);
          return nuevo;
        });
      } else if (cumpleCongelado) {
        this.idsExcluidos.update((actual) => new Set(actual).add(fila.id));
      }
    } else if (cumpleCongelado) {
      this.idsExcluidos.update((actual) => {
        const nuevo = new Set(actual);
        nuevo.delete(fila.id);
        return nuevo;
      });
    } else {
      this.idsIncluidos.update((actual) => new Set(actual).add(fila.id));
    }
  }

  /** Tri-estado del checkbox de encabezado — solo sobre las filas
   *  elegibles (con código) de la página VISIBLE. */
  protected readonly estadoCheckPagina = computed<'ninguno' | 'algunos' | 'todos'>(() => {
    const elegibles = this.filas().filter((f) => !!f.codigo);
    if (elegibles.length === 0) return 'ninguno';
    const seleccionados = elegibles.filter((f) => this.estaSeleccionado(f.id));
    if (seleccionados.length === 0) return 'ninguno';
    return seleccionados.length === elegibles.length ? 'todos' : 'algunos';
  });

  toggleSeleccionPagina(): void {
    const elegibles = this.filas().filter((f) => !!f.codigo);
    const marcarTodos = this.estadoCheckPagina() !== 'todos';
    for (const f of elegibles) {
      const yaSeleccionado = this.estaSeleccionado(f.id);
      if (marcarTodos && !yaSeleccionado) this.toggleSeleccion(f);
      else if (!marcarTodos && yaSeleccionado) this.toggleSeleccion(f);
    }
  }

  seleccionarTodosLosResultados(): void {
    if (this.totalFiltrado() === 0) return;
    this.modoSeleccion.set('todos-filtrados');
    this.filtroCongelado.set({ texto: this.busqueda().trim(), categoriaId: this.categoriaId() });
    this.totalCongelado.set(this.totalFiltrado());
    this.idsIncluidos.set(new Set());
    this.idsExcluidos.set(new Set());
    this.cantidadPorProducto.set({});
    this.toast.info(`Seleccionados los ${this.totalFiltrado()} productos que cumplen el filtro actual.`);
  }

  limpiarSeleccion(): void {
    this.modoSeleccion.set('ninguno');
    this.idsIncluidos.set(new Set());
    this.idsExcluidos.set(new Set());
    this.filtroCongelado.set(null);
    this.totalCongelado.set(0);
    this.cantidadPorProducto.set({});
    // Nunca toca busqueda()/categoriaId() -- "no eliminar filtros ni
    // búsquedas salvo que el usuario lo solicite" (sección 3 del mandato).
  }

  protected readonly totalProductosSeleccionados = computed(() => {
    const modo = this.modoSeleccion();
    if (modo === 'ninguno') return 0;
    if (modo === 'ids') return this.idsIncluidos().size;
    return Math.max(0, this.totalCongelado() - this.idsExcluidos().size) + this.idsIncluidos().size;
  });

  // ── Copias (global + excepciones por producto) ──────────────────────────
  protected readonly copiasGlobalAplicada = signal(1);
  protected readonly copiasGlobalTexto = signal('1');
  /** Solo contiene excepciones explícitas — nunca una entrada por cada
   *  producto seleccionado (eso rompería la cota de memoria para una
   *  selección "todos los resultados" de miles de productos). */
  protected readonly cantidadPorProducto = signal<Record<number, number>>({});

  copiasDe(id: number): number {
    return this.cantidadPorProducto()[id] ?? this.copiasGlobalAplicada();
  }

  /** Enteros positivos únicamente, sin signo/decimales/vacío/NaN/infinito,
   *  acotado a `tope` — null si no es válido (nunca se aplica un valor
   *  inválido, solo se avisa). */
  private validarEnteroPositivo(texto: string, tope: number): number | null {
    const limpio = texto.trim();
    if (!/^\d+$/.test(limpio)) return null;
    const n = Number(limpio);
    if (!Number.isFinite(n) || n <= 0 || n > tope) return null;
    return n;
  }

  cambiarCopias(id: number, valorTexto: string): void {
    const n = this.validarEnteroPositivo(valorTexto, TOPE_COPIAS_POR_PRODUCTO);
    if (n === null) {
      this.toast.advertencia(`La cantidad de copias debe ser un entero de 1 a ${TOPE_COPIAS_POR_PRODUCTO}.`);
      return;
    }
    this.cantidadPorProducto.update((actual) => ({ ...actual, [id]: n }));
  }

  aplicarCopiasGlobales(): void {
    const n = this.validarEnteroPositivo(this.copiasGlobalTexto(), TOPE_COPIAS_POR_PRODUCTO);
    if (n === null) {
      this.toast.advertencia(`La cantidad de copias debe ser un entero de 1 a ${TOPE_COPIAS_POR_PRODUCTO}.`);
      return;
    }
    if (this.totalProductosSeleccionados() === 0) {
      this.toast.advertencia('Selecciona al menos un producto antes de aplicar copias.');
      return;
    }
    this.copiasGlobalAplicada.set(n);
    this.cantidadPorProducto.set({}); // "aplicar a seleccionados" empieza limpio -- sin excepciones viejas de otra ronda.
    this.toast.exito(`${n} copia${n === 1 ? '' : 's'} aplicada${n === 1 ? '' : 's'} a ${this.totalProductosSeleccionados()} producto(s).`);
  }

  /** Estimado SIN recorrer el catálogo: (seleccionados − excepciones
   *  dentro de la selección) × copia global + suma de esas excepciones.
   *  Exacto por construcción (nunca hay más excepciones registradas que
   *  productos realmente vistos/editados), no una aproximación. */
  protected readonly totalEtiquetas = computed(() => {
    const totalSeleccionados = this.totalProductosSeleccionados();
    if (totalSeleccionados === 0) return 0;
    let sumaExcepciones = 0;
    let cantidadExcepciones = 0;
    for (const [idTexto, cantidad] of Object.entries(this.cantidadPorProducto())) {
      if (this.estaSeleccionado(Number(idTexto))) {
        sumaExcepciones += cantidad;
        cantidadExcepciones++;
      }
    }
    return (totalSeleccionados - cantidadExcepciones) * this.copiasGlobalAplicada() + sumaExcepciones;
  });

  // ── Confirmación / resolución -- entrega a la ventana de configuración ──
  protected readonly imprimiendo = signal(false);
  /** true mientras se muestra ConfiguracionImpresionEtiquetasComponent en
   *  vez de la pantalla de selección de abajo (ver el @if del template). */
  protected readonly pasoConfiguracion = signal(false);
  /** Lista ya resuelta (con copias "horneadas" por producto) que se le
   *  pasa a la ventana de configuración -- null mientras no se ha
   *  confirmado una selección. */
  protected readonly productosParaConfigurar = signal<ProductoParaImprimir[] | null>(null);

  /** "Volver" desde la ventana de configuración -- NO imprime nada, solo
   *  vuelve a mostrar la selección (p.ej. para ajustar cantidades). */
  protected volverASeleccion(): void {
    this.pasoConfiguracion.set(false);
    this.productosParaConfigurar.set(null);
  }

  /** La ventana de configuración ya envió la impresión con éxito -- se
   *  cierra todo el flujo (mismo efecto que antes tenía confirmarImpresion()
   *  al terminar de imprimir). */
  protected impresionCompletada(): void {
    this.pasoConfiguracion.set(false);
    this.productosParaConfigurar.set(null);
    this.cerrar.emit();
  }

  /** Resuelve la lista REAL de productos a imprimir en el momento de
   *  confirmar — nunca confía en lo que el navegador cree que tiene
   *  seleccionado para una selección global sin volver a preguntarle al
   *  servidor (sección 7 del mandato). Devuelve null si hay que detener la
   *  impresión (ya avisó el motivo por toast). */
  private async resolverProductosAImprimir(): Promise<FilaEtiqueta[] | null> {
    const modo = this.modoSeleccion();
    if (modo === 'ninguno') return [];

    let candidatos: FilaEtiqueta[];
    if (modo === 'ids') {
      candidatos = Array.from(this.idsIncluidos())
        .map((id) => this.productosVistos.get(id))
        .filter((f): f is FilaEtiqueta => !!f);
    } else {
      const congelado = this.filtroCongelado()!;
      const filtro: Record<string, unknown> = { activo: true };
      if (congelado.categoriaId) filtro['categoriaProductoId'] = congelado.categoriaId;
      if (congelado.texto) filtro[FILTRO_BUSQUEDA] = { columnas: ['nombre', 'codigo'], texto: congelado.texto };

      const resultado = await firstValueFrom(
        this.data.listarPagina<Producto>('Producto', filtro, 0, TOPE_RESOLUCION_SELECCION_GLOBAL + 1, { columna: 'nombre' }),
      );
      if (resultado.total > TOPE_RESOLUCION_SELECCION_GLOBAL) {
        this.toast.error(
          `La selección "${this.etiquetaFiltroCongelado()}" tiene ${resultado.total} productos — supera el máximo de ${TOPE_RESOLUCION_SELECCION_GLOBAL} por impresión. Acota la búsqueda o la categoría y repite la operación en partes.`,
        );
        return null;
      }
      const resueltos = resultado.filas.map((p) => this.aFila(p));
      for (const f of resueltos) this.productosVistos.set(f.id, f);
      const excluidos = this.idsExcluidos();
      const extra = Array.from(this.idsIncluidos())
        .map((id) => this.productosVistos.get(id))
        .filter((f): f is FilaEtiqueta => !!f);
      candidatos = [...resueltos.filter((f) => !excluidos.has(f.id)), ...extra];
    }

    const conCodigo = candidatos.filter((f) => !!f.codigo);
    const sinCodigo = candidatos.length - conCodigo.length;
    if (sinCodigo > 0) {
      this.toast.advertencia(`${sinCodigo} producto(s) seleccionado(s) no tiene(n) código — se omiten de la impresión.`);
    }
    return conCodigo;
  }

  async confirmarImpresion(): Promise<void> {
    if (this.imprimiendo()) return; // doble clic.
    if (this.totalProductosSeleccionados() === 0) {
      this.toast.advertencia('Selecciona al menos un producto.');
      return;
    }

    this.imprimiendo.set(true);
    try {
      const productos = await this.resolverProductosAImprimir();
      if (productos === null) return; // ya avisó el motivo.
      if (productos.length === 0) {
        this.toast.advertencia('Ningún producto seleccionado tiene código — no hay nada que imprimir.');
        return;
      }

      const totalEtiquetasReal = productos.reduce((acc, p) => acc + this.copiasDe(p.id), 0);
      if (totalEtiquetasReal > TOPE_ETIQUETAS_IMPRESION) {
        this.toast.error(
          `La operación generaría ${totalEtiquetasReal} etiquetas — supera el máximo de ${TOPE_ETIQUETAS_IMPRESION} por impresión. Reduce la selección o las copias y repite en partes.`,
        );
        return;
      }

      // Ya no se imprime aquí -- se entrega la lista resuelta (con copias
      // ya "horneadas" por producto) a la ventana de configuración, que es
      // quien ahora decide papel/tamaño/tipo de código/distribución y hace
      // la impresión real (ver comentario de clase).
      this.productosParaConfigurar.set(
        productos.map((p) => ({ id: p.id, codigo: p.codigo as string, nombre: p.nombre, precioUnitario: p.precioUnitario, copias: this.copiasDe(p.id) })),
      );
      this.pasoConfiguracion.set(true);
    } finally {
      this.imprimiendo.set(false);
    }
  }
}

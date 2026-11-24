import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, ViewChild, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SupabaseService } from '../../../core/services/supabase.service';
import { filaACamel } from '../../../core/services/supabase-data-client.service';
import { ToastService } from '../../../shared/services/toast.service';
import { SelectBuscableComponent, OpcionBuscable } from '../../../shared/components/select-buscable/select-buscable.component';

/** Tipos de elemento que puede traer `fn_mapa_trazabilidad_relaciones`. */
type TipoElementoRelacion = 'tabla' | 'proceso' | 'modulo' | 'doc_saliente' | 'doc_entrante';

/** Fila cruda de `wikidocs.fn_mapa_trazabilidad_relaciones`. */
interface FilaRelacion {
  tipoElemento: TipoElementoRelacion;
  elementoId: number;
  referenciaId: number | null;
  etiqueta: string;
  tipoRelacion: string | null;
}

type TipoNodo = 'central' | 'documento' | 'tabla' | 'proceso' | 'modulo';

interface NodoGrafo {
  clave: string;
  tipo: TipoNodo;
  etiqueta: string;
  /** Solo para tipo 'central'/'documento' — permite abrirlo o expandirlo. */
  documentoId?: number;
  profundidad: number;
  x: number;
  y: number;
  expandible: boolean;
  expandido: boolean;
  cargando: boolean;
}

interface AristaGrafo {
  clave: string;
  origen: string;
  destino: string;
  tipoElemento: TipoElementoRelacion;
  tipoRelacion: string | null;
}

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Tope de nodos simultáneos en pantalla y de niveles de expansión
 *  acumulados desde el documento central (que cuenta como nivel 0) — ver
 *  mandato "Evolución de WikiDocs: Dashboard y Mapa de trazabilidad"
 *  (nov-2026), sección "Rendimiento obligatorio" del Mapa: "Limitar nodos
 *  y profundidad de expansión". */
const MAX_NODOS = 60;
const MAX_PROFUNDIDAD = 3;
const RADIO_NIVEL_1 = 190;
const RADIO_NIVEL_SIGUIENTE = 110;

const ETIQUETAS_TIPO: Record<TipoNodo, string> = {
  central: 'Documento central',
  documento: 'Documento relacionado',
  tabla: 'Tabla',
  proceso: 'Proceso',
  modulo: 'Módulo',
};

/**
 * Mapa visual de trazabilidad (mandato "Evolución de WikiDocs: Dashboard y
 * Mapa de trazabilidad", nov-2026): a partir de un documento central
 * elegido por el usuario, dibuja sus relaciones directas (tablas, procesos,
 * módulos y otros documentos) en un lienzo SVG con layout radial —
 * deliberadamente sin ninguna librería de grafos (ver auditoría previa:
 * no existe ninguna en el proyecto, y el caso de uso es acotado por diseño:
 * nunca se carga el grafo completo de la empresa, solo las relaciones
 * directas del elemento seleccionado, con expansión bajo demanda limitada a
 * `MAX_PROFUNDIDAD` niveles y `MAX_NODOS` nodos en pantalla).
 *
 * Una sola llamada por nodo expandido, a `wikidocs.fn_mapa_trazabilidad_relaciones`
 * (consolidada: trae tablas/procesos/módulos/documentos relacionados en una
 * sola consulta, en vez de las 5 llamadas separadas que usa la pestaña
 * Referencias de Documentos) — nunca se vuelve a pedir un nodo ya expandido
 * (evita ciclos y consultas duplicadas), y los documentos sin ninguna
 * conexión no se intentan dibujar como nodos aislados: se ofrecen como un
 * enlace directo a Documentos con el filtro "Solo huérfanos" ya aplicado.
 */
@Component({
  selector: 'app-mapa-trazabilidad',
  standalone: true,
  imports: [RouterLink, SelectBuscableComponent],
  templateUrl: './mapa-trazabilidad.component.html',
  styleUrl: './mapa-trazabilidad.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MapaTrazabilidadComponent implements OnDestroy {
  private readonly sb = inject(SupabaseService).cliente;
  private readonly toast = inject(ToastService);

  @ViewChild('lienzoSvg') private lienzoRef?: ElementRef<SVGSVGElement>;

  protected readonly ETIQUETAS_TIPO = ETIQUETAS_TIPO;

  protected readonly documentoCentralId = signal<number | null>(null);
  protected readonly etiquetaCentralActual = signal<string | null>(null);
  protected readonly cargandoCentral = signal(false);

  protected readonly nodos = signal<Map<string, NodoGrafo>>(new Map());
  protected readonly aristas = signal<Map<string, AristaGrafo>>(new Map());
  protected readonly seleccionado = signal<NodoGrafo | null>(null);

  protected readonly filtroTabla = signal(true);
  protected readonly filtroProceso = signal(true);
  protected readonly filtroModulo = signal(true);
  protected readonly filtroDocumento = signal(true);

  protected readonly viewBox = signal<ViewBox>({ x: -260, y: -260, w: 520, h: 520 });

  protected readonly nodosVisibles = computed(() => {
    const todos = Array.from(this.nodos().values());
    return todos.filter((n) => {
      if (n.tipo === 'central') return true;
      if (n.tipo === 'tabla') return this.filtroTabla();
      if (n.tipo === 'proceso') return this.filtroProceso();
      if (n.tipo === 'modulo') return this.filtroModulo();
      return this.filtroDocumento();
    });
  });

  protected readonly aristasVisibles = computed(() => {
    const idsVisibles = new Set(this.nodosVisibles().map((n) => n.clave));
    return Array.from(this.aristas().values()).filter((a) => idsVisibles.has(a.origen) && idsVisibles.has(a.destino));
  });

  // ── Buscador del documento central (reutiliza la misma función RPC del
  //    listado de Documentos — modo remoto de SelectBuscableComponent) ────
  /** Se guardan los últimos resultados de búsqueda para poder resolver el
   *  título real del documento elegido sin una llamada adicional —
   *  `valueChange` del selector solo entrega el id. */
  private ultimosResultadosBusqueda: OpcionBuscable[] = [];

  protected readonly buscarDocumentoCentral = async (texto: string): Promise<OpcionBuscable[]> => {
    const { data, error } = await this.sb.schema('wikidocs').rpc('fn_documentos_lista_pagina', {
      p_busqueda: texto.trim() || null,
      p_cantidad: 20,
    });
    if (error) return [];
    const opciones = ((data ?? []) as Record<string, unknown>[]).map((f) => {
      const fila = filaACamel(f) as { id: number; titulo: string };
      return { valor: fila.id, etiqueta: fila.titulo };
    });
    this.ultimosResultadosBusqueda = opciones;
    return opciones;
  };

  protected seleccionarCentral(valor: number | string | null): void {
    const id = Number(valor) || 0;
    if (!id) return;
    const etiqueta = this.ultimosResultadosBusqueda.find((o) => o.valor === id)?.etiqueta;
    void this.cargarCentral(id, etiqueta);
  }

  // ── Carga / expansión ────────────────────────────────────────────────

  private async cargarCentral(documentoId: number, etiquetaConocida?: string): Promise<void> {
    this.cargandoCentral.set(true);
    this.documentoCentralId.set(documentoId);
    this.seleccionado.set(null);

    const { data, error } = await this.sb.schema('wikidocs').rpc('fn_mapa_trazabilidad_relaciones', {
      p_documento_id: documentoId,
    });
    this.cargandoCentral.set(false);

    if (error) {
      this.toast.error('No se pudieron cargar las relaciones del documento: ' + error.message);
      return;
    }

    const filas = ((data ?? []) as Record<string, unknown>[]).map((f) => filaACamel(f) as unknown as FilaRelacion);

    const claveCentral = `doc:${documentoId}`;
    const nodos = new Map<string, NodoGrafo>();
    const aristas = new Map<string, AristaGrafo>();

    const etiquetaCentral = etiquetaConocida ?? `Documento #${documentoId}`;
    this.etiquetaCentralActual.set(etiquetaCentral);

    nodos.set(claveCentral, {
      clave: claveCentral,
      tipo: 'central',
      etiqueta: etiquetaCentral,
      documentoId,
      profundidad: 0,
      x: 0,
      y: 0,
      expandible: false,
      expandido: true,
      cargando: false,
    });

    this.ubicarRelaciones(filas, claveCentral, 0, 0, RADIO_NIVEL_1, nodos, aristas);

    const central = nodos.get(claveCentral);
    if (central) central.expandido = true;

    this.nodos.set(nodos);
    this.aristas.set(aristas);
    this.ajustarAPantalla();
  }

  protected async expandirNodo(nodo: NodoGrafo): Promise<void> {
    if (!nodo.expandible || nodo.expandido || nodo.cargando) return;
    if (nodo.profundidad >= MAX_PROFUNDIDAD) {
      this.toast.error('Se alcanzó la profundidad máxima de expansión (' + MAX_PROFUNDIDAD + ' niveles).');
      return;
    }
    if (this.nodos().size >= MAX_NODOS) {
      this.toast.error('Se alcanzó el límite de ' + MAX_NODOS + ' nodos en pantalla. Abre este documento directamente para ver más.');
      return;
    }
    if (!nodo.documentoId) return;

    this.actualizarNodo(nodo.clave, (n) => ({ ...n, cargando: true }));

    const { data, error } = await this.sb.schema('wikidocs').rpc('fn_mapa_trazabilidad_relaciones', {
      p_documento_id: nodo.documentoId,
    });

    if (error) {
      this.actualizarNodo(nodo.clave, (n) => ({ ...n, cargando: false }));
      this.toast.error('No se pudieron cargar las relaciones de "' + nodo.etiqueta + '": ' + error.message);
      return;
    }

    const filas = ((data ?? []) as Record<string, unknown>[]).map((f) => filaACamel(f) as unknown as FilaRelacion);

    const nodos = new Map(this.nodos());
    const aristas = new Map(this.aristas());
    this.ubicarRelaciones(filas, nodo.clave, nodo.x, nodo.y, RADIO_NIVEL_SIGUIENTE, nodos, aristas);

    const actualizado = nodos.get(nodo.clave);
    if (actualizado) nodos.set(nodo.clave, { ...actualizado, expandido: true, cargando: false });

    this.nodos.set(nodos);
    this.aristas.set(aristas);
  }

  /** Agrega a `nodos`/`aristas` (mutados in-place) las filas de relación de
   *  un nodo ya ubicado en (cx,cy), evitando duplicar nodos ya presentes
   *  (ciclos) y respetando MAX_NODOS. Los nuevos nodos se reparten en un
   *  círculo de radio `radio` alrededor de (cx,cy). */
  private ubicarRelaciones(
    filas: FilaRelacion[],
    claveOrigen: string,
    cx: number,
    cy: number,
    radio: number,
    nodos: Map<string, NodoGrafo>,
    aristas: Map<string, AristaGrafo>,
  ): void {
    const profundidadOrigen = nodos.get(claveOrigen)?.profundidad ?? 0;
    const nuevos: { clave: string; tipo: TipoNodo; etiqueta: string; documentoId?: number }[] = [];

    for (const fila of filas) {
      let claveDestino: string;
      let tipo: TipoNodo;
      let documentoId: number | undefined;

      if (fila.tipoElemento === 'tabla') {
        claveDestino = `tabla:${fila.elementoId}`;
        tipo = 'tabla';
      } else if (fila.tipoElemento === 'proceso') {
        claveDestino = `proceso:${fila.elementoId}`;
        tipo = 'proceso';
      } else if (fila.tipoElemento === 'modulo') {
        claveDestino = `modulo:${fila.elementoId}`;
        tipo = 'modulo';
      } else {
        documentoId = fila.referenciaId ?? undefined;
        if (!documentoId) continue;
        claveDestino = `doc:${documentoId}`;
        tipo = 'documento';
      }

      if (!nodos.has(claveDestino) && !nuevos.some((n) => n.clave === claveDestino)) {
        nuevos.push({ clave: claveDestino, tipo, etiqueta: fila.etiqueta, documentoId });
      }

      const claveArista = `${claveOrigen}|${claveDestino}|${fila.tipoElemento}`;
      if (!aristas.has(claveArista)) {
        aristas.set(claveArista, {
          clave: claveArista,
          origen: claveOrigen,
          destino: claveDestino,
          tipoElemento: fila.tipoElemento,
          tipoRelacion: fila.tipoRelacion,
        });
      }
    }

    const cupoDisponible = Math.max(0, MAX_NODOS - nodos.size);
    const aColocar = nuevos.slice(0, cupoDisponible);
    if (nuevos.length > aColocar.length) {
      this.toast.error('Se alcanzó el límite de ' + MAX_NODOS + ' nodos: algunas relaciones no se muestran.');
    }

    const n = aColocar.length;
    aColocar.forEach((info, i) => {
      const angulo = (2 * Math.PI * i) / Math.max(1, n) - Math.PI / 2;
      nodos.set(info.clave, {
        clave: info.clave,
        tipo: info.tipo,
        etiqueta: info.etiqueta,
        documentoId: info.documentoId,
        profundidad: profundidadOrigen + 1,
        x: cx + radio * Math.cos(angulo),
        y: cy + radio * Math.sin(angulo),
        expandible: info.tipo === 'documento',
        expandido: false,
        cargando: false,
      });
    });
  }

  private actualizarNodo(clave: string, cambio: (n: NodoGrafo) => NodoGrafo): void {
    const nodos = new Map(this.nodos());
    const actual = nodos.get(clave);
    if (!actual) return;
    nodos.set(clave, cambio(actual));
    this.nodos.set(nodos);
  }

  // ── Selección y acciones ─────────────────────────────────────────────

  protected seleccionarNodo(nodo: NodoGrafo): void {
    this.seleccionado.set(nodo);
  }

  protected nodoPorClave(clave: string): NodoGrafo | undefined {
    return this.nodos().get(clave);
  }

  protected iconoTipo(tipo: TipoNodo): string {
    switch (tipo) {
      case 'central':
        return '📄';
      case 'documento':
        return '📑';
      case 'tabla':
        return '🗄️';
      case 'proceso':
        return '⚙️';
      case 'modulo':
        return '🧭';
    }
  }

  protected hacerCentro(nodo: NodoGrafo): void {
    if (!nodo.documentoId) return;
    void this.cargarCentral(nodo.documentoId, nodo.etiqueta);
  }

  // ── Zoom / desplazamiento (SVG viewBox, sin librería) ────────────────

  private arrastrando = false;
  private ultimoPuntero: { x: number; y: number } | null = null;
  private distanciaPinchAnterior: number | null = null;
  private readonly punterosActivos = new Map<number, { x: number; y: number }>();

  protected onPointerDown(evento: PointerEvent): void {
    this.punterosActivos.set(evento.pointerId, { x: evento.clientX, y: evento.clientY });
    if (this.punterosActivos.size === 1) {
      this.arrastrando = true;
      this.ultimoPuntero = { x: evento.clientX, y: evento.clientY };
    } else if (this.punterosActivos.size === 2) {
      this.arrastrando = false;
      this.distanciaPinchAnterior = this.distanciaEntrePunteros();
    }
  }

  protected onPointerMove(evento: PointerEvent): void {
    if (!this.punterosActivos.has(evento.pointerId)) return;
    this.punterosActivos.set(evento.pointerId, { x: evento.clientX, y: evento.clientY });

    if (this.punterosActivos.size === 2) {
      const distanciaActual = this.distanciaEntrePunteros();
      if (this.distanciaPinchAnterior && distanciaActual) {
        const factor = this.distanciaPinchAnterior / distanciaActual;
        this.aplicarZoom(factor, evento.clientX, evento.clientY);
      }
      this.distanciaPinchAnterior = distanciaActual;
      return;
    }

    if (!this.arrastrando || !this.ultimoPuntero) return;
    const svg = this.lienzoRef?.nativeElement;
    if (!svg) return;
    const escala = this.viewBox().w / svg.clientWidth;
    const dx = (evento.clientX - this.ultimoPuntero.x) * escala;
    const dy = (evento.clientY - this.ultimoPuntero.y) * escala;
    this.ultimoPuntero = { x: evento.clientX, y: evento.clientY };
    this.viewBox.update((vb) => ({ ...vb, x: vb.x - dx, y: vb.y - dy }));
  }

  protected onPointerUp(evento: PointerEvent): void {
    this.punterosActivos.delete(evento.pointerId);
    if (this.punterosActivos.size < 2) this.distanciaPinchAnterior = null;
    if (this.punterosActivos.size === 0) {
      this.arrastrando = false;
      this.ultimoPuntero = null;
    }
  }

  private distanciaEntrePunteros(): number | null {
    const puntos = Array.from(this.punterosActivos.values());
    if (puntos.length < 2) return null;
    const [a, b] = puntos;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  protected onWheel(evento: WheelEvent): void {
    evento.preventDefault();
    const factor = evento.deltaY > 0 ? 1.1 : 0.9;
    this.aplicarZoom(factor, evento.clientX, evento.clientY);
  }

  private aplicarZoom(factor: number, clientX: number, clientY: number): void {
    const svg = this.lienzoRef?.nativeElement;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const vb = this.viewBox();
    const proporcionX = (clientX - rect.left) / rect.width;
    const proporcionY = (clientY - rect.top) / rect.height;
    const puntoX = vb.x + proporcionX * vb.w;
    const puntoY = vb.y + proporcionY * vb.h;

    const nuevoAncho = Math.min(2000, Math.max(80, vb.w * factor));
    const nuevoAlto = Math.min(2000, Math.max(80, vb.h * factor));

    this.viewBox.set({
      x: puntoX - proporcionX * nuevoAncho,
      y: puntoY - proporcionY * nuevoAlto,
      w: nuevoAncho,
      h: nuevoAlto,
    });
  }

  protected zoomBoton(factor: number): void {
    const svg = this.lienzoRef?.nativeElement;
    const rect = svg?.getBoundingClientRect();
    const cx = rect ? rect.left + rect.width / 2 : 0;
    const cy = rect ? rect.top + rect.height / 2 : 0;
    this.aplicarZoom(factor, cx, cy);
  }

  protected ajustarAPantalla(): void {
    const lista = this.nodosVisibles();
    if (!lista.length) return;
    const margen = 70;
    const minX = Math.min(...lista.map((n) => n.x)) - margen;
    const maxX = Math.max(...lista.map((n) => n.x)) + margen;
    const minY = Math.min(...lista.map((n) => n.y)) - margen;
    const maxY = Math.max(...lista.map((n) => n.y)) + margen;
    const ancho = Math.max(200, maxX - minX);
    const alto = Math.max(200, maxY - minY);
    this.viewBox.set({ x: minX, y: minY, w: ancho, h: alto });
  }

  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  constructor() {
    document.documentElement.setAttribute('data-wide', 'grid');
  }
}

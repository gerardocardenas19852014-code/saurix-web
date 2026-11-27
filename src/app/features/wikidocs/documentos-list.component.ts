import { ChangeDetectionStrategy, Component, HostListener, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { DataClientService } from '../../core/services/data-client.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { filaACamel } from '../../core/services/supabase-data-client.service';
import { AuthService } from '../../core/services/auth.service';
import { AdjuntosPanelComponent } from '../../shared/components/adjuntos-panel/adjuntos-panel.component';
import { EditorTextoComponent } from '../../shared/components/editor-texto/editor-texto.component';
import { ColumnaTabla, DataTableComponent } from '../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../shared/services/toast.service';
import { PreferenciasGridService } from '../../shared/services/preferencias-grid.service';
import { insertarEmbeds } from '../../shared/utils/embeds.util';
import { generarTablaContenido } from '../../shared/utils/tabla-contenido.util';
import { truncarTexto } from '../../shared/utils/texto.util';
import { SelectBuscableComponent, OpcionBuscable } from '../../shared/components/select-buscable/select-buscable.component';
import { TextoSugeridoComponent, SugerenciaTexto } from '../../shared/components/texto-sugerido/texto-sugerido.component';
import { ChipsEtiquetasComponent, EtiquetaChip } from '../../shared/components/chips-etiquetas/chips-etiquetas.component';
import {
  CategoriaOpcion,
  Documento,
  DocumentoFavorito,
  DocumentoReferenciaModulo,
  DocumentoReferenciaProceso,
  DocumentoReferenciaTabla,
  DocumentoRelacion,
  DocumentoVersion,
  Etiqueta,
  SeccionOpcion,
  TipoRelacionDocumento,
  TipoSistemaOpcion,
} from './documento.model';
import { PlantillaDocumento } from './plantillas/plantilla.model';

interface Migaja {
  etiqueta: string;
  ruta?: string;
}

/**
 * Fila del listado tal como la devuelve `wikidocs.fn_documentos_lista_pagina`
 * (ver mandato "WikiDocs Documentos: validación final previa a
 * implementación", nov-2026) — a propósito NO incluye `contenido` (el campo
 * más pesado de la tabla: HTML con imágenes incrustadas), porque el listado
 * nunca lo necesita para pintar sus columnas. `esFavorito`/`tieneTrazabilidad`
 * ya vienen calculados por fila desde el servidor, así que ya no hace falta
 * cargar las 4 tablas de trazabilidad completas ni los favoritos del
 * usuario como "cargas globales" aparte (ver auditoría previa) — se
 * calculan una sola vez, en la misma consulta, server-side.
 */
interface DocumentoListaFila {
  id: number;
  seccionId: number;
  titulo: string;
  activo: boolean;
  fechaCreacion?: string;
  fechaModificacion?: string;
  esFavorito: boolean;
  tieneTrazabilidad: boolean;
  /** Mandato 90 (nov-2026): recorte server-side (hasta 3) de los nombres
   *  de etiqueta de este documento + el total real — pensados exactamente
   *  para la columna "Etiquetas" de la cuadrícula (ver columnas más abajo).
   *  Nunca se piden las etiquetas completas por fila aparte (eso solo pasa
   *  al editar un documento puntual, ver fn_documento_etiquetas_listar). */
  etiquetasNombres: string[];
  etiquetasTotal: number;
}

const COLUMNA_ORDEN_DEFECTO: keyof DocumentoListaFila & string = 'titulo';
/** Mismo criterio que Plantillas/Tipo de sistema/Categoría/Secciones
 *  (TAMANO_LOTE_EXPORTAR) — usado aquí solo por "Descargar sección", que sí
 *  necesita el contenido completo de cada documento (el listado paginado no
 *  lo trae a propósito, ver DocumentoListaFila). */
const TAMANO_LOTE_DESCARGA_SECCION = 500;
/** Tope razonable para el selector "Enlazar documento" del editor — no se
 *  pagina ni se vuelve a consultar mientras el usuario escribe (el propio
 *  EditorTextoComponent filtra en cliente sobre esta lista ya cargada), así
 *  que alcanza con traer un número generoso de documentos activos sin su
 *  contenido (reutiliza la misma función RPC del listado, que ya lo
 *  excluye). */
const TOPE_DOCUMENTOS_PARA_ENLAZAR = 500;

/** Tipo de referencia universal que puede estar en edición/alta en la
 *  pestaña Referencias (Mandato 89, nov-2026). 'relacion' es el único que no
 *  depende de ningún sistema externo (relaciona dos Documento entre sí). */
type TipoReferenciaUniversal = 'tabla' | 'proceso' | 'modulo' | 'relacion';

/** Borrador de captura/edición — signal-based (no FormGroup) para poder
 *  reutilizar el mismo objeto tanto al agregar (id=null) como al editar
 *  (id=el de la fila), y para que "Cancelar" sea tan simple como descartar
 *  el borrador sin tocar la fila real. Todos los campos de texto libre
 *  llegan ya con autocompletado opcional vía TextoSugeridoComponent. */
interface DraftTabla {
  id: number | null;
  sistema: string;
  esquema: string;
  tabla: string;
  descripcion: string;
}
interface DraftProceso {
  id: number | null;
  sistema: string;
  proceso: string;
  descripcion: string;
}
interface DraftModulo {
  id: number | null;
  sistema: string;
  modulo: string;
  pantallaFuncionalidad: string;
  url: string;
  descripcion: string;
}
interface DraftRelacion {
  id: number | null;
  documentoRelacionadoId: number | null;
  tipo: TipoRelacionDocumento;
}

/** Borrador del formulario "Duplicar documento" (Mandato 90 §6, nov-2026)
 *  — las 6 banderas de copia no tienen ningún default server-side (ver
 *  wikidocs.fn_documento_duplicar): Angular es la única fuente de verdad
 *  sobre sus valores iniciales, ver draftDuplicarVacio(). */
interface DraftDuplicar {
  titulo: string;
  seccionId: number;
  copiarContenido: boolean;
  copiarEtiquetas: boolean;
  copiarReferenciasTablas: boolean;
  copiarReferenciasProcesos: boolean;
  copiarReferenciasModulos: boolean;
  copiarRelacionados: boolean;
}

/** Referencia señalada para eliminar (pide confirmación antes de la baja
 *  real) — guarda también una etiqueta ya resuelta para el mensaje del
 *  diálogo, sin tener que volver a mirar la fila original ahí. */
interface ReferenciaAEliminar {
  tipo: TipoReferenciaUniversal;
  id: number;
  etiqueta: string;
}

/**
 * Ventana de Documentos (WikiDocs). El filtro por Sección es opcional,
 * así que esta misma ventana sirve para:
 *  - /wikidocs/documentos → todos los documentos, sin filtrar.
 *  - /wikidocs/secciones/:seccionId/documentos → solo los de esa sección
 *    (llegando desde el drill-down de Secciones).
 *
 * Además del listado, esta ventana resuelve la vista de un documento
 * (contenido en Markdown renderizado con `marked` dentro de `.page-body`,
 * con enlaces de YouTube/Google Drive convertidos a embeds reales — igual
 * que el prototipo de referencia) y su edición, alternando entre Ver /
 * Editar / Adjuntos con `.tab-bar`, en vez de navegar a otra ruta.
 *
 * Para dar de alta un documento desde la vista "todos", el formulario pide
 * Tipo de sistema → Categoría → Sección en cascada real (3 selects, uno
 * por nivel de la jerarquía TipoSistema→Categoria→Seccion); el Id de la
 * Sección elegida es lo único que persiste en el Documento. Si ya se llegó
 * con una sección fija, todo este paso se omite. Mandato 89 (nov-2026):
 * los 3 selects viven en una sola fila (`.form-grid-3col`, clase global ya
 * existente — reutilizada tal cual, sin CSS nuevo) en vez de apilados, para
 * aprovechar el ancho ya ampliado de esta pantalla; el resto del formulario
 * (Título/plantilla/editor/acciones) sigue fuera de ese grid, sin cambios.
 *
 * Fase B de homologación SAURIX-CAT-001 v1.1 (mandato "WikiDocs Documentos:
 * implementación integral", nov-2026) — el LISTADO (antes `list()` + 4
 * cargas globales de trazabilidad + carga global de favoritos, todo
 * paginado/filtrado en el cliente) ahora usa paginación, orden, búsqueda y
 * los filtros "Solo favoritos"/"Solo huérfanos"/"Mostrar inactivos" 100%
 * server-side, vía `wikidocs.fn_documentos_lista_pagina` (validada en el
 * mandato anterior: aislamiento multiempresa, filtros combinados,
 * paginación real y SECURITY INVOKER verificados contra producción). Sin
 * consulta automática al abrir ni mientras se escribe/cambian filtros
 * (`haBuscado` + edición/aplicada, mismo patrón que Tipo de
 * sistema/Categoría/Secciones/Plantillas). El resto de la pantalla —
 * editor, adjuntos, historial de versiones, exportaciones PDF/HTML,
 * navegación profunda por `?documento=` — sigue exactamente igual, usando
 * `DataClientService` como antes.
 *
 * La pestaña Referencias fue rediseñada por completo en el Mandato 89
 * ("WikiDocs: mejora integral de experiencia de usuario, referencias
 * universales y limpieza definitiva", nov-2026): ya no depende del catálogo
 * interno de navegación de Saurix (`DESTINOS` — ese import se eliminó de
 * este archivo), las 4 categorías de referencia (Tabla/Proceso/Módulo/
 * Documento relacionado) son ahora universales (cualquier sistema, interno
 * o externo), cada tarjeta tiene su propio formulario de alta/edición oculto
 * hasta pedirse explícitamente (nunca permanentemente abierto), con
 * autocompletado server-side opcional (`wikidocs.fn_referencias_sugerencias`,
 * nunca un catálogo obligatorio) y confirmación antes de eliminar.
 */
@Component({
  selector: 'app-documentos-list',
  standalone: true,
  imports: [
    // `FormsModule` es indispensable aquí (Corrección 01 al Mandato 89,
    // nov-2026): los 4 formularios de alta/edición de la pestaña
    // Referencias son `<form (ngSubmit)="...">` SIN `[formGroup]` (usan un
    // borrador basado en signals, no un FormGroup reactivo). El output
    // `ngSubmit` en un `<form>` sin `[formGroup]` lo provee la directiva
    // `NgForm` de FormsModule (selector `form:not([formGroup])`) — sin
    // FormsModule importado, ningún directiva reclama ese binding, así que
    // el botón `type="submit"` caía al envío NATIVO del navegador: una
    // navegación completa (GET a la URL actual) que recargaba toda la SPA
    // desde cero, perdiendo el documento abierto y regresando a la lista
    // — exactamente el bug reportado. `NgForm` nunca se aplica al
    // `<form [formGroup]="form">` del documento (ese selector lo excluye
    // explícitamente), así que este import no cambia nada en ese formulario.
    FormsModule,
    ReactiveFormsModule,
    RouterLink,
    DataTableComponent,
    ConfirmDialogComponent,
    AdjuntosPanelComponent,
    EditorTextoComponent,
    SelectBuscableComponent,
    TextoSugeridoComponent,
    ChipsEtiquetasComponent,
  ],
  templateUrl: './documentos-list.component.html',
  styleUrl: './documentos-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentosListComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly data = inject(DataClientService);
  private readonly sb = inject(SupabaseService).cliente;
  private readonly auth = inject(AuthService);
  protected readonly toast = inject(ToastService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);
  private readonly fb = inject(FormBuilder);
  private readonly sanitizer = inject(DomSanitizer);

  protected seccionFijaId: number | null = null;
  protected seccionFijaNombre = '';

  // ── Búsqueda, filtros, orden y paginación (SAURIX-CAT-001 v1.1) ──────────
  // Sin consulta automática al abrir la ventana ni mientras se escribe o se
  // cambian los filtros — todo queda en "...EnEdicion" hasta presionar
  // Buscar/Enter, que lo copia a "...Aplicado" y dispara la única consulta.
  protected readonly registrosPagina = signal<DocumentoListaFila[]>([]);
  protected readonly totalFiltrado = signal(0);
  protected readonly paginaActual = signal(1);
  protected readonly cargando = signal(false);
  protected readonly haBuscado = signal(false);

  protected readonly columnaOrden = signal<keyof DocumentoListaFila & string>(COLUMNA_ORDEN_DEFECTO);
  protected readonly direccionOrden = signal<'asc' | 'desc'>('asc');

  protected readonly busquedaEnEdicion = signal('');
  protected readonly soloFavoritosEnEdicion = signal(false);
  protected readonly soloHuerfanosEnEdicion = signal(false);
  protected readonly soloConectadosEnEdicion = signal(false);
  protected readonly mostrarInactivosEnEdicion = signal(false);
  private busquedaAplicada = '';
  private soloFavoritosAplicado = false;
  private soloHuerfanosAplicado = false;
  private soloConectadosAplicado = false;
  private mostrarInactivosAplicado = false;

  /** Filtro por etiquetas (Mandato 90 §5, nov-2026) — mismo criterio
   *  SAURIX-CAT-001 v1.1 que el resto: "...EnEdicion" no dispara nada por
   *  sí solo, "buscar()" lo copia a lo aplicado recién ahí. Solo admite
   *  etiquetas YA EXISTENTES en el catálogo (permitirNuevas=false en el
   *  <app-chips-etiquetas> del template) — no tendría con qué filtrar un
   *  nombre que no existe. */
  protected readonly etiquetasFiltroEnEdicion = signal<EtiquetaChip[]>([]);
  protected readonly modoEtiquetasEnEdicion = signal<'any' | 'all'>('any');
  private etiquetasFiltroAplicado: number[] = [];
  private modoEtiquetasAplicado: 'any' | 'all' = 'any';

  private secuencia = 0;

  protected readonly migajas = signal<Migaja[]>([]);

  protected readonly tiposSistema = signal<TipoSistemaOpcion[]>([]);
  protected readonly categorias = signal<CategoriaOpcion[]>([]);
  protected readonly secciones = signal<SeccionOpcion[]>([]);

  /** Plantillas activas, para el selector "Usar plantilla" al crear un
   *  documento nuevo (no aplica al editar uno ya existente). Catálogo
   *  acotado, no es "documentos" — se sigue cargando al abrir la pantalla. */
  protected readonly plantillas = signal<PlantillaDocumento[]>([]);

  /** Todas las secciones (sin filtrar), solo para mostrar el nombre de la
   *  sección de cada documento en la columna del listado en vez de su Id.
   *  Catálogo acotado (no es la tabla Documento), se sigue cargando al
   *  abrir la pantalla igual que antes. */
  private readonly todasLasSecciones = signal<SeccionOpcion[]>([]);
  private readonly mapaSecciones = computed(() => new Map(this.todasLasSecciones().map((s) => [s.id, s])));

  /** Lista acotada (sin `contenido`, hasta TOPE_DOCUMENTOS_PARA_ENLAZAR) para
   *  el selector "Enlazar documento" del editor y para "Documento
   *  relacionado" en Referencias — se carga una sola vez al entrar a
   *  "editar"/"nuevo", reutilizando la misma función RPC del listado (que ya
   *  excluye `contenido`), nunca la carga completa de `list('Documento')`
   *  que existía antes. */
  private readonly documentosParaEnlazarBase = signal<{ id: number; titulo: string }[]>([]);
  protected readonly documentosParaEnlazar = computed(() => {
    const actualId = this.documentoActual()?.id ?? 0;
    return this.documentosParaEnlazarBase().filter((doc) => doc.id !== actualId);
  });

  /** Cache de títulos resueltos bajo demanda (pestaña Referencias / chips de
   *  "Documentos relacionados") — reemplaza la búsqueda en memoria sobre
   *  `documentosTodos` que existía antes de esta fase. */
  private readonly tituloPorId = signal<Map<number, string>>(new Map());

  /** null = listado; 'ver'/'editar'/'adjuntos' = documento abierto en esa pestaña. */
  protected readonly vista = signal<'lista' | 'ver' | 'editar' | 'adjuntos' | 'historial' | 'referencias'>('lista');

  /** La vista "lista" (tabla) aprovecha el ancho ampliado de `.content`
   *  (ver comentario que tenía antes `ngOnInit`). "Ver"/"Editar" también lo
   *  usan: documentos con contenido ancho (tablas, plantillas tipo
   *  "Solicitud de Cambio") quedaban aplastados contra el límite angosto
   *  por defecto, dejando franjas vacías enormes a los lados — el `.content`
   *  ampliado resuelve `.page-body` (sin max-width propio, aprovecha el
   *  espacio solo) y, para "Editar", se complementa con el modificador
   *  `.edit-form--documento` (ver documentos-list.component.scss), porque
   *  `.edit-form` tiene su propio tope de 760px independiente de `.content`
   *  que si no se queda angosto aunque el padre se ensanche. Mandato 89:
   *  "Referencias" se agrega también aquí, porque su rediseño en tarjetas de
   *  2 columnas necesita el mismo ancho ampliado (antes se dejaba angosta a
   *  propósito, cuando era una simple lista de chips en una sola columna).
   *  Este effect mantiene `data-wide` sincronizado con la vista actual en
   *  vez de dejarlo fijo todo el tiempo que el componente está montado, y lo
   *  quita al salir de la pantalla (onCleanup corre tanto entre cambios de
   *  vista como al destruirse el componente). */
  private readonly _anchoSegunVista = effect((onCleanup) => {
    const vista = this.vista();
    if (vista === 'lista' || vista === 'ver' || vista === 'editar' || vista === 'referencias') {
      document.documentElement.setAttribute('data-wide', 'grid');
    }
    onCleanup(() => document.documentElement.removeAttribute('data-wide'));
  });
  protected readonly documentoActual = signal<Documento | null>(null);
  protected readonly documentoAEliminar = signal<DocumentoListaFila | null>(null);

  /** Favorito del documento actualmente abierto (vista Ver/Editar) —
   *  resuelto bajo demanda al abrir (lookup acotado a un documento, no la
   *  carga global de favoritos que existía antes), y refrescado
   *  localmente en cada toggle sin volver a consultar. */
  protected readonly favoritoActual = signal(false);

  /** Etiquetas del documento actualmente en alta/edición (Mandato 90,
   *  nov-2026) — 100% estado local hasta presionar "Guardar" (igual que el
   *  resto del formulario): se precargan al entrar a "Editar" (ver
   *  cargarEtiquetasDocumento/cargarFormDesde), se vacían al "Nuevo
   *  documento", y se descartan sin tocar nada guardado si se cancela.
   *  `id` viene en null para las agregadas como texto libre que todavía no
   *  existen en el catálogo — ver EtiquetaChip. */
  protected readonly etiquetasDocumento = signal<EtiquetaChip[]>([]);

  protected readonly versiones = signal<DocumentoVersion[]>([]);
  protected readonly versionARestaurar = signal<DocumentoVersion | null>(null);
  protected readonly columnasVersiones: ColumnaTabla<DocumentoVersion>[] = [
    {
      campo: 'fechaCreacion',
      etiqueta: 'Fecha',
      formatear: (fila) => (fila.fechaCreacion ? new Date(fila.fechaCreacion).toLocaleString('es-MX') : '—'),
    },
    { campo: 'usuario', etiqueta: 'Usuario' },
    {
      campo: 'contenido',
      etiqueta: 'Resumen',
      formatear: (fila) => truncarTexto(this.textoPlano(fila.contenido), 90),
    },
  ];

  protected readonly esNuevo = computed(() => this.vista() !== 'lista' && this.documentoActual() === null);

  protected readonly columnas: ColumnaTabla<DocumentoListaFila>[] = [
    { campo: 'titulo', etiqueta: 'Título', multilinea: true, titulo: (fila) => fila.titulo },
    {
      campo: 'seccionId',
      etiqueta: 'Sección',
      formatear: (fila) => this.mapaSecciones().get(fila.seccionId)?.nombre ?? '—',
    },
    {
      // Mandato 90 §5/§7: recorte de hasta 3 nombres + "+N" cuando hay más
      // (ambos ya calculados server-side por fn_documentos_lista_pagina,
      // nunca una consulta extra por fila). A propósito NO se usa el
      // mecanismo `badgesSubfila` (pensado para convertir la PRIMERA
      // columna marcada `subfila` en un renglón de ancho completo, ver
      // ColumnaTabla.subfila en data-table.component.ts): hacerlo sobre
      // "Título" le quitaría a esa columna su encabezado clicable para
      // ordenar (columnasFila excluye toda columna `subfila` del
      // encabezado) — con "Título" como orden por defecto de esta
      // pantalla, esa regresión no se justifica solo para mostrar
      // etiquetas. Una columna normal más (igual que "Sección") logra lo
      // mismo sin ese costo.
      campo: 'id',
      claveColumna: 'etiquetas',
      etiqueta: 'Etiquetas',
      formatear: (fila) => this.textoEtiquetasFila(fila),
      titulo: (fila) => (fila.etiquetasNombres?.length ? fila.etiquetasNombres.join(', ') : 'Sin etiquetas'),
    },
    {
      campo: 'id',
      claveColumna: 'trazabilidad',
      etiqueta: 'Trazabilidad',
      formatear: (fila) => (fila.tieneTrazabilidad ? 'Conectado' : 'Huérfano'),
      claseValor: (fila) => (fila.tieneTrazabilidad ? 'grid-badge-success' : 'grid-badge-warning'),
      titulo: (fila) =>
        fila.tieneTrazabilidad
          ? 'Tiene al menos una referencia de trazabilidad capturada'
          : 'Sin ninguna tabla, proceso, módulo u otro documento referenciado (ni que lo referencien a él)',
    },
    { campo: 'activo', etiqueta: 'Activo', formatear: (fila) => (fila.activo ? 'Sí' : 'No') },
  ];

  /** Texto compacto para la columna "Etiquetas" de la cuadrícula —
   *  "tag1, tag2, tag3 +N" cuando hay más de las 3 que ya trae el recorte
   *  server-side, o "—" cuando el documento no tiene ninguna. */
  private textoEtiquetasFila(fila: DocumentoListaFila): string {
    const nombres = fila.etiquetasNombres ?? [];
    const total = fila.etiquetasTotal ?? 0;
    if (total === 0) return '—';
    const extra = total - nombres.length;
    return extra > 0 ? `${nombres.join(', ')} +${extra}` : nombres.join(', ');
  }

  /** Encabezados (h1/h2/h3) del documento actual + el mismo HTML con esos
   *  encabezados ya con id — una sola pasada para no parsear el HTML dos
   *  veces (una vez para el índice, otra para el contenido mostrado). */
  private readonly tocYContenido = computed(() => {
    const doc = this.documentoActual();
    const html = doc ? this.aHtml(doc.contenido) : '';
    return generarTablaContenido(insertarEmbeds(html));
  });

  /** Índice de contenido de la vista "Ver". Mandato 90 §7: antes exigía
   *  más de un encabezado (`length > 1`) para aparecer — con la extensión
   *  a h1-h6 un documento con UN SOLO encabezado (p.ej. nada más un h2
   *  dentro de contenido corto) también se beneficia de poder saltar
   *  directo a él, así que ahora alcanza con que exista al menos uno. */
  protected readonly tablaContenido = computed(() => {
    const items = this.tocYContenido().items;
    return items.length > 0 ? items : [];
  });

  /** Colapsado/expandido del índice de contenido (Mandato 90 §7.1) — una
   *  sola señal para escritorio y móvil (nunca un observer ni media query
   *  en JS: el CSS ya distingue breakpoints solo); empieza expandido,
   *  igual que el comportamiento de siempre antes de poder colapsarlo. */
  protected readonly tocColapsado = signal(false);

  protected toggleToc(): void {
    this.tocColapsado.update((v) => !v);
  }

  /** Id del encabezado actualmente "activo" (el más alto visible dentro
   *  del área de lectura) para resaltarlo en el índice mientras se hace
   *  scroll — Mandato 90 §7.1. Se recalcula con un único IntersectionObserver
   *  por documento mostrado (nunca con un listener de scroll + cálculos
   *  manuales de posición, más caro); se desconecta solo tanto al cambiar
   *  de documento como al destruirse el componente (onCleanup del propio
   *  effect, mismo patrón que _anchoSegunVista más arriba). */
  protected readonly seccionActivaId = signal<string | null>(null);
  private readonly _observarEncabezados = effect((onCleanup) => {
    const items = this.tablaContenido();
    const vista = this.vista();
    if (vista !== 'ver' || items.length === 0) {
      this.seccionActivaId.set(null);
      return;
    }

    // Se espera un tick para que `[innerHTML]` ya haya pintado los
    // encabezados reales en el DOM antes de intentar observarlos.
    const idTimeout = setTimeout(() => {
      const elementos = items
        .map((item) => document.getElementById(item.id))
        .filter((el): el is HTMLElement => el !== null);
      if (elementos.length === 0) return;

      this.seccionActivaId.set(items[0].id);

      const observer = new IntersectionObserver(
        (entradas) => {
          // El encabezado "activo" es el más alto entre los que siguen
          // visibles bajo la franja superior del área de lectura — si
          // ninguno sigue visible (se hizo scroll más allá de todos), se
          // conserva el último conocido en vez de limpiarlo a `null`.
          const visibles = entradas.filter((e) => e.isIntersecting).map((e) => e.target.id);
          if (visibles.length === 0) return;
          const primerIndice = items.findIndex((item) => visibles.includes(item.id));
          if (primerIndice >= 0) this.seccionActivaId.set(items[primerIndice].id);
        },
        { rootMargin: '0px 0px -70% 0px', threshold: 0 },
      );
      elementos.forEach((el) => observer.observe(el));
      onCleanup(() => observer.disconnect());
    }, 0);

    onCleanup(() => clearTimeout(idTimeout));
  });

  protected readonly contenidoRenderizado = computed<SafeHtml>(() => {
    return this.sanitizer.bypassSecurityTrustHtml(this.tocYContenido().html);
  });

  // ---------------- Contadores de pestañas (Mandato 89) ----------------
  // `null` = todavía no se ha consultado esta pestaña en esta visita al
  // documento (no se muestra ningún badge) — nunca se pinta "0" como si
  // fuera un conteo confirmado sin haberlo consultado. Se resuelven con los
  // datos que la propia pestaña ya necesita cargar para mostrarse (nunca
  // una consulta extra solo para el número), y se actualizan in-place tras
  // agregar/quitar, sin recargar el documento completo.
  protected readonly contadorAdjuntos = signal<number | null>(null);
  protected readonly contadorHistorial = signal<number | null>(null);
  protected readonly contadorReferencias = signal<number | null>(null);

  // ---------------- Referencias (trazabilidad universal) ----------------
  // Pestaña "Referencias" (Mandato 89, nov-2026 — "WikiDocs: mejora integral
  // de experiencia de usuario, referencias universales y limpieza
  // definitiva"): anota en qué tablas/procesos/módulos de CUALQUIER sistema
  // (propio o externo) se apoya este documento, y con qué otros documentos
  // se relaciona. Ver DocumentoReferenciaTabla/Proceso/Modulo en
  // documento.model.ts. Mismo patrón de alta/baja inmediata por registro
  // que TicketEtiqueta/TicketDependencia en el tablero Kanban, ahora con
  // edición in-place además de alta/baja.

  protected readonly tablasReferenciadas = signal<DocumentoReferenciaTabla[]>([]);
  protected readonly procesosReferenciados = signal<DocumentoReferenciaProceso[]>([]);
  protected readonly modulosReferenciados = signal<DocumentoReferenciaModulo[]>([]);
  protected readonly documentosRelacionados = signal<DocumentoRelacion[]>([]);
  /** Backlinks — lo inverso de documentosRelacionados: otros documentos
   *  que SÍ relacionan a este (DocumentoRelacion.documentoRelacionadoId =
   *  este documento). Solo lectura aquí: se administra desde la pestaña
   *  Referencias del documento de origen (fila.documentoId), no desde
   *  este lado. */
  protected readonly documentosQueMeReferencian = signal<DocumentoRelacion[]>([]);

  /** Sistema del propio documento (resuelto vía Sección→Categoría→Tipo de
   *  sistema, igual que el nodo central del Mapa de trazabilidad) — se usa
   *  solo como SUGERENCIA por defecto al abrir "+ Agregar" en cualquier
   *  tarjeta de referencia; el usuario puede cambiarlo libremente (referencia
   *  cruzada entre sistemas), nunca se fuerza. */
  protected readonly sistemaDocumentoActual = signal<string | null>(null);

  /** Qué tarjeta tiene su formulario de captura/edición visible —
   *  `null` = ninguna (todas las tarjetas muestran solo su lista + botón
   *  "+ Agregar"), nunca hay más de un formulario abierto a la vez. */
  protected readonly formAbierto = signal<TipoReferenciaUniversal | null>(null);

  private draftTablaVacio(): DraftTabla {
    return { id: null, sistema: this.sistemaDocumentoActual() ?? '', esquema: '', tabla: '', descripcion: '' };
  }
  private draftProcesoVacio(): DraftProceso {
    return { id: null, sistema: this.sistemaDocumentoActual() ?? '', proceso: '', descripcion: '' };
  }
  private draftModuloVacio(): DraftModulo {
    return {
      id: null,
      sistema: this.sistemaDocumentoActual() ?? '',
      modulo: '',
      pantallaFuncionalidad: '',
      url: '',
      descripcion: '',
    };
  }
  private draftRelacionVacio(): DraftRelacion {
    return { id: null, documentoRelacionadoId: null, tipo: 'relacionado' };
  }

  protected readonly draftTabla = signal<DraftTabla>(this.draftTablaVacio());
  protected readonly draftProceso = signal<DraftProceso>(this.draftProcesoVacio());
  protected readonly draftModulo = signal<DraftModulo>(this.draftModuloVacio());
  protected readonly draftRelacion = signal<DraftRelacion>(this.draftRelacionVacio());

  protected readonly referenciaAEliminar = signal<ReferenciaAEliminar | null>(null);

  protected static readonly TIPOS_RELACION: { clave: TipoRelacionDocumento; etiqueta: string }[] = [
    { clave: 'relacionado', etiqueta: 'Relacionado con' },
    { clave: 'depende_de', etiqueta: 'Depende de' },
    { clave: 'reemplaza_a', etiqueta: 'Reemplaza a' },
  ];
  protected readonly tiposRelacion = DocumentosListComponent.TIPOS_RELACION;
  private readonly etiquetaTipoRelacion = new Map(
    DocumentosListComponent.TIPOS_RELACION.map((t) => [t.clave, t.etiqueta]),
  );
  protected textoTipoRelacion(tipo: TipoRelacionDocumento): string {
    return this.etiquetaTipoRelacion.get(tipo) ?? 'Relacionado con';
  }

  /** Valida que la URL opcional de una referencia de Módulo sea realmente
   *  navegable antes de convertirla en enlace (ver comentario en
   *  DocumentoReferenciaModulo, documento.model.ts): solo http/https, nunca
   *  `javascript:` ni otros esquemas ejecutables — texto libre capturado
   *  por el usuario, nunca se confía sin revisar. */
  protected esUrlSegura(url: string | null): boolean {
    if (!url) return false;
    try {
      const protocolo = new URL(url, location.origin).protocol;
      return protocolo === 'http:' || protocolo === 'https:';
    } catch {
      return false;
    }
  }

  /** Opciones para "Documento relacionado": igual que documentosParaEnlazar
   *  (sin el propio documento), menos los que ya están relacionados —
   *  salvo que se esté editando esa misma fila (ahí sí debe seguir
   *  apareciendo, es la que se está modificando). */
  protected readonly opcionesDocumentoRelacionado = computed<OpcionBuscable[]>(() => {
    const idEnEdicion = this.draftRelacion().id;
    const yaAgregados = new Set(
      this.documentosRelacionados()
        .filter((r) => r.id !== idEnEdicion)
        .map((r) => r.documentoRelacionadoId),
    );
    return this.documentosParaEnlazar()
      .filter((d) => !yaAgregados.has(d.id))
      .map((d) => ({ valor: d.id, etiqueta: d.titulo }));
  });

  /** Título del documento relacionado, para pintar el chip (DocumentoRelacion
   *  solo guarda el id) — se resuelve bajo demanda y queda en caché, en vez
   *  de buscarlo en una lista completa de documentos ya cargada en memoria. */
  protected tituloDocumento(documentoId: number): string {
    return this.tituloPorId().get(documentoId) ?? `Documento #${documentoId}`;
  }

  private resolverTitulosFaltantes(ids: number[]): void {
    const cache = this.tituloPorId();
    const faltantes = [...new Set(ids)].filter((id) => id > 0 && !cache.has(id));
    if (faltantes.length === 0) return;
    faltantes.forEach((id) => {
      this.data.getById<Documento>('Documento', id).subscribe({
        next: (documento) => {
          this.tituloPorId.update((mapa) => new Map(mapa).set(id, documento.titulo));
        },
        error: () => {},
      });
    });
  }

  /** Resuelve el sistema del documento actual (Sección→Categoría→Tipo de
   *  sistema), igual patrón que el nodo central del Mapa de trazabilidad —
   *  una sola consulta embebida vía PostgREST, no un viaje por cada nivel. */
  private resolverSistemaDocumentoActual(documentoId: number): void {
    this.sb
      .schema('wikidocs')
      .from('documento')
      .select('seccion:seccion_id(categoria:categoria_id(tipo_sistema:tipo_sistema_id(nombre)))')
      .eq('id', documentoId)
      .maybeSingle()
      .then(({ data }: { data: unknown }) => {
        const fila = data as { seccion: { categoria: { tipo_sistema: { nombre: string } | null } | null } | null } | null;
        this.sistemaDocumentoActual.set(fila?.seccion?.categoria?.tipo_sistema?.nombre ?? null);
      });
  }

  /** Carga las 5 listas de referencias del documento actual (en paralelo,
   *  nunca una tras otra) y, al terminar las 5, fija el contador de la
   *  pestaña con el total real — nunca antes, para no mostrar un número a
   *  medio consultar. */
  private cargarReferencias(): void {
    const doc = this.documentoActual();
    if (!doc) return;
    this.resolverSistemaDocumentoActual(doc.id);

    let pendientes = 5;
    const unaListaResuelta = (): void => {
      pendientes--;
      if (pendientes === 0) {
        this.contadorReferencias.set(
          this.tablasReferenciadas().length +
            this.procesosReferenciados().length +
            this.modulosReferenciados().length +
            this.documentosRelacionados().length +
            this.documentosQueMeReferencian().length,
        );
      }
    };

    this.data.list<DocumentoReferenciaTabla>('DocumentoReferenciaTabla', { documentoId: doc.id }).subscribe({
      next: (filas) => {
        this.tablasReferenciadas.set(filas);
        unaListaResuelta();
      },
      error: () => {
        this.tablasReferenciadas.set([]);
        unaListaResuelta();
      },
    });
    this.data.list<DocumentoReferenciaProceso>('DocumentoReferenciaProceso', { documentoId: doc.id }).subscribe({
      next: (filas) => {
        this.procesosReferenciados.set(filas);
        unaListaResuelta();
      },
      error: () => {
        this.procesosReferenciados.set([]);
        unaListaResuelta();
      },
    });
    this.data.list<DocumentoReferenciaModulo>('DocumentoReferenciaModulo', { documentoId: doc.id }).subscribe({
      next: (filas) => {
        this.modulosReferenciados.set(filas);
        unaListaResuelta();
      },
      error: () => {
        this.modulosReferenciados.set([]);
        unaListaResuelta();
      },
    });
    this.data.list<DocumentoRelacion>('DocumentoRelacion', { documentoId: doc.id }).subscribe({
      next: (filas) => {
        this.documentosRelacionados.set(filas);
        this.resolverTitulosFaltantes(filas.map((f) => f.documentoRelacionadoId));
        unaListaResuelta();
      },
      error: () => {
        this.documentosRelacionados.set([]);
        unaListaResuelta();
      },
    });
    this.data.list<DocumentoRelacion>('DocumentoRelacion', { documentoRelacionadoId: doc.id }).subscribe({
      next: (filas) => {
        this.documentosQueMeReferencian.set(filas);
        this.resolverTitulosFaltantes(filas.map((f) => f.documentoId));
        unaListaResuelta();
      },
      error: () => {
        this.documentosQueMeReferencian.set([]);
        unaListaResuelta();
      },
    });
  }

  // ---- Autocompletado universal (fn_referencias_sugerencias) ----------
  // Un solo helper genérico: cada campo pide sugerencias ya filtradas por
  // el "sistema" del borrador correspondiente cuando aplica (p.ej. sugerir
  // tablas solo del sistema ya elegido) — el propio TextoSugeridoComponent
  // ya se encarga del debounce de 300ms, el mínimo de 2 caracteres, y de
  // descartar respuestas obsoletas (ver ese componente).

  private sugerirDesdeServidor(
    campo: 'sistema' | 'tabla' | 'esquema' | 'proceso' | 'modulo' | 'pantalla_funcionalidad',
    sistemaFiltro?: () => string | null,
  ): (texto: string) => Promise<SugerenciaTexto[]> {
    return async (texto: string): Promise<SugerenciaTexto[]> => {
      const { data, error } = await this.sb.schema('wikidocs').rpc('fn_referencias_sugerencias', {
        p_campo: campo,
        p_texto: texto,
        p_sistema: sistemaFiltro ? sistemaFiltro() || null : null,
      });
      if (error) return [];
      return ((data ?? []) as Record<string, unknown>[]).map((f) => {
        const fila = filaACamel(f) as { valor: string; sistema: string | null };
        return { valor: fila.valor, sistema: fila.sistema };
      });
    };
  }

  protected readonly sugerirSistema = this.sugerirDesdeServidor('sistema');
  protected readonly sugerirTabla = this.sugerirDesdeServidor('tabla', () => this.draftTabla().sistema || null);
  protected readonly sugerirEsquema = this.sugerirDesdeServidor('esquema', () => this.draftTabla().sistema || null);
  protected readonly sugerirProceso = this.sugerirDesdeServidor('proceso', () => this.draftProceso().sistema || null);
  protected readonly sugerirModulo = this.sugerirDesdeServidor('modulo', () => this.draftModulo().sistema || null);
  protected readonly sugerirPantalla = this.sugerirDesdeServidor(
    'pantalla_funcionalidad',
    () => this.draftModulo().sistema || null,
  );

  // ---- Abrir/cancelar formularios de captura (compartidos alta/edición) ----

  protected agregarReferenciaDesdeMenu(tipo: string): void {
    if (tipo === 'tabla' || tipo === 'proceso' || tipo === 'modulo' || tipo === 'relacion') {
      this.abrirAgregarReferencia(tipo);
    }
  }

  protected abrirAgregarReferencia(tipo: TipoReferenciaUniversal): void {
    if (tipo === 'tabla') this.draftTabla.set(this.draftTablaVacio());
    else if (tipo === 'proceso') this.draftProceso.set(this.draftProcesoVacio());
    else if (tipo === 'modulo') this.draftModulo.set(this.draftModuloVacio());
    else this.draftRelacion.set(this.draftRelacionVacio());
    this.formAbierto.set(tipo);
  }

  protected abrirEditarTabla(fila: DocumentoReferenciaTabla): void {
    this.draftTabla.set({
      id: fila.id,
      sistema: fila.sistema ?? '',
      esquema: fila.esquema ?? '',
      tabla: fila.tabla,
      descripcion: fila.descripcion ?? '',
    });
    this.formAbierto.set('tabla');
  }

  protected abrirEditarProceso(fila: DocumentoReferenciaProceso): void {
    this.draftProceso.set({
      id: fila.id,
      sistema: fila.sistema ?? '',
      proceso: fila.proceso,
      descripcion: fila.descripcion ?? '',
    });
    this.formAbierto.set('proceso');
  }

  protected abrirEditarModulo(fila: DocumentoReferenciaModulo): void {
    this.draftModulo.set({
      id: fila.id,
      sistema: fila.sistema,
      modulo: fila.modulo,
      pantallaFuncionalidad: fila.pantallaFuncionalidad ?? '',
      url: fila.url ?? '',
      descripcion: fila.descripcion ?? '',
    });
    this.formAbierto.set('modulo');
  }

  protected abrirEditarRelacion(fila: DocumentoRelacion): void {
    this.draftRelacion.set({ id: fila.id, documentoRelacionadoId: fila.documentoRelacionadoId, tipo: fila.tipo });
    this.formAbierto.set('relacion');
  }

  /** Cancelar nunca altera datos ya guardados — solo descarta el borrador
   *  en memoria (no hay nada que confirmar: si fuera una edición, la fila
   *  real no se tocó hasta presionar "Guardar cambios"). */
  protected cancelarFormReferencia(): void {
    this.formAbierto.set(null);
  }

  // ---- Normalización y prevención de duplicados (lado cliente) --------
  // La restricción real vive en la base de datos (índices únicos parciales
  // normalizados) — esta validación en Angular solo evita el viaje al
  // servidor para el caso más común (no cubre condiciones de carrera entre
  // dos usuarios guardando al mismo tiempo; eso lo resuelve el índice).

  private normalizar(texto: string): string {
    return texto.trim().toLowerCase();
  }

  private yaExisteTabla(candidato: DraftTabla): boolean {
    return this.tablasReferenciadas().some(
      (f) =>
        f.id !== candidato.id &&
        this.normalizar(f.sistema ?? '') === this.normalizar(candidato.sistema) &&
        this.normalizar(f.esquema ?? '') === this.normalizar(candidato.esquema) &&
        this.normalizar(f.tabla) === this.normalizar(candidato.tabla),
    );
  }

  private yaExisteProceso(candidato: DraftProceso): boolean {
    return this.procesosReferenciados().some(
      (f) =>
        f.id !== candidato.id &&
        this.normalizar(f.sistema ?? '') === this.normalizar(candidato.sistema) &&
        this.normalizar(f.proceso) === this.normalizar(candidato.proceso),
    );
  }

  private yaExisteModulo(candidato: DraftModulo): boolean {
    return this.modulosReferenciados().some(
      (f) =>
        f.id !== candidato.id &&
        this.normalizar(f.sistema) === this.normalizar(candidato.sistema) &&
        this.normalizar(f.modulo) === this.normalizar(candidato.modulo) &&
        this.normalizar(f.pantallaFuncionalidad ?? '') === this.normalizar(candidato.pantallaFuncionalidad),
    );
  }

  /** Mensaje uniforme cuando el propio servidor rechaza un duplicado
   *  (condición de carrera: otro usuario guardó lo mismo un instante antes)
   *  — distingue ese caso de cualquier otro error real. */
  private esErrorDeDuplicado(error: unknown): boolean {
    const mensaje = String((error as { message?: string; code?: string })?.message ?? '').toLowerCase();
    const codigo = (error as { code?: string })?.code ?? '';
    return codigo === '23505' || mensaje.includes('duplicate key') || mensaje.includes('unique');
  }

  // ---- Guardar (alta o edición, según draft.id) ------------------------

  protected guardarTabla(): void {
    const doc = this.documentoActual();
    const draft = this.draftTabla();
    if (!doc || !draft.tabla.trim()) {
      this.toast.advertencia('Escribe el nombre de la tabla.');
      return;
    }
    if (this.yaExisteTabla(draft)) {
      this.toast.advertencia('Ya existe una referencia a esta tabla con el mismo sistema/esquema en este documento.');
      return;
    }
    const dto = {
      documentoId: doc.id,
      sistema: draft.sistema.trim() || null,
      esquema: draft.esquema.trim() || null,
      tabla: draft.tabla.trim(),
      descripcion: draft.descripcion.trim() || null,
    };
    const peticion = draft.id
      ? this.data.modificacion<DocumentoReferenciaTabla>('DocumentoReferenciaTabla', { id: draft.id, ...dto })
      : this.data.alta<DocumentoReferenciaTabla>('DocumentoReferenciaTabla', dto);
    peticion.subscribe({
      next: () => {
        this.toast.exito(draft.id ? 'Referencia actualizada.' : 'Tabla agregada.');
        this.formAbierto.set(null);
        this.cargarReferencias();
      },
      error: (error) =>
        this.toast.error(
          this.esErrorDeDuplicado(error)
            ? 'Ya existe esa referencia para este documento (guardada por otra sesión).'
            : 'No se pudo guardar la referencia.',
        ),
    });
  }

  protected guardarProceso(): void {
    const doc = this.documentoActual();
    const draft = this.draftProceso();
    if (!doc || !draft.proceso.trim()) {
      this.toast.advertencia('Escribe el nombre del proceso.');
      return;
    }
    if (this.yaExisteProceso(draft)) {
      this.toast.advertencia('Ya existe una referencia a este proceso con el mismo sistema en este documento.');
      return;
    }
    const dto = {
      documentoId: doc.id,
      sistema: draft.sistema.trim() || null,
      proceso: draft.proceso.trim(),
      descripcion: draft.descripcion.trim() || null,
    };
    const peticion = draft.id
      ? this.data.modificacion<DocumentoReferenciaProceso>('DocumentoReferenciaProceso', { id: draft.id, ...dto })
      : this.data.alta<DocumentoReferenciaProceso>('DocumentoReferenciaProceso', dto);
    peticion.subscribe({
      next: () => {
        this.toast.exito(draft.id ? 'Referencia actualizada.' : 'Proceso agregado.');
        this.formAbierto.set(null);
        this.cargarReferencias();
      },
      error: (error) =>
        this.toast.error(
          this.esErrorDeDuplicado(error)
            ? 'Ya existe esa referencia para este documento (guardada por otra sesión).'
            : 'No se pudo guardar la referencia.',
        ),
    });
  }

  protected guardarModulo(): void {
    const doc = this.documentoActual();
    const draft = this.draftModulo();
    if (!doc || !draft.sistema.trim() || !draft.modulo.trim()) {
      this.toast.advertencia('El sistema y el módulo son obligatorios.');
      return;
    }
    if (this.yaExisteModulo(draft)) {
      this.toast.advertencia('Ya existe esa misma referencia de módulo/pantalla para este documento.');
      return;
    }
    const urlLimpia = draft.url.trim() || null;
    if (urlLimpia && !this.esUrlSegura(urlLimpia)) {
      this.toast.advertencia('La URL debe comenzar con http:// o https://');
      return;
    }
    const dto = {
      documentoId: doc.id,
      sistema: draft.sistema.trim(),
      modulo: draft.modulo.trim(),
      pantallaFuncionalidad: draft.pantallaFuncionalidad.trim() || null,
      url: urlLimpia,
      descripcion: draft.descripcion.trim() || null,
    };
    const peticion = draft.id
      ? this.data.modificacion<DocumentoReferenciaModulo>('DocumentoReferenciaModulo', { id: draft.id, ...dto })
      : this.data.alta<DocumentoReferenciaModulo>('DocumentoReferenciaModulo', dto);
    peticion.subscribe({
      next: () => {
        this.toast.exito(draft.id ? 'Referencia actualizada.' : 'Módulo agregado.');
        this.formAbierto.set(null);
        this.cargarReferencias();
      },
      error: (error) =>
        this.toast.error(
          this.esErrorDeDuplicado(error)
            ? 'Ya existe esa referencia para este documento (guardada por otra sesión).'
            : 'No se pudo guardar la referencia.',
        ),
    });
  }

  protected guardarRelacion(): void {
    const doc = this.documentoActual();
    const draft = this.draftRelacion();
    if (!doc || !draft.documentoRelacionadoId) {
      this.toast.advertencia('Elige un documento.');
      return;
    }
    const dto = { documentoId: doc.id, documentoRelacionadoId: draft.documentoRelacionadoId, tipo: draft.tipo };
    const peticion = draft.id
      ? this.data.modificacion<DocumentoRelacion>('DocumentoRelacion', { id: draft.id, ...dto })
      : this.data.alta<DocumentoRelacion>('DocumentoRelacion', dto);
    peticion.subscribe({
      next: () => {
        this.toast.exito(draft.id ? 'Relación actualizada.' : 'Documento relacionado agregado.');
        this.formAbierto.set(null);
        this.cargarReferencias();
      },
      error: () => this.toast.error('No se pudo guardar la relación.'),
    });
  }

  // ---- Eliminar (con confirmación) -------------------------------------

  protected pedirQuitarTabla(fila: DocumentoReferenciaTabla): void {
    this.referenciaAEliminar.set({ tipo: 'tabla', id: fila.id, etiqueta: fila.tabla });
  }
  protected pedirQuitarProceso(fila: DocumentoReferenciaProceso): void {
    this.referenciaAEliminar.set({ tipo: 'proceso', id: fila.id, etiqueta: fila.proceso });
  }
  protected pedirQuitarModulo(fila: DocumentoReferenciaModulo): void {
    this.referenciaAEliminar.set({ tipo: 'modulo', id: fila.id, etiqueta: `${fila.sistema} · ${fila.modulo}` });
  }
  protected pedirQuitarRelacion(fila: DocumentoRelacion): void {
    this.referenciaAEliminar.set({
      tipo: 'relacion',
      id: fila.id,
      etiqueta: `${this.textoTipoRelacion(fila.tipo)}: ${this.tituloDocumento(fila.documentoRelacionadoId)}`,
    });
  }

  protected confirmarQuitarReferencia(): void {
    const objetivo = this.referenciaAEliminar();
    if (!objetivo) return;
    const entidad =
      objetivo.tipo === 'tabla'
        ? 'DocumentoReferenciaTabla'
        : objetivo.tipo === 'proceso'
          ? 'DocumentoReferenciaProceso'
          : objetivo.tipo === 'modulo'
            ? 'DocumentoReferenciaModulo'
            : 'DocumentoRelacion';
    this.data.baja(entidad, objetivo.id).subscribe({
      next: () => {
        this.toast.exito('Referencia eliminada.');
        this.referenciaAEliminar.set(null);
        if (this.formAbierto() === objetivo.tipo) this.formAbierto.set(null);
        this.cargarReferencias();
      },
      error: () => this.toast.error('No se pudo eliminar la referencia.'),
    });
  }

  /** Abre el documento relacionado (pestaña "Ver") desde un chip de
   *  Referencias — mismo patrón que onClickContenido() para los enlaces
   *  #wikidoc-id insertados por el editor. */
  abrirDocumentoRelacionado(documentoId: number): void {
    this.data.getById<Documento>('Documento', documentoId).subscribe({
      next: (documento) => this.verDocumento(documento),
      error: () => this.toast.error('No se encontró el documento (puede haber sido eliminado).'),
    });
  }

  /** Salta suavemente al encabezado elegido del índice de contenido. */
  irASeccion(id: string): void {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Intercepta los clicks sobre los enlaces "#wikidoc-<id>" insertados por
   *  el botón 🔖 del editor (ver EditorTextoComponent) dentro del HTML ya
   *  renderizado de la vista "Ver" — evita que el navegador intente
   *  navegar al fragmento y en su lugar carga y muestra ese documento. */
  onClickContenido(evento: MouseEvent): void {
    const objetivo = (evento.target as HTMLElement)?.closest('a');
    if (!objetivo) return;
    const href = objetivo.getAttribute('href') ?? '';
    const coincide = href.match(/^#wikidoc-(\d+)$/);
    if (!coincide) return;

    evento.preventDefault();
    const id = Number(coincide[1]);
    this.data.getById<Documento>('Documento', id).subscribe({
      next: (documento) => this.verDocumento(documento),
      error: () => this.toast.error('No se encontró el documento enlazado (puede haber sido eliminado).'),
    });
  }

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    tipoSistemaId: [0],
    categoriaId: [0],
    seccionId: [0],
    titulo: ['', Validators.required],
    contenido: ['', Validators.required],
  });

  /** Snapshot del formulario al entrar a "editar"/"nuevo" — mismo criterio
   *  que el resto de catálogos homologados (hayCambiosSinGuardar), para
   *  confirmar antes de descartar cambios en Cancelar. */
  private valoresOriginales = '';

  ngOnInit(): void {
    const param = this.route.snapshot.paramMap.get('seccionId');
    this.seccionFijaId = param ? Number(param) : null;

    // Fase B (SAURIX-CAT-001 v1.1): NO se consulta el listado de documentos
    // al abrir la ventana (ver cargar()/buscar() más abajo) — solo los
    // catálogos de apoyo, acotados, que ya necesitaba el formulario de alta
    // y las migajas/columna "Sección".
    if (!this.seccionFijaId) {
      this.data.list<TipoSistemaOpcion>('TipoSistema').subscribe({
        next: (tipos) => this.tiposSistema.set(tipos),
        error: () => this.toast.error('No se pudieron cargar los tipos de sistema.'),
      });
    } else {
      this.cargarMigajas(this.seccionFijaId);
    }

    this.data.list<SeccionOpcion>('Seccion').subscribe((secciones) => this.todasLasSecciones.set(secciones));

    this.data
      .list<PlantillaDocumento>('PlantillaDocumento', { activo: true })
      .subscribe((plantillas) => this.plantillas.set(plantillas));

    // Deep link (p.ej. desde el Asistente Saurix, o desde "Copiar enlace" de
    // este mismo documento): ?documento=123 abre directo ese documento,
    // mismo patrón que ?ticket= en el tablero de Proyectos. Esto NO es
    // "consultar el listado al abrir" — es ir directo a un documento puntual
    // que no pasa por la cuadrícula.
    this.route.queryParamMap.subscribe((params) => {
      const documentoIdParam = Number(params.get('documento')) || 0;
      if (documentoIdParam) {
        this.data.getById<Documento>('Documento', documentoIdParam).subscribe({
          next: (documento) => this.verDocumento(documento),
          error: () => {},
        });
      }

      // Navegación-con-filtro desde el Dashboard de WikiDocs (mandato
      // "Evolución de WikiDocs: Dashboard y Mapa de trazabilidad", nov-2026):
      // un clic en un indicador es tan intencional como presionar "Buscar" —
      // aquí se precargan los filtros correspondientes y se dispara una
      // única búsqueda automática, nunca al abrir la ventana "a secas".
      const tieneFiltroDashboard =
        params.get('soloFavoritos') === '1' ||
        params.get('soloHuerfanos') === '1' ||
        params.get('soloConectados') === '1' ||
        params.get('mostrarInactivos') === '1';
      if (tieneFiltroDashboard) {
        this.soloFavoritosEnEdicion.set(params.get('soloFavoritos') === '1');
        this.soloHuerfanosEnEdicion.set(params.get('soloHuerfanos') === '1');
        this.soloConectadosEnEdicion.set(params.get('soloConectados') === '1');
        this.mostrarInactivosEnEdicion.set(params.get('mostrarInactivos') === '1');
        this.buscar();
      }
    });
  }

  // ── Búsqueda, filtros, orden y paginación server-side ────────────────────

  private async cargar(): Promise<void> {
    this.cargando.set(true);
    const miSecuencia = ++this.secuencia;
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActual() - 1) * tamanio;

    const { data, error } = await this.sb.schema('wikidocs').rpc('fn_documentos_lista_pagina', {
      p_busqueda: this.busquedaAplicada.trim() || null,
      p_seccion_id: this.seccionFijaId,
      p_mostrar_inactivos: this.mostrarInactivosAplicado,
      p_solo_favoritos: this.soloFavoritosAplicado,
      p_solo_huerfanos: this.soloHuerfanosAplicado,
      p_solo_conectados: this.soloConectadosAplicado,
      p_orden_columna: this.columnaOrden(),
      p_orden_direccion: this.direccionOrden(),
      p_desde: desde,
      p_cantidad: tamanio,
      p_etiquetas_id: this.etiquetasFiltroAplicado.length ? this.etiquetasFiltroAplicado : null,
      p_modo_etiquetas: this.modoEtiquetasAplicado,
    });

    if (miSecuencia !== this.secuencia) return;

    if (error) {
      this.cargando.set(false);
      this.toast.error('No se pudo cargar la lista de documentos: ' + error.message);
      return;
    }

    const filas = (data ?? []) as Record<string, unknown>[];
    const primera = filas[0];
    const total = Number(primera?.['total_filas'] ?? 0);
    const desdeEfectivo = Number(primera?.['desde_efectivo'] ?? 0);

    this.registrosPagina.set(filas.map((fila) => filaACamel(fila) as unknown as DocumentoListaFila));
    this.totalFiltrado.set(total);
    this.paginaActual.set(Math.floor(desdeEfectivo / tamanio) + 1);
    this.cargando.set(false);
  }

  private reiniciarYCargar(): void {
    this.paginaActual.set(1);
    void this.cargar();
  }

  protected buscar(): void {
    this.haBuscado.set(true);
    this.busquedaAplicada = this.busquedaEnEdicion();
    this.soloFavoritosAplicado = this.soloFavoritosEnEdicion();
    this.soloHuerfanosAplicado = this.soloHuerfanosEnEdicion();
    this.soloConectadosAplicado = this.soloConectadosEnEdicion();
    this.mostrarInactivosAplicado = this.mostrarInactivosEnEdicion();
    this.etiquetasFiltroAplicado = this.etiquetasFiltroEnEdicion()
      .map((e) => e.id)
      .filter((id): id is number => id !== null);
    this.modoEtiquetasAplicado = this.modoEtiquetasEnEdicion();
    this.reiniciarYCargar();
  }

  protected limpiarFiltros(): void {
    this.busquedaEnEdicion.set('');
    this.soloFavoritosEnEdicion.set(false);
    this.soloHuerfanosEnEdicion.set(false);
    this.soloConectadosEnEdicion.set(false);
    this.mostrarInactivosEnEdicion.set(false);
    this.etiquetasFiltroEnEdicion.set([]);
    this.modoEtiquetasEnEdicion.set('any');
  }

  /** Autocompletado del filtro por etiquetas y del chip-selector del
   *  formulario de documento (ambos comparten este mismo helper) — trae
   *  sugerencias de `wikidocs.fn_etiquetas_sugerencias` con su id real
   *  (a diferencia de `sugerirDesdeServidor`, pensado para
   *  `TextoSugeridoComponent`/`SugerenciaTexto`, que no tiene id). */
  protected readonly sugerirEtiquetas = async (texto: string): Promise<EtiquetaChip[]> => {
    const { data, error } = await this.sb.schema('wikidocs').rpc('fn_etiquetas_sugerencias', { p_texto: texto });
    if (error) return [];
    return ((data ?? []) as Record<string, unknown>[]).map((f) => {
      const fila = filaACamel(f) as { id: number; nombre: string };
      return { id: fila.id, nombre: fila.nombre };
    });
  };

  protected onPaginaCambio(pagina: number): void {
    this.paginaActual.set(pagina);
    void this.cargar();
  }

  protected onOrdenCambio(evento: { campo: keyof DocumentoListaFila & string; direccion: 'asc' | 'desc' }): void {
    this.columnaOrden.set(evento.campo);
    this.direccionOrden.set(evento.direccion);
    this.reiniciarYCargar();
  }

  @HostListener('keydown', ['$event'])
  protected onAtajoTeclado(evento: KeyboardEvent): void {
    if (this.vista() !== 'lista') return;
    if (!evento.altKey || evento.ctrlKey || evento.metaKey) return;
    const tecla = evento.key.toLowerCase();
    if (tecla === 'n') {
      evento.preventDefault();
      this.nuevoDocumento();
    } else if (tecla === 'b') {
      evento.preventDefault();
      this.buscar();
    } else if (tecla === 'l') {
      evento.preventDefault();
      this.limpiarFiltros();
    }
  }

  // ── Favoritos ─────────────────────────────────────────────────────────
  // Sin "carga global" de favoritos: el listado ya trae `esFavorito` por
  // fila (calculado server-side); el estado del documento actualmente
  // abierto (favoritoActual) y el toggle se resuelven con una consulta
  // puntual, acotada a un solo documento, nunca a toda la tabla.

  protected esFavoritoActual(): boolean {
    return this.favoritoActual();
  }

  private resolverFavoritoActual(documentoId: number): void {
    const usuario = this.auth.usuarioActual()?.nombreUsuario;
    if (!usuario) {
      this.favoritoActual.set(false);
      return;
    }
    this.data
      .list<DocumentoFavorito>('DocumentoFavorito', { documentoId, usuario })
      .subscribe((filas) => this.favoritoActual.set(filas.length > 0));
  }

  private marcarFavoritoLocal(documentoId: number, valor: boolean): void {
    if (this.documentoActual()?.id === documentoId) this.favoritoActual.set(valor);
    this.registrosPagina.update((filas) =>
      filas.map((fila) => (fila.id === documentoId ? { ...fila, esFavorito: valor } : fila)),
    );
  }

  toggleFavorito(documentoId: number): void {
    const usuario = this.auth.usuarioActual()?.nombreUsuario;
    if (!usuario) return;

    this.data.list<DocumentoFavorito>('DocumentoFavorito', { documentoId, usuario }).subscribe((filas) => {
      const existente = filas[0];
      if (existente) {
        this.data.baja('DocumentoFavorito', existente.id).subscribe({
          next: () => this.marcarFavoritoLocal(documentoId, false),
          error: () => this.toast.error('No se pudo quitar de favoritos.'),
        });
        return;
      }
      this.data.alta<DocumentoFavorito>('DocumentoFavorito', { documentoId, usuario }).subscribe({
        next: () => this.marcarFavoritoLocal(documentoId, true),
        error: () => this.toast.error('No se pudo marcar como favorito.'),
      });
    });
  }

  protected iconoFavoritoFila = (fila: DocumentoListaFila): string => (fila.esFavorito ? '⭐' : '☆');

  private cargarMigajas(seccionId: number): void {
    this.data.getById<SeccionOpcion>('Seccion', seccionId).subscribe((seccion) => {
      this.seccionFijaNombre = seccion.nombre;
      this.migajas.set([
        { etiqueta: 'Secciones', ruta: '/wikidocs/secciones' },
        { etiqueta: seccion.nombre },
      ]);
    });
  }

  /** Los 3 selects usan formControlName (ver HTML) — el control ya trae el
   *  valor nuevo cuando (change) dispara, así que aquí solo se resetean los
   *  niveles hijos y se recarga la lista en cascada correspondiente. */
  onTipoSistemaCambia(): void {
    const tipoSistemaId = this.form.controls.tipoSistemaId.value;
    this.form.patchValue({ categoriaId: 0, seccionId: 0 });
    this.categorias.set([]);
    this.secciones.set([]);
    if (!tipoSistemaId) return;

    this.data
      .list<CategoriaOpcion>('Categoria', { tipoSistemaId })
      .subscribe((categorias) => this.categorias.set(categorias));
  }

  onCategoriaCambia(): void {
    const categoriaId = this.form.controls.categoriaId.value;
    this.form.patchValue({ seccionId: 0 });
    this.secciones.set([]);
    if (!categoriaId) return;

    this.data.list<SeccionOpcion>('Seccion', { categoriaId }).subscribe((secciones) => this.secciones.set(secciones));
  }

  /** Carga (una sola vez por entrada a edición) la lista acotada para
   *  "Enlazar documento" — ver documentosParaEnlazarBase. */
  private cargarDocumentosParaEnlazar(): void {
    this.sb
      .schema('wikidocs')
      .rpc('fn_documentos_lista_pagina', {
        p_seccion_id: this.seccionFijaId,
        p_orden_columna: 'titulo',
        p_orden_direccion: 'asc',
        p_cantidad: TOPE_DOCUMENTOS_PARA_ENLAZAR,
      })
      .then(({ data, error }: { data: unknown; error: { message: string } | null }) => {
        if (error) return;
        const filas = (data ?? []) as Record<string, unknown>[];
        this.documentosParaEnlazarBase.set(
          filas.map((fila) => ({ id: Number(fila['id']), titulo: String(fila['titulo']) })),
        );
      });
  }

  nuevoDocumento(): void {
    this.documentoActual.set(null);
    this.form.reset({
      id: 0,
      tipoSistemaId: 0,
      categoriaId: 0,
      seccionId: this.seccionFijaId ?? 0,
      titulo: '',
      contenido: '',
    });
    this.categorias.set([]);
    this.secciones.set([]);
    this.favoritoActual.set(false);
    this.etiquetasDocumento.set([]);
    this.valoresOriginales = this.snapshotFormulario();
    this.cargarDocumentosParaEnlazar();
    this.vista.set('editar');
  }

  /** Precarga el contenido del formulario con el de la plantilla elegida —
   *  solo tiene sentido al crear (esNuevo()), nunca sobrescribe un
   *  documento ya existente. Vuelve a dejar "Selecciona..." después, para
   *  poder aplicar otra plantilla distinta sin recargar la pantalla. */
  onPlantillaCambia(idTexto: string): void {
    const id = Number(idTexto);
    if (!id) return;
    const plantilla = this.plantillas().find((p) => p.id === id);
    if (plantilla) this.form.patchValue({ contenido: plantilla.contenido });
  }

  verDocumento(documento: Documento): void {
    this.documentoActual.set(documento);
    this.resolverFavoritoActual(documento.id);
    this.contadorAdjuntos.set(null);
    this.contadorHistorial.set(null);
    this.contadorReferencias.set(null);
    this.vista.set('ver');
  }

  /** Acción "Ver" desde una fila de la cuadrícula — la fila del listado no
   *  trae `contenido` a propósito (ver DocumentoListaFila), así que se pide
   *  el documento completo antes de mostrarlo. */
  verDesdeFila(fila: DocumentoListaFila): void {
    this.data.getById<Documento>('Documento', fila.id).subscribe({
      next: (documento) => this.verDocumento(documento),
      error: () => this.toast.error('No se pudo abrir el documento.'),
    });
  }

  editarDocumento(documento: Documento): void {
    this.documentoActual.set(documento);
    this.resolverFavoritoActual(documento.id);
    this.cargarFormDesde(documento);
    this.cargarDocumentosParaEnlazar();
    this.vista.set('editar');
  }

  /** Acción "Editar" desde una fila de la cuadrícula — mismo motivo que
   *  verDesdeFila(): hay que traer el documento completo primero. */
  editarDesdeFila(fila: DocumentoListaFila): void {
    this.data.getById<Documento>('Documento', fila.id).subscribe({
      next: (documento) => this.editarDocumento(documento),
      error: () => this.toast.error('No se pudo abrir el documento para editar.'),
    });
  }

  cambiarTab(tab: 'ver' | 'editar' | 'adjuntos' | 'historial' | 'referencias'): void {
    if (tab === 'editar') {
      const doc = this.documentoActual();
      if (doc) {
        this.cargarFormDesde(doc);
        this.cargarDocumentosParaEnlazar();
      }
    }
    if (tab === 'historial') this.cargarVersiones();
    if (tab === 'referencias') {
      this.formAbierto.set(null);
      this.cargarReferencias();
    }
    this.vista.set(tab);
  }

  private cargarVersiones(): void {
    const doc = this.documentoActual();
    if (!doc) return;
    this.data
      .list<DocumentoVersion>('DocumentoVersion', { documentoId: doc.id })
      .subscribe((versiones) => {
        // Más reciente primero.
        const ordenadas = [...versiones].sort((a, b) => (b.fechaCreacion ?? '').localeCompare(a.fechaCreacion ?? ''));
        this.versiones.set(ordenadas);
        this.contadorHistorial.set(ordenadas.length);
      });
  }

  pedirRestaurar(version: DocumentoVersion): void {
    this.versionARestaurar.set(version);
  }

  confirmarRestaurar(): void {
    const version = this.versionARestaurar();
    const doc = this.documentoActual();
    if (!version || !doc) return;

    // La versión que se está por reemplazar también se guarda como
    // snapshot antes de restaurar, así "restaurar" nunca es un camino sin
    // vuelta atrás — queda en el historial igual que cualquier otra edición.
    this.data
      .alta<DocumentoVersion>('DocumentoVersion', {
        documentoId: doc.id,
        titulo: doc.titulo,
        contenido: doc.contenido,
        usuario: this.auth.usuarioActual()?.nombreUsuario ?? 'desconocido',
      })
      .subscribe(() => {
        this.data
          .modificacion<Documento>('Documento', { ...doc, titulo: version.titulo, contenido: version.contenido })
          .subscribe({
            next: (documento) => {
              this.toast.exito('Versión restaurada.');
              this.documentoActual.set(documento);
              this.versionARestaurar.set(null);
              this.cargarVersiones();
              this.vista.set('ver');
            },
            error: () => this.toast.error('No se pudo restaurar la versión.'),
          });
      });
  }

  private cargarFormDesde(documento: Documento): void {
    this.form.reset({
      id: documento.id,
      tipoSistemaId: 0,
      categoriaId: 0,
      seccionId: documento.seccionId,
      titulo: documento.titulo,
      contenido: documento.contenido,
    });
    this.categorias.set([]);
    this.secciones.set([]);
    this.etiquetasDocumento.set([]);

    // El snapshot para hayCambiosSinGuardar() necesita esperar a que
    // terminen LAS DOS cargas asíncronas que alimentan el formulario: la
    // cascada Sección→Categoría→Tipo de sistema (como siempre) y, desde el
    // Mandato 90, la precarga de etiquetas ya asignadas (ver
    // cargarEtiquetasDocumento) — mismo criterio de "varias cargas en
    // paralelo, avisar solo cuando todas terminen" que cargarReferencias().
    // Tomarlo antes de que ambas terminen marcaría como "sin cambios" un
    // estado todavía incompleto.
    let pendientes = 2;
    const terminar = () => {
      pendientes--;
      if (pendientes === 0) this.valoresOriginales = this.snapshotFormulario();
    };

    this.cargarEtiquetasDocumento(documento.id, terminar);

    if (this.seccionFijaId) {
      terminar();
      return;
    }

    // Documento solo guarda su seccionId — para que Tipo de sistema y
    // Categoría aparezcan ya seleccionados (con sus listas en cascada
    // cargadas) al editar, hay que subir la jerarquía real: Seccion →
    // Categoria → TipoSistema (ver documento.model.ts).
    this.data.getById<SeccionOpcion>('Seccion', documento.seccionId).subscribe((seccion) => {
      this.data
        .list<SeccionOpcion>('Seccion', { categoriaId: seccion.categoriaId })
        .subscribe((secciones) => this.secciones.set(secciones));

      this.data.getById<CategoriaOpcion>('Categoria', seccion.categoriaId).subscribe((categoria) => {
        this.data
          .list<CategoriaOpcion>('Categoria', { tipoSistemaId: categoria.tipoSistemaId })
          .subscribe((categorias) => this.categorias.set(categorias));

        this.form.patchValue({ tipoSistemaId: categoria.tipoSistemaId, categoriaId: categoria.id });
        terminar();
      });
    });
  }

  /** Precarga los chips de etiquetas ya asignadas a un documento al entrar
   *  a "Editar" — `fn_documentos_lista_pagina` solo trae un recorte de 3 +
   *  total (pensado para la columna de la cuadrícula, ver
   *  DocumentoListaFila), así que aquí se usa la función de lectura
   *  dedicada que trae el conjunto COMPLETO con su id real (necesario para
   *  poder enviarlo luego como p_etiquetas_id si no cambia, ver guardar()).
   *  `alTerminar` es el aviso opcional para el join con la cascada de
   *  Sección→Categoría→Tipo de sistema, ver cargarFormDesde(). */
  private cargarEtiquetasDocumento(documentoId: number, alTerminar?: () => void): void {
    this.sb
      .schema('wikidocs')
      .rpc('fn_documento_etiquetas_listar', { p_documento_id: documentoId })
      .then(({ data, error }: { data: unknown; error: { message: string } | null }) => {
        if (!error) {
          const filas = (data ?? []) as Record<string, unknown>[];
          this.etiquetasDocumento.set(
            filas.map((f) => filaACamel(f) as unknown as Etiqueta).map((e) => ({ id: e.id, nombre: e.nombre })),
          );
        }
        alTerminar?.();
      });
  }

  /** Snapshot para hayCambiosSinGuardar() — además de los campos del
   *  FormGroup (como antes), incluye las etiquetas capturadas (Mandato 90):
   *  normalizadas y ordenadas, para que solo un cambio REAL en el conjunto
   *  de etiquetas (agregar/quitar una) cuente como "cambio sin guardar",
   *  nunca el simple orden en que se fueron agregando. */
  private snapshotFormulario(): string {
    const etiquetas = this.etiquetasDocumento()
      .map((e) => e.nombre.trim().toLowerCase())
      .sort();
    return JSON.stringify({ form: this.form.getRawValue(), etiquetas });
  }

  volverALista(): void {
    this.documentoActual.set(null);
    this.vista.set('lista');
    if (this.haBuscado()) void this.cargar();
  }

  private hayCambiosSinGuardar(): boolean {
    return this.snapshotFormulario() !== this.valoresOriginales;
  }

  protected readonly avisoCierreVisible = signal(false);

  cancelarEdicion(): void {
    if (!this.hayCambiosSinGuardar()) {
      this.toast.info('Cambios descartados.');
      this.volverALista();
      return;
    }
    this.avisoCierreVisible.set(true);
  }

  protected confirmarCierreSinGuardar(): void {
    this.avisoCierreVisible.set(false);
    this.toast.info('Cambios descartados.');
    this.volverALista();
  }

  protected cancelarCierreSinGuardar(): void {
    this.avisoCierreVisible.set(false);
  }

  guardar(): void {
    const valorBruto = this.form.getRawValue();
    const seccionValida = !!valorBruto.seccionId;
    const contenidoValido = !this.contenidoEstaVacio(valorBruto.contenido);

    if (this.form.get('titulo')!.invalid || !seccionValida || !contenidoValido) {
      this.form.markAllAsTouched();
      if (!seccionValida) this.toast.advertencia('Selecciona tipo de sistema, categoría y sección.');
      else if (!contenidoValido) this.toast.advertencia('Escribe el contenido del documento.');
      else this.toast.advertencia('Revisa el título del documento.');
      return;
    }

    const documentoPrevio = this.documentoActual();
    const esEdicion = documentoPrevio !== null;

    // Mandato 90 §2.1 + Mandato 90.1 §2: alta/edición del documento, el
    // snapshot de DocumentoVersion (cómo se veía ANTES de este cambio) Y
    // la sincronización de etiquetas ocurren ahora en UNA SOLA transacción
    // server-side (fn_documento_etiquetas_sincronizar) — ya no dos pasos
    // independientes con el historial resuelto aparte desde Angular: si
    // algo falla a medio camino (guardado del documento, sincronización de
    // etiquetas), nada queda a medias, tampoco una fila de historial
    // huérfana de un guardado que en realidad nunca se completó. Las ya
    // elegidas de una sugerencia (con id real) viajan en p_etiquetas_id;
    // las escritas como texto libre que todavía no existen (id null)
    // viajan en p_etiquetas_nuevas y se resuelven adentro de esa misma
    // transacción (reutilizando la existente sin tocar su auditoría si el
    // nombre ya estaba en el catálogo, normalizado).
    const etiquetas = this.etiquetasDocumento();
    const etiquetasId = etiquetas.filter((e) => e.id !== null).map((e) => e.id as number);
    const etiquetasNuevas = etiquetas.filter((e) => e.id === null).map((e) => e.nombre);

    const guardarDocumento = async (): Promise<void> => {
      const { data, error } = await this.sb.schema('wikidocs').rpc('fn_documento_etiquetas_sincronizar', {
        p_documento_id: esEdicion ? documentoPrevio!.id : null,
        p_seccion_id: valorBruto.seccionId,
        p_titulo: valorBruto.titulo,
        p_contenido: valorBruto.contenido,
        p_etiquetas_id: etiquetasId.length ? etiquetasId : null,
        p_etiquetas_nuevas: etiquetasNuevas.length ? etiquetasNuevas : null,
        // p_usuario YA NO se usa para la auditoría (Mandato 90.1 §1: el
        // servidor resuelve la identidad real vía auth.uid(), nunca lo
        // que mande el cliente, para que nadie pueda registrar un cambio
        // en el historial a nombre de otra persona) — se deja de mandar.
        //
        // Control de concurrencia optimista (Mandato 90.1 §1): el token
        // es fechaModificacion si el documento ya se editó antes, o
        // fechaCreacion si todavía no (coincide con el COALESCE que usa
        // el servidor) — así la PRIMERA edición de un documento recién
        // creado también queda protegida, no solo las siguientes. En
        // alta de documento nuevo va en null (no aplica, no hay nada
        // previo que proteger).
        p_fecha_modificacion_esperada: esEdicion
          ? (documentoPrevio!.fechaModificacion ?? documentoPrevio!.fechaCreacion ?? null)
          : null,
      });

      if (error) {
        // 40001 = serialization_failure: el servidor detectó que otro
        // usuario guardó este documento mientras este formulario seguía
        // abierto (o que faltó el token de concurrencia). El formulario
        // NUNCA se cierra solo ni se pierde lo escrito — el usuario
        // decide si recarga (perdiendo su borrador) o copia su texto
        // aparte antes de hacerlo.
        if (error.code === '40001') {
          this.toast.advertencia(
            'Este documento fue modificado por otro usuario mientras lo editabas. Copia tus cambios si los necesitas y vuelve a abrirlo para continuar.',
          );
        } else {
          this.toast.error('No se pudo guardar el documento. Intenta de nuevo.');
        }
        return;
      }

      const documentoId = data as number;
      this.data.getById<Documento>('Documento', documentoId).subscribe({
        next: (documento) => {
          this.toast.exito(esEdicion ? 'Documento actualizado.' : 'Documento creado.');
          this.documentoActual.set(documento);
          this.resolverFavoritoActual(documento.id);
          // Refresca con los ids reales (las recién creadas quedaron con
          // id null en memoria) — snapshotFormulario() solo compara
          // nombres normalizados, así que esto no afecta el "sin cambios"
          // que se fija justo después.
          this.cargarEtiquetasDocumento(documento.id);
          this.valoresOriginales = this.snapshotFormulario();
          this.vista.set('ver');
          if (this.haBuscado()) void this.cargar();
        },
        error: () => this.toast.error('El documento se guardó, pero no se pudo recargar su información.'),
      });
    };

    void guardarDocumento();
  }

  private renderParaDescarga(documento: Documento): string {
    return insertarEmbeds(this.aHtml(documento.contenido));
  }

  /** Genera un PDF del documento actual a partir del mismo HTML ya usado
   *  para "Descargar" (.html) — se renderiza en un contenedor invisible
   *  fuera de pantalla, se rasteriza con html2canvas directamente (no con
   *  el envoltorio `jsPDF.html()`) y el canvas resultante se recorta en
   *  franjas del alto de una hoja carta que se insertan como imagen con
   *  `pdf.addImage`, una por página.
   *
   *  Se abandonó `jsPDF.html()` después de varias vueltas: esa función usa
   *  por dentro un "contexto 2D" propio de jsPDF que traduce las órdenes
   *  de dibujo de html2canvas directo a operaciones del PDF, envolviendo
   *  todo en un overlay invisible que la propia librería posiciona sola
   *  (fijo en `left:-100000px`, sin importar cómo se posicione el
   *  contenedor que uno le pasa). La consola confirmó que html2canvas SÍ
   *  renderizaba bien ("Finished rendering", sin errores) — el PDF salía
   *  en blanco en el paso posterior, dentro de esa caja negra de jsPDF.
   *  Rasterizar nosotros mismos con html2canvas y pegar el resultado con
   *  `addImage` es el patrón estándar y evita ese envoltorio por completo.
   *  Costo: el texto del PDF queda como imagen, no seleccionable/buscable. */
  async exportarPdf(documento: Documento): Promise<void> {
    const contenedor = document.createElement('div');
    contenedor.style.cssText =
      'position:absolute; left:-9999px; top:0; width:700px; padding:24px; ' +
      'font-family: Helvetica, Arial, sans-serif; color:#111; background:#fff;';
    contenedor.innerHTML =
      `<h1 style="font-size:22px;margin:0 0 4px;">${documento.titulo}</h1>` +
      `<p style="font-size:11px;color:#666;margin:0 0 16px;">Última modificación: ${this.formatearFecha(documento)}</p>` +
      this.renderParaDescarga(documento);
    document.body.appendChild(contenedor);

    this.toast.info('Generando PDF…');
    try {
      const canvas = await html2canvas(contenedor, {
        scale: 2, // más nitidez, ya que el texto queda rasterizado
        backgroundColor: '#ffffff',
        useCORS: true,
      });

      const pdf = new jsPDF({ unit: 'pt', format: 'letter' });
      const margen = 24;
      const anchoUtil = pdf.internal.pageSize.getWidth() - margen * 2;
      const altoUtilPt = pdf.internal.pageSize.getHeight() - margen * 2;
      const escalaPxAPt = anchoUtil / canvas.width; // puntos PDF por cada píxel del canvas
      const altoUtilPx = altoUtilPt / escalaPxAPt; // cuántos píxeles del canvas caben en una hoja

      let recortadoPx = 0;
      let esPrimeraPagina = true;
      while (recortadoPx < canvas.height) {
        const alturaFranjaPx = Math.min(altoUtilPx, canvas.height - recortadoPx);

        const franja = document.createElement('canvas');
        franja.width = canvas.width;
        franja.height = alturaFranjaPx;
        franja.getContext('2d')!.drawImage(canvas, 0, recortadoPx, canvas.width, alturaFranjaPx, 0, 0, canvas.width, alturaFranjaPx);

        if (!esPrimeraPagina) pdf.addPage();
        pdf.addImage(franja.toDataURL('image/png'), 'PNG', margen, margen, anchoUtil, alturaFranjaPx * escalaPxAPt);

        recortadoPx += alturaFranjaPx;
        esPrimeraPagina = false;
      }

      pdf.save(`${documento.titulo || 'documento'}.pdf`);
    } catch (error) {
      console.error('No se pudo generar el PDF del documento:', error);
      this.toast.error('No se pudo generar el PDF. Intenta de nuevo.');
    } finally {
      document.body.removeChild(contenedor);
    }
  }

  /** Los documentos creados con el editor visual ya guardan HTML; los
   *  creados antes (Markdown puro) se siguen renderizando con `marked`,
   *  detectado por la presencia de etiquetas HTML típicas. */
  private aHtml(contenido: string): string {
    const crudo = contenido || '';
    if (/<\/?(p|div|h[1-6]|ul|ol|li|img|a\s|strong|em|table|br)[ >]/i.test(crudo)) return crudo;
    return marked.parse(crudo, { async: false }) as string;
  }

  private textoPlano(html: string): string {
    return (html || '').replace(/<[^>]*>/g, ' ');
  }

  private contenidoEstaVacio(html: string): boolean {
    return this.textoPlano(html).trim().length === 0;
  }

  descargar(documento: Documento): void {
    const meta = `Última modificación: ${this.formatearFecha(documento)}`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${documento.titulo}</title></head><body><h1>${documento.titulo}</h1><p>${meta}</p>${this.renderParaDescarga(documento)}</body></html>`;
    this.descargarBlob(`${documento.titulo || 'documento'}.html`, html);
  }

  /** Copia al portapapeles el enlace directo a este documento
   *  (`?documento=<id>`, el mismo deep link que ya acepta ngOnInit) —
   *  Mandato 89. Usa la ruta actual (sirve igual para /wikidocs/documentos
   *  y /wikidocs/secciones/:id/documentos). */
  async copiarEnlace(): Promise<void> {
    const doc = this.documentoActual();
    if (!doc) return;
    const url = `${location.origin}${location.pathname}?documento=${doc.id}`;
    try {
      await navigator.clipboard.writeText(url);
      this.toast.exito('Enlace copiado al portapapeles.');
    } catch {
      this.toast.error('No se pudo copiar el enlace. Cópialo manualmente: ' + url);
    }
  }

  // ---------------- Duplicar documento (Mandato 90 §6, nov-2026) ---------
  // Tarjeta oculta hasta pedirse (mismo patrón que la pestaña Referencias,
  // ver formAbierto/ConfirmDialogComponent sin slot de contenido) — se
  // ofrece desde la fila de la cuadrícula (accionExtra3) y desde el header
  // de la pestaña "Ver" del documento abierto; a propósito NUNCA desde la
  // pestaña "Editar" (protección de cambios pendientes, §6.6): duplicar
  // siempre parte de la ÚLTIMA VERSIÓN GUARDADA en la base — ofrecerlo
  // también mientras hay cambios sin guardar en el formulario induciría a
  // pensar que esos cambios en pantalla (todavía no persistidos) se
  // incluirían en la copia, cuando en realidad nunca es así.

  private draftDuplicarVacio(origen: { titulo: string; seccionId: number }): DraftDuplicar {
    return {
      titulo: `Copia de ${origen.titulo}`,
      seccionId: this.seccionFijaId ?? origen.seccionId,
      copiarContenido: true,
      copiarEtiquetas: true,
      copiarReferenciasTablas: true,
      copiarReferenciasProcesos: true,
      copiarReferenciasModulos: true,
      copiarRelacionados: false,
    };
  }

  protected readonly documentoADuplicar = signal<{ id: number; titulo: string; seccionId: number } | null>(null);
  protected readonly draftDuplicar = signal<DraftDuplicar>(this.draftDuplicarVacio({ titulo: '', seccionId: 0 }));
  protected readonly guardandoDuplicado = signal(false);
  private claveIdempotenciaDuplicar = '';

  /** Opciones de sección de destino para "Duplicar" — igual universo que
   *  la columna "Sección" de la cuadrícula (todasLasSecciones, ya cargado
   *  de siempre), sin la cascada Tipo de sistema→Categoría del alta normal
   *  (aquí alcanza con elegir directo entre todas, vía selector
   *  buscable). */
  protected readonly opcionesSeccionDuplicar = computed<OpcionBuscable[]>(() =>
    this.todasLasSecciones().map((s) => ({ valor: s.id, etiqueta: s.nombre })),
  );

  protected pedirDuplicar(origen: { id: number; titulo: string; seccionId: number }): void {
    this.documentoADuplicar.set(origen);
    this.draftDuplicar.set(this.draftDuplicarVacio(origen));
    // Se genera UNA sola vez al abrir el formulario, no en cada intento de
    // envío — así un reintento del mismo clic (doble click, reintento de
    // red) comparte la misma clave y fn_documento_duplicar lo resuelve de
    // forma idempotente (nunca crea un segundo documento); una duplicación
    // deliberadamente nueva (cerrar y volver a pedir "Duplicar") sí
    // obtiene una clave nueva.
    this.claveIdempotenciaDuplicar = crypto.randomUUID();
    this.guardandoDuplicado.set(false);
  }

  protected cancelarDuplicar(): void {
    this.documentoADuplicar.set(null);
  }

  protected async confirmarDuplicar(): Promise<void> {
    const origen = this.documentoADuplicar();
    const draft = this.draftDuplicar();
    if (!origen || this.guardandoDuplicado()) return;

    if (!draft.titulo.trim()) {
      this.toast.advertencia('Escribe un título para la copia.');
      return;
    }
    if (!draft.seccionId) {
      this.toast.advertencia('Elige la sección de destino.');
      return;
    }

    this.guardandoDuplicado.set(true);
    const { data, error } = await this.sb.schema('wikidocs').rpc('fn_documento_duplicar', {
      p_documento_id: origen.id,
      p_titulo: draft.titulo.trim(),
      p_seccion_id: draft.seccionId,
      p_copiar_contenido: draft.copiarContenido,
      p_copiar_etiquetas: draft.copiarEtiquetas,
      p_copiar_referencias_tablas: draft.copiarReferenciasTablas,
      p_copiar_referencias_procesos: draft.copiarReferenciasProcesos,
      p_copiar_referencias_modulos: draft.copiarReferenciasModulos,
      p_copiar_relacionados: draft.copiarRelacionados,
      p_clave_idempotencia: this.claveIdempotenciaDuplicar,
    });
    this.guardandoDuplicado.set(false);

    if (error) {
      this.toast.error('No se pudo duplicar el documento: ' + error.message);
      return;
    }

    const nuevoId = data as number;
    this.documentoADuplicar.set(null);
    // Nunca regresa a la lista ni dispara una búsqueda — abre de una vez el
    // documento recién creado, directo en modo edición (para revisar antes
    // de darlo por terminado), igual que si se acabara de dar de alta.
    this.data.getById<Documento>('Documento', nuevoId).subscribe({
      next: (documento) => {
        this.toast.exito('Documento duplicado.');
        this.editarDocumento(documento);
      },
      error: () => this.toast.error('El documento se duplicó, pero no se pudo abrir automáticamente.'),
    });
  }

  /** Descarga TODOS los documentos ACTIVOS de la sección actual (solo
   *  disponible en la vista ya filtrada por sección) en un único archivo
   *  HTML — igual que "downloadSection" en el prototipo de referencia.
   *
   *  A propósito NO reutiliza `registrosPagina` (que no trae `contenido`,
   *  ver DocumentoListaFila) ni pide "todos los documentos" sueltos: pagina
   *  en lotes con el mismo `DataClientService.listarPagina()` genérico que
   *  ya soporta un filtro de una sola columna (`seccionId`/`activo`), igual
   *  que el patrón ya usado para exportar CSV en otros catálogos. Acción
   *  explícita y poco frecuente — no afecta el listado normal. */
  async descargarSeccion(): Promise<void> {
    if (!this.seccionFijaId) return;
    this.toast.info('Preparando descarga…');

    const todos: Documento[] = [];
    let desde = 0;
    let total = Infinity;
    try {
      while (desde < total) {
        const { filas, total: totalReal } = await new Promise<{ filas: Documento[]; total: number }>(
          (resolve, reject) => {
            this.data
              .listarPagina<Documento>('Documento', { seccionId: this.seccionFijaId, activo: true }, desde, TAMANO_LOTE_DESCARGA_SECCION)
              .subscribe({ next: resolve, error: reject });
          },
        );
        if (filas.length === 0) break;
        todos.push(...filas);
        total = totalReal;
        desde += TAMANO_LOTE_DESCARGA_SECCION;
      }
    } catch {
      this.toast.error('No se pudo preparar la descarga de la sección.');
      return;
    }

    if (todos.length === 0) {
      this.toast.advertencia('No hay documentos activos para descargar en esta sección.');
      return;
    }

    const titulo = this.seccionFijaNombre || 'Sección';
    const partes = [`<h1>${titulo}</h1>`];
    todos.forEach((doc, indice) => {
      if (indice > 0) partes.push('<hr>');
      partes.push(`<h2>${doc.titulo}</h2>`);
      partes.push(`<p>Última modificación: ${this.formatearFecha(doc)}</p>`);
      partes.push(this.renderParaDescarga(doc));
    });
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${titulo}</title></head><body>${partes.join('')}</body></html>`;
    this.descargarBlob(`${titulo}.html`, html);
  }

  private descargarBlob(nombreArchivo: string, html: string): void {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = nombreArchivo;
    enlace.click();
    URL.revokeObjectURL(url);
  }

  protected formatearFecha(documento: Documento): string {
    const iso = documento.fechaModificacion ?? documento.fechaCreacion;
    if (!iso) return 'sin registrar';
    return new Date(iso).toLocaleString('es-MX');
  }

  pedirEliminar(fila: DocumentoListaFila): void {
    this.documentoAEliminar.set(fila);
  }

  confirmarEliminar(): void {
    const fila = this.documentoAEliminar();
    if (!fila) return;

    this.data.baja('Documento', fila.id).subscribe({
      next: () => {
        this.toast.exito('Documento eliminado.');
        this.documentoAEliminar.set(null);
        if (this.documentoActual()?.id === fila.id) {
          this.volverALista();
          return;
        }
        if (this.registrosPagina().length === 1 && this.paginaActual() > 1) {
          this.paginaActual.update((p) => p - 1);
        }
        if (this.haBuscado()) void this.cargar();
      },
      error: () => this.toast.error('No se pudo eliminar el documento. Intenta de nuevo.'),
    });
  }
}

import { ChangeDetectionStrategy, Component, HostListener, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
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
import { DESTINOS } from '../../shared/utils/navegacion-destinos.util';
import {
  CategoriaOpcion,
  Documento,
  DocumentoFavorito,
  DocumentoReferenciaModulo,
  DocumentoReferenciaProceso,
  DocumentoReferenciaTabla,
  DocumentoRelacion,
  DocumentoVersion,
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
 * con una sección fija, todo este paso se omite.
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
 * pestaña Referencias, navegación profunda por `?documento=` — sigue
 * exactamente igual, usando `DataClientService` como antes.
 */
@Component({
  selector: 'app-documentos-list',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    DataTableComponent,
    ConfirmDialogComponent,
    AdjuntosPanelComponent,
    EditorTextoComponent,
    SelectBuscableComponent,
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
  protected readonly mostrarInactivosEnEdicion = signal(false);
  private busquedaAplicada = '';
  private soloFavoritosAplicado = false;
  private soloHuerfanosAplicado = false;
  private mostrarInactivosAplicado = false;

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
   *  el selector "Enlazar documento" del editor — se carga una sola vez al
   *  entrar a "editar"/"nuevo", reutilizando la misma función RPC del
   *  listado (que ya excluye `contenido`), nunca la carga completa de
   *  `list('Documento')` que existía antes. */
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
   *  que si no se queda angosto aunque el padre se ensanche. "Adjuntos"/
   *  "Historial"/"Referencias" se dejan con el ancho angosto por defecto,
   *  ya que no tienen el mismo problema. Este effect mantiene `data-wide`
   *  sincronizado con la vista actual en vez de dejarlo fijo todo el tiempo
   *  que el componente está montado, y lo quita al salir de la pantalla
   *  (onCleanup corre tanto entre cambios de vista como al destruirse el
   *  componente). */
  private readonly _anchoSegunVista = effect((onCleanup) => {
    const vista = this.vista();
    if (vista === 'lista' || vista === 'ver' || vista === 'editar') {
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

  /** Encabezados (h1/h2/h3) del documento actual + el mismo HTML con esos
   *  encabezados ya con id — una sola pasada para no parsear el HTML dos
   *  veces (una vez para el índice, otra para el contenido mostrado). */
  private readonly tocYContenido = computed(() => {
    const doc = this.documentoActual();
    const html = doc ? this.aHtml(doc.contenido) : '';
    return generarTablaContenido(insertarEmbeds(html));
  });

  /** Índice de contenido de la vista "Ver" — solo tiene caso mostrarlo
   *  cuando el documento realmente tiene varias secciones. */
  protected readonly tablaContenido = computed(() => {
    const items = this.tocYContenido().items;
    return items.length > 1 ? items : [];
  });

  protected readonly contenidoRenderizado = computed<SafeHtml>(() => {
    return this.sanitizer.bypassSecurityTrustHtml(this.tocYContenido().html);
  });

  // ---------------- Referencias (trazabilidad) ----------------
  // Pestaña "Referencias": permite anotar en qué tablas/procesos/módulos
  // se apoya este documento, y con qué otros documentos se relaciona. Ver
  // DocumentoReferenciaTabla/Proceso/Modulo y DocumentoRelacion en
  // documento.model.ts. Mismo patrón de alta/baja inmediata por registro
  // que TicketEtiqueta/TicketDependencia en el tablero Kanban.

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

  protected readonly formNuevaTabla = this.fb.nonNullable.group({ texto: ['', Validators.required] });
  protected readonly formNuevoProceso = this.fb.nonNullable.group({ texto: ['', Validators.required] });

  /** Opciones para "+ Agregar módulo": todas las pantallas reales del
   *  sistema (mismo catálogo que ya usa la paleta de comandos), menos las
   *  que este documento ya referencia. */
  protected readonly opcionesModulo = computed<OpcionBuscable[]>(() => {
    const yaAgregadas = new Set(this.modulosReferenciados().map((m) => m.ruta));
    return DESTINOS.filter((d) => !yaAgregadas.has(d.ruta)).map((d) => ({
      valor: d.ruta,
      etiqueta: d.label,
      grupo: d.grupo,
    }));
  });
  protected readonly moduloAAgregar = signal<string | null>(null);

  /** Opciones para "+ Agregar documento relacionado": igual que
   *  documentosParaEnlazar (sin el propio documento), menos los que ya
   *  están relacionados. */
  protected readonly opcionesDocumentoRelacionado = computed<OpcionBuscable[]>(() => {
    const yaAgregados = new Set(this.documentosRelacionados().map((r) => r.documentoRelacionadoId));
    return this.documentosParaEnlazar()
      .filter((d) => !yaAgregados.has(d.id))
      .map((d) => ({ valor: d.id, etiqueta: d.titulo }));
  });
  protected readonly documentoRelacionadoAAgregar = signal<number | null>(null);
  protected readonly tipoRelacionAAgregar = signal<TipoRelacionDocumento>('relacionado');
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

  private cargarReferencias(): void {
    const doc = this.documentoActual();
    if (!doc) return;
    this.data
      .list<DocumentoReferenciaTabla>('DocumentoReferenciaTabla', { documentoId: doc.id })
      .subscribe({ next: (filas) => this.tablasReferenciadas.set(filas), error: () => this.tablasReferenciadas.set([]) });
    this.data
      .list<DocumentoReferenciaProceso>('DocumentoReferenciaProceso', { documentoId: doc.id })
      .subscribe({ next: (filas) => this.procesosReferenciados.set(filas), error: () => this.procesosReferenciados.set([]) });
    this.data
      .list<DocumentoReferenciaModulo>('DocumentoReferenciaModulo', { documentoId: doc.id })
      .subscribe({ next: (filas) => this.modulosReferenciados.set(filas), error: () => this.modulosReferenciados.set([]) });
    this.data
      .list<DocumentoRelacion>('DocumentoRelacion', { documentoId: doc.id })
      .subscribe({
        next: (filas) => {
          this.documentosRelacionados.set(filas);
          this.resolverTitulosFaltantes(filas.map((f) => f.documentoRelacionadoId));
        },
        error: () => this.documentosRelacionados.set([]),
      });
    this.data
      .list<DocumentoRelacion>('DocumentoRelacion', { documentoRelacionadoId: doc.id })
      .subscribe({
        next: (filas) => {
          this.documentosQueMeReferencian.set(filas);
          this.resolverTitulosFaltantes(filas.map((f) => f.documentoId));
        },
        error: () => this.documentosQueMeReferencian.set([]),
      });
  }

  agregarTablaReferenciada(): void {
    const doc = this.documentoActual();
    if (!doc || this.formNuevaTabla.invalid) return;
    this.data
      .alta<DocumentoReferenciaTabla>('DocumentoReferenciaTabla', {
        documentoId: doc.id,
        texto: this.formNuevaTabla.controls.texto.value,
      })
      .subscribe(() => {
        this.formNuevaTabla.reset({ texto: '' });
        this.cargarReferencias();
      });
  }

  quitarTablaReferenciada(fila: DocumentoReferenciaTabla): void {
    this.data.baja('DocumentoReferenciaTabla', fila.id).subscribe(() => this.cargarReferencias());
  }

  agregarProcesoReferenciado(): void {
    const doc = this.documentoActual();
    if (!doc || this.formNuevoProceso.invalid) return;
    this.data
      .alta<DocumentoReferenciaProceso>('DocumentoReferenciaProceso', {
        documentoId: doc.id,
        texto: this.formNuevoProceso.controls.texto.value,
      })
      .subscribe(() => {
        this.formNuevoProceso.reset({ texto: '' });
        this.cargarReferencias();
      });
  }

  quitarProcesoReferenciado(fila: DocumentoReferenciaProceso): void {
    this.data.baja('DocumentoReferenciaProceso', fila.id).subscribe(() => this.cargarReferencias());
  }

  agregarModuloReferenciado(): void {
    const doc = this.documentoActual();
    const ruta = this.moduloAAgregar();
    if (!doc || !ruta) return;
    const destino = DESTINOS.find((d) => d.ruta === ruta);
    if (!destino) return;
    this.data
      .alta<DocumentoReferenciaModulo>('DocumentoReferenciaModulo', {
        documentoId: doc.id,
        ruta: destino.ruta,
        etiqueta: destino.label,
        grupo: destino.grupo,
      })
      .subscribe(() => {
        this.moduloAAgregar.set(null);
        this.cargarReferencias();
      });
  }

  quitarModuloReferenciado(fila: DocumentoReferenciaModulo): void {
    this.data.baja('DocumentoReferenciaModulo', fila.id).subscribe(() => this.cargarReferencias());
  }

  agregarDocumentoRelacionado(): void {
    const doc = this.documentoActual();
    const relacionadoId = this.documentoRelacionadoAAgregar();
    if (!doc || !relacionadoId) return;
    this.data
      .alta<DocumentoRelacion>('DocumentoRelacion', {
        documentoId: doc.id,
        documentoRelacionadoId: relacionadoId,
        tipo: this.tipoRelacionAAgregar(),
      })
      .subscribe(() => {
        this.documentoRelacionadoAAgregar.set(null);
        this.tipoRelacionAAgregar.set('relacionado');
        this.cargarReferencias();
      });
  }

  quitarDocumentoRelacionado(fila: DocumentoRelacion): void {
    this.data.baja('DocumentoRelacion', fila.id).subscribe(() => this.cargarReferencias());
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

    // Deep link (p.ej. desde el Asistente Saurix): ?documento=123 abre
    // directo ese documento, mismo patrón que ?ticket= en el tablero de
    // Proyectos. Esto NO es "consultar el listado al abrir" — es ir
    // directo a un documento puntual que no pasa por la cuadrícula.
    this.route.queryParamMap.subscribe((params) => {
      const documentoIdParam = Number(params.get('documento')) || 0;
      if (!documentoIdParam) return;
      this.data.getById<Documento>('Documento', documentoIdParam).subscribe({
        next: (documento) => this.verDocumento(documento),
        error: () => {},
      });
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
      p_orden_columna: this.columnaOrden(),
      p_orden_direccion: this.direccionOrden(),
      p_desde: desde,
      p_cantidad: tamanio,
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
    this.mostrarInactivosAplicado = this.mostrarInactivosEnEdicion();
    this.reiniciarYCargar();
  }

  protected limpiarFiltros(): void {
    this.busquedaEnEdicion.set('');
    this.soloFavoritosEnEdicion.set(false);
    this.soloHuerfanosEnEdicion.set(false);
    this.mostrarInactivosEnEdicion.set(false);
  }

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
    this.valoresOriginales = JSON.stringify(this.form.getRawValue());
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
    if (tab === 'referencias') this.cargarReferencias();
    this.vista.set(tab);
  }

  private cargarVersiones(): void {
    const doc = this.documentoActual();
    if (!doc) return;
    this.data
      .list<DocumentoVersion>('DocumentoVersion', { documentoId: doc.id })
      .subscribe((versiones) => {
        // Más reciente primero.
        this.versiones.set(
          [...versiones].sort((a, b) => (b.fechaCreacion ?? '').localeCompare(a.fechaCreacion ?? '')),
        );
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

    const terminar = () => {
      this.valoresOriginales = JSON.stringify(this.form.getRawValue());
    };

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

  volverALista(): void {
    this.documentoActual.set(null);
    this.vista.set('lista');
    if (this.haBuscado()) void this.cargar();
  }

  private hayCambiosSinGuardar(): boolean {
    return JSON.stringify(this.form.getRawValue()) !== this.valoresOriginales;
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

    const { tipoSistemaId: _tipoSistemaId, categoriaId: _categoriaId, ...valor } = valorBruto;
    const documentoPrevio = this.documentoActual();
    const activo = documentoPrevio?.activo ?? true;
    const dto = { ...valor, activo };
    const esEdicion = documentoPrevio !== null;

    const guardarDocumento = (): void => {
      const peticion = esEdicion
        ? this.data.modificacion<Documento>('Documento', dto)
        : this.data.alta<Documento>('Documento', dto);

      peticion.subscribe({
        next: (documento) => {
          this.toast.exito(esEdicion ? 'Documento actualizado.' : 'Documento creado.');
          this.valoresOriginales = JSON.stringify(this.form.getRawValue());
          this.documentoActual.set(documento);
          this.resolverFavoritoActual(documento.id);
          this.vista.set('ver');
          if (this.haBuscado()) void this.cargar();
        },
        error: () => this.toast.error('No se pudo guardar el documento. Intenta de nuevo.'),
      });
    };

    // Antes de sobrescribir un documento existente, se guarda un snapshot
    // del contenido TAL COMO ESTABA (no el nuevo) — así el historial de
    // versiones siempre tiene "cómo se veía antes de este cambio".
    if (esEdicion && documentoPrevio) {
      this.data
        .alta<DocumentoVersion>('DocumentoVersion', {
          documentoId: documentoPrevio.id,
          titulo: documentoPrevio.titulo,
          contenido: documentoPrevio.contenido,
          usuario: this.auth.usuarioActual()?.nombreUsuario ?? 'desconocido',
        })
        .subscribe({ next: guardarDocumento, error: guardarDocumento });
    } else {
      guardarDocumento();
    }
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

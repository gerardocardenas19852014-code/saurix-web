import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';
import { jsPDF } from 'jspdf';
import { DataClientService } from '../../core/services/data-client.service';
import { AuthService } from '../../core/services/auth.service';
import { AdjuntosPanelComponent } from '../../shared/components/adjuntos-panel/adjuntos-panel.component';
import { EditorTextoComponent } from '../../shared/components/editor-texto/editor-texto.component';
import { ColumnaTabla, DataTableComponent } from '../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../shared/services/toast.service';
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
  private readonly auth = inject(AuthService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly sanitizer = inject(DomSanitizer);

  protected seccionFijaId: number | null = null;
  protected seccionFijaNombre = '';

  private readonly documentosTodos = signal<Documento[]>([]);
  protected readonly cargando = signal(false);
  protected readonly busqueda = signal('');

  /** Búsqueda por título Y por el texto del contenido, todo en cliente (mismo
   *  criterio ya usado en Usuarios) — así encuentra un documento aunque la
   *  palabra buscada no esté en el título, solo en la redacción. */
  protected readonly soloFavoritos = signal(false);
  /** Ids de documentos favoritos del usuario actual — un Set para O(1) al
   *  pintar la estrella de cada renglón y al filtrar "Solo favoritos". */
  private readonly favoritos = signal<Map<number, DocumentoFavorito>>(new Map());

  /** "Solo huérfanos" — documentos sin NINGUNA referencia de trazabilidad
   *  (ni saliente: tabla/proceso/módulo/relación: ni entrante: otro
   *  documento que lo relacione a él). Ver documentosConTrazabilidad(). */
  protected readonly soloHuerfanos = signal(false);

  protected readonly documentos = computed(() => {
    const texto = this.busqueda().trim().toLowerCase();
    const soloFav = this.soloFavoritos();
    const soloHuerf = this.soloHuerfanos();
    const favoritos = this.favoritos();
    const conectados = this.documentosConTrazabilidad();
    let lista = this.documentosTodos();
    if (soloFav) lista = lista.filter((doc) => favoritos.has(doc.id));
    if (soloHuerf) lista = lista.filter((doc) => !conectados.has(doc.id));
    if (!texto) return lista;
    return lista.filter(
      (doc) => doc.titulo.toLowerCase().includes(texto) || this.textoPlano(doc.contenido).toLowerCase().includes(texto),
    );
  });

  protected readonly migajas = signal<Migaja[]>([]);

  protected readonly tiposSistema = signal<TipoSistemaOpcion[]>([]);
  protected readonly categorias = signal<CategoriaOpcion[]>([]);
  protected readonly secciones = signal<SeccionOpcion[]>([]);

  /** Plantillas activas, para el selector "Usar plantilla" al crear un
   *  documento nuevo (no aplica al editar uno ya existente). */
  protected readonly plantillas = signal<PlantillaDocumento[]>([]);

  /** Todas las secciones (sin filtrar), solo para mostrar el nombre de la
   *  sección de cada documento en la columna del listado en vez de su Id. */
  private readonly todasLasSecciones = signal<SeccionOpcion[]>([]);
  private readonly mapaSecciones = computed(() => new Map(this.todasLasSecciones().map((s) => [s.id, s])));

  /** Copias SIN filtrar de las 4 tablas de trazabilidad (a diferencia de
   *  tablasReferenciadas/etc., que sí filtran por el documento abierto en
   *  cargarReferencias()) — solo para calcular qué documentos tienen
   *  alguna referencia, en el listado completo. Mismo criterio que
   *  todasLasSecciones para pintar una columna sin tener que ir
   *  documento por documento. */
  private readonly todasLasReferenciasTabla = signal<DocumentoReferenciaTabla[]>([]);
  private readonly todasLasReferenciasProceso = signal<DocumentoReferenciaProceso[]>([]);
  private readonly todasLasReferenciasModulo = signal<DocumentoReferenciaModulo[]>([]);
  private readonly todasLasRelaciones = signal<DocumentoRelacion[]>([]);

  /** Ids de documentos con alguna referencia de trazabilidad — saliente
   *  (tabla/proceso/módulo/relación) o entrante (otro documento lo
   *  relaciona a él, "backlink") — usado por la columna "Trazabilidad" y
   *  el filtro "Solo huérfanos" del listado. */
  private readonly documentosConTrazabilidad = computed(() => {
    const ids = new Set<number>();
    for (const fila of this.todasLasReferenciasTabla()) ids.add(fila.documentoId);
    for (const fila of this.todasLasReferenciasProceso()) ids.add(fila.documentoId);
    for (const fila of this.todasLasReferenciasModulo()) ids.add(fila.documentoId);
    for (const relacion of this.todasLasRelaciones()) {
      ids.add(relacion.documentoId);
      ids.add(relacion.documentoRelacionadoId);
    }
    return ids;
  });

  protected esHuerfano(documento: Documento): boolean {
    return !this.documentosConTrazabilidad().has(documento.id);
  }

  /** null = listado; 'ver'/'editar'/'adjuntos' = documento abierto en esa pestaña. */
  protected readonly vista = signal<'lista' | 'ver' | 'editar' | 'adjuntos' | 'historial' | 'referencias'>('lista');

  /** La vista "lista" (tabla) aprovecha el ancho ampliado de `.content`
   *  (ver comentario que tenía antes `ngOnInit`); las demás (Ver/Editar/
   *  Adjuntos/Historial) tienen contenido angosto (`.edit-form` se limita
   *  a 760px, `.page-body` es texto para leer) y con el ancho ampliado
   *  fijo dejaban una franja vacía grande a la derecha — mismo problema ya
   *  corregido en RFC y CURP. Este effect mantiene `data-wide` sincronizado
   *  con la vista actual en vez de dejarlo fijo todo el tiempo que el
   *  componente está montado, y lo quita al salir de la pantalla
   *  (onCleanup corre tanto entre cambios de vista como al destruirse el
   *  componente). */
  private readonly _anchoSegunVista = effect((onCleanup) => {
    if (this.vista() === 'lista') document.documentElement.setAttribute('data-wide', 'grid');
    onCleanup(() => document.documentElement.removeAttribute('data-wide'));
  });
  protected readonly documentoActual = signal<Documento | null>(null);
  protected readonly documentoAEliminar = signal<Documento | null>(null);

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

  protected readonly columnas: ColumnaTabla<Documento>[] = [
    { campo: 'titulo', etiqueta: 'Título' },
    {
      campo: 'seccionId',
      etiqueta: 'Sección',
      formatear: (fila) => this.mapaSecciones().get(fila.seccionId)?.nombre ?? '—',
    },
    {
      campo: 'id',
      etiqueta: 'Trazabilidad',
      formatear: (fila) => (this.esHuerfano(fila) ? 'Huérfano' : 'Conectado'),
      claseValor: (fila) => (this.esHuerfano(fila) ? 'grid-badge-warning' : 'grid-badge-success'),
      titulo: (fila) =>
        this.esHuerfano(fila)
          ? 'Sin ninguna tabla, proceso, módulo u otro documento referenciado (ni que lo referencien a él)'
          : 'Tiene al menos una referencia de trazabilidad capturada',
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

  /** Documentos que el editor puede ofrecer para "Enlazar documento" — los
   *  ya cargados en esta ventana (mismo alcance que la búsqueda/listado),
   *  sin el documento que se está editando (enlazarse a sí mismo no tiene
   *  caso). Solo id/título, para no acoplar el editor compartido al
   *  modelo `Documento`. */
  protected readonly documentosParaEnlazar = computed(() => {
    const actualId = this.documentoActual()?.id ?? 0;
    return this.documentosTodos()
      .filter((doc) => doc.id !== actualId)
      .map((doc) => ({ id: doc.id, titulo: doc.titulo }));
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

  /** Título del documento relacionado, para pintar el chip (los datos de
   *  DocumentoRelacion solo guardan el id). */
  protected tituloDocumento(documentoId: number): string {
    return this.documentosTodos().find((d) => d.id === documentoId)?.titulo ?? `Documento #${documentoId}`;
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
      .subscribe({ next: (filas) => this.documentosRelacionados.set(filas), error: () => this.documentosRelacionados.set([]) });
    this.data
      .list<DocumentoRelacion>('DocumentoRelacion', { documentoRelacionadoId: doc.id })
      .subscribe({
        next: (filas) => this.documentosQueMeReferencian.set(filas),
        error: () => this.documentosQueMeReferencian.set([]),
      });

    // La columna "Trazabilidad"/"Solo huérfanos" del listado completo se
    // alimenta de copias sin filtrar (ver documentosConTrazabilidad) — hay
    // que refrescarlas aquí también, si no quedan obsoletas en cuanto se
    // agrega/quita una referencia y se vuelve a la lista sin recargar la
    // página.
    this.cargarTrazabilidadGlobal();
  }

  /** Copias SIN filtrar de las 4 tablas de trazabilidad, para
   *  documentosConTrazabilidad() (columna "Trazabilidad" y filtro "Solo
   *  huérfanos" del listado completo) — se llama una vez en ngOnInit y de
   *  nuevo cada vez que cargarReferencias() corre, para no quedar
   *  obsoleta tras un alta/baja. Error silencioso (sin volver a tostar:
   *  SupabaseDataClientService ya muestra su propio toast) — hasta que
   *  estas 4 tablas existan también en Supabase (ver
   *  esquema-tablas-saurix.md del proyecto), en modo Nube esto se degrada
   *  a "sin datos de trazabilidad" en vez de romper el listado completo. */
  private cargarTrazabilidadGlobal(): void {
    this.data.list<DocumentoReferenciaTabla>('DocumentoReferenciaTabla').subscribe({
      next: (filas) => this.todasLasReferenciasTabla.set(filas),
      error: () => this.todasLasReferenciasTabla.set([]),
    });
    this.data.list<DocumentoReferenciaProceso>('DocumentoReferenciaProceso').subscribe({
      next: (filas) => this.todasLasReferenciasProceso.set(filas),
      error: () => this.todasLasReferenciasProceso.set([]),
    });
    this.data.list<DocumentoReferenciaModulo>('DocumentoReferenciaModulo').subscribe({
      next: (filas) => this.todasLasReferenciasModulo.set(filas),
      error: () => this.todasLasReferenciasModulo.set([]),
    });
    this.data.list<DocumentoRelacion>('DocumentoRelacion').subscribe({
      next: (filas) => this.todasLasRelaciones.set(filas),
      error: () => this.todasLasRelaciones.set([]),
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

  ngOnInit(): void {
    const param = this.route.snapshot.paramMap.get('seccionId');
    this.seccionFijaId = param ? Number(param) : null;

    if (!this.seccionFijaId) {
      this.data.list<TipoSistemaOpcion>('TipoSistema').subscribe({
        next: (tipos) => this.tiposSistema.set(tipos),
        error: () => this.toast.error('No se pudieron cargar los tipos de sistema.'),
      });
    } else {
      this.cargarMigajas(this.seccionFijaId);
    }

    this.data.list<SeccionOpcion>('Seccion').subscribe((secciones) => this.todasLasSecciones.set(secciones));

    this.cargarTrazabilidadGlobal();

    this.data
      .list<PlantillaDocumento>('PlantillaDocumento', { activo: true })
      .subscribe((plantillas) => this.plantillas.set(plantillas));

    this.cargarFavoritos();
    this.cargar();

    // Deep link (p.ej. desde el Asistente Saurix): ?documento=123 abre
    // directo ese documento, mismo patrón que ?ticket= en el tablero de
    // Proyectos.
    this.route.queryParamMap.subscribe((params) => {
      const documentoIdParam = Number(params.get('documento')) || 0;
      if (!documentoIdParam) return;
      this.data.getById<Documento>('Documento', documentoIdParam).subscribe({
        next: (documento) => this.verDocumento(documento),
        error: () => {},
      });
    });
  }


  private cargarFavoritos(): void {
    const usuario = this.auth.usuarioActual()?.nombreUsuario;
    if (!usuario) return;
    this.data.list<DocumentoFavorito>('DocumentoFavorito', { usuario }).subscribe((favoritos) => {
      this.favoritos.set(new Map(favoritos.map((f) => [f.documentoId, f])));
    });
  }

  protected esFavorito(documento: Documento): boolean {
    return this.favoritos().has(documento.id);
  }

  protected iconoFavorito = (documento: Documento): string => (this.esFavorito(documento) ? '⭐' : '☆');

  toggleFavorito(documento: Documento): void {
    const usuario = this.auth.usuarioActual()?.nombreUsuario;
    if (!usuario) return;
    const existente = this.favoritos().get(documento.id);

    if (existente) {
      this.data.baja('DocumentoFavorito', existente.id).subscribe({
        next: () => {
          this.favoritos.update((mapa) => {
            const nuevo = new Map(mapa);
            nuevo.delete(documento.id);
            return nuevo;
          });
        },
        error: () => this.toast.error('No se pudo quitar de favoritos.'),
      });
      return;
    }

    this.data
      .alta<DocumentoFavorito>('DocumentoFavorito', { documentoId: documento.id, usuario })
      .subscribe({
        next: (favorito) => {
          this.favoritos.update((mapa) => {
            const nuevo = new Map(mapa);
            nuevo.set(documento.id, favorito);
            return nuevo;
          });
        },
        error: () => this.toast.error('No se pudo marcar como favorito.'),
      });
  }

  private cargarMigajas(seccionId: number): void {
    this.data.getById<SeccionOpcion>('Seccion', seccionId).subscribe((seccion) => {
      this.seccionFijaNombre = seccion.nombre;
      this.migajas.set([
        { etiqueta: 'Secciones', ruta: '/wikidocs/secciones' },
        { etiqueta: seccion.nombre },
      ]);
    });
  }

  cargar(): void {
    this.cargando.set(true);
    const filtro: Record<string, unknown> = {};
    if (this.seccionFijaId) filtro['seccionId'] = this.seccionFijaId;

    this.data.list<Documento>('Documento', filtro).subscribe({
      next: (documentos) => {
        this.documentosTodos.set(documentos);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
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
    this.vista.set('ver');
  }

  editarDocumento(documento: Documento): void {
    this.documentoActual.set(documento);
    this.cargarFormDesde(documento);
    this.vista.set('editar');
  }

  cambiarTab(tab: 'ver' | 'editar' | 'adjuntos' | 'historial' | 'referencias'): void {
    if (tab === 'editar') {
      const doc = this.documentoActual();
      if (doc) this.cargarFormDesde(doc);
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
    if (this.seccionFijaId) return;

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
      });
    });
  }

  volverALista(): void {
    this.documentoActual.set(null);
    this.vista.set('lista');
    this.cargar();
  }

  cancelarEdicion(): void {
    this.toast.info('Cambios descartados.');
    this.volverALista();
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
          this.documentoActual.set(documento);
          this.vista.set('ver');
          this.cargar();
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
   *  fuera de pantalla y jsPDF.html() (basado en html2canvas) lo rasteriza
   *  a páginas tamaño carta, igual que ya hace Comercio con sus PDFs, solo
   *  que ahí construyen el PDF a mano por ser datos tabulares; aquí el
   *  contenido es HTML libre (imágenes, tablas, código, etc.), así que
   *  conviene rasterizarlo en vez de reconstruirlo campo por campo. */
  exportarPdf(documento: Documento): void {
    const contenedor = document.createElement('div');
    contenedor.style.cssText =
      'position:fixed; left:-9999px; top:0; width:700px; padding:24px; ' +
      'font-family: Helvetica, Arial, sans-serif; color:#111; background:#fff;';
    contenedor.innerHTML =
      `<h1 style="font-size:22px;margin:0 0 4px;">${documento.titulo}</h1>` +
      `<p style="font-size:11px;color:#666;margin:0 0 16px;">Última modificación: ${this.formatearFecha(documento)}</p>` +
      this.renderParaDescarga(documento);
    document.body.appendChild(contenedor);

    this.toast.info('Generando PDF…');
    const pdf = new jsPDF({ unit: 'pt', format: 'letter' });
    pdf.html(contenedor, {
      x: 24,
      y: 24,
      width: 550,
      windowWidth: 700,
      autoPaging: 'text',
      callback: (pdfFinal) => {
        pdfFinal.save(`${documento.titulo || 'documento'}.pdf`);
        document.body.removeChild(contenedor);
      },
    });
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

  /** Descarga TODOS los documentos de la sección actual (solo disponible en
   *  la vista ya filtrada por sección) en un único archivo HTML — igual que
   *  "downloadSection" en el prototipo de referencia. */
  descargarSeccion(): void {
    const documentos = this.documentos();
    if (!documentos.length) {
      this.toast.advertencia('No hay documentos para descargar en esta sección.');
      return;
    }

    const titulo = this.seccionFijaNombre || 'Sección';
    const partes = [`<h1>${titulo}</h1>`];
    documentos.forEach((doc, indice) => {
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

  pedirEliminar(documento: Documento): void {
    this.documentoAEliminar.set(documento);
  }

  confirmarEliminar(): void {
    const documento = this.documentoAEliminar();
    if (!documento) return;

    this.data.baja('Documento', documento.id).subscribe({
      next: () => {
        this.toast.exito('Documento eliminado.');
        this.documentoAEliminar.set(null);
        if (this.documentoActual()?.id === documento.id) this.volverALista();
        else this.cargar();
      },
      error: () => this.toast.error('No se pudo eliminar el documento. Intenta de nuevo.'),
    });
  }
}

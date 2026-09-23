import { DatePipe } from '@angular/common';
import { forkJoin, of, switchMap } from 'rxjs';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { Usuario, nombreCompletoUsuario } from '../../seguridad/usuarios/usuario.model';
import { DataClientService } from '../../../core/services/data-client.service';
import { AdjuntosPanelComponent } from '../../../shared/components/adjuntos-panel/adjuntos-panel.component';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ConfiguracionAparienciaService } from '../../../shared/services/configuracion-apariencia.service';
import { NotificacionesService } from '../../../shared/services/notificaciones.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { ToastService } from '../../../shared/services/toast.service';
import { exportarCsv } from '../../../shared/utils/csv.util';
import {
  ProyectoOpcion,
  TableroColumna,
  TICKET_CAMPOS_CONFIGURABLES,
  parsearConfiguracionCampos,
  puedeMoverA,
  reglaCampo,
} from '../tableros/tablero-columna.model';
import { TicketTipo } from '../ticket-tipos/ticket-tipo.model';
import { TicketPrioridad } from '../ticket-prioridades/ticket-prioridad.model';
import { TicketModulo } from '../ticket-modulos/ticket-modulo.model';
import { Sprint, nombreSprintCorto } from '../sprints/sprint.model';
import {
  Ticket,
  TicketActividad,
  TicketComentario,
  TicketDependencia,
  TicketEtiqueta,
  TicketHistorialEstado,
  TicketSeguidor,
  TipoVinculoTicket,
  UsuarioOpcion,
} from './ticket.model';
import { colorAvatar, iniciales } from './avatar.util';

type TabDetalle =
  | 'detalles'
  | 'fechas'
  | 'actividades'
  | 'comentarios'
  | 'etiquetas'
  | 'adjuntos'
  | 'historial'
  | 'asociados'
  | 'subtareas'
  | 'seguidores'
  | 'solucion';
type ClaseSla = 'sla-ok' | 'sla-warning' | 'sla-expired';

/**
 * Tablero Kanban por proyecto. El estado se cambia desde dos lugares: la barra
 * de estado del detalle del ticket ("Aceptar"/"◀ Regresar" — ver `mover()`,
 * movimiento lineal ±1 en el orden de columnas) o arrastrando la tarjeta a otra
 * columna del tablero (ver `onDrop()`/`soltarTicket()`, movimiento libre a
 * cualquier columna permitida). Ambos exigen haber registrado antes una
 * actividad en la columna actual, y ambos terminan llamando a
 * `moverTicketAColumna`, el único punto que persiste el cambio de columna. Qué
 * columnas destino están permitidas desde una columna de origen lo decide
 * `puedeMoverA()` (configurable por columna en Gestor de Estados → "🔀 Flujo";
 * sin configurar, se puede mover a cualquiera).
 */
@Component({
  selector: 'app-kanban',
  standalone: true,
  imports: [ReactiveFormsModule, ConfirmDialogComponent, AdjuntosPanelComponent, DataTableComponent, RouterLink],
  templateUrl: './kanban.component.html',
  styleUrl: './kanban.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KanbanComponent implements OnInit, OnDestroy {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly configuracionApariencia = inject(ConfiguracionAparienciaService);
  private readonly notificaciones = inject(NotificacionesService);
  private readonly route = inject(ActivatedRoute);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);

  protected readonly iniciales = iniciales;
  protected readonly colorAvatar = colorAvatar;

  protected readonly proyectos = signal<ProyectoOpcion[]>([]);
  protected readonly proyectoSeleccionadoId = signal<number>(0);
  protected readonly columnasTablero = signal<TableroColumna[]>([]);
  protected readonly tickets = signal<Ticket[]>([]);
  protected readonly etiquetasPorTicket = signal<Map<number, TicketEtiqueta[]>>(new Map());
  /** Igual que etiquetasPorTicket, pero para Asociados (TicketDependencia) — para
   *  poder mostrar un contador en la tarjeta del tablero sin tener que abrir el
   *  detalle de cada ticket. Cuenta el vínculo del lado de AMBOS tickets
   *  (ticketId y ticketRelacionadoId), igual que la pestaña "Asociados" ahora
   *  muestra también los vínculos entrantes (ver vinculosDelTicket) — antes solo
   *  contaba del lado que lo creó. */
  protected readonly dependenciasPorTicket = signal<Map<number, TicketDependencia[]>>(new Map());
  protected readonly cargando = signal(false);
  protected readonly ahora = signal(Date.now());
  private intervaloReloj?: ReturnType<typeof setInterval>;

  protected readonly tipos = signal<TicketTipo[]>([]);
  protected readonly prioridades = signal<TicketPrioridad[]>([]);
  protected readonly modulos = signal<TicketModulo[]>([]);
  protected readonly sprints = signal<Sprint[]>([]);
  protected readonly usuarios = signal<UsuarioOpcion[]>([]);

  /** 'tablero' (Kanban) o 'lista' (tabla) — recuerda la preferencia del usuario (Panel de Control › Apariencia). */
  protected readonly modoVista = signal<'tablero' | 'lista'>(this.configuracionApariencia.vistaProyectosPreferida());
  protected readonly filtroTipoId = signal<number>(0);
  protected readonly filtroModuloId = signal<number>(0);
  protected readonly filtroPrioridadId = signal<number>(0);
  protected readonly filtroEstadoId = signal<number>(0);
  protected readonly filtroAsignadoId = signal<number>(0);
  /** 0 = Todos (sin filtro), 1 = solo planeados, 2 = solo no planeados — mismo
   *  patrón de centinelas por número que el resto de los filtros de esta pantalla. */
  protected readonly filtroPlaneado = signal<number>(0);
  protected readonly filtroTexto = signal('');
  /** false por defecto: los tickets archivados (activo === false) se ocultan del
   *  tablero/lista salvo que se marque esta casilla — alternativa al borrado duro. */
  protected readonly mostrarInactivos = signal(false);
  protected readonly hayFiltros = computed(
    () =>
      !!(
        this.filtroTipoId() ||
        this.filtroModuloId() ||
        this.filtroPrioridadId() ||
        this.filtroEstadoId() ||
        this.filtroAsignadoId() ||
        this.filtroPlaneado() ||
        this.filtroTexto().trim()
      ),
  );

  protected readonly modalAbierto = signal(false);
  protected readonly ticketEnEdicion = signal<Ticket | null>(null);
  protected readonly columnaCreacionId = signal<number>(0);

  protected readonly ticketActivo = signal<Ticket | null>(null);
  protected readonly ticketAEliminar = signal<Ticket | null>(null);
  protected readonly tabActiva = signal<TabDetalle>('detalles');

  /** Ticket que se está arrastrando en el tablero (drag & drop nativo HTML5, sin librería). */
  protected readonly ticketArrastrando = signal<Ticket | null>(null);

  /** Pestañas del detalle agrupadas bajo el botón "Más ▾" — las 5 que menos se
   *  consultan día a día, para no saturar la fila principal con las 10 juntas
   *  (antes se desbordaba con scroll horizontal). */
  private static readonly TABS_EN_MENU_MAS: readonly TabDetalle[] = [
    'etiquetas',
    'adjuntos',
    'asociados',
    'subtareas',
    'seguidores',
    'historial',
  ];
  protected readonly menuTabsMasAbierto = signal(false);
  protected readonly tabActivaEnMenuMas = computed(() =>
    KanbanComponent.TABS_EN_MENU_MAS.includes(this.tabActiva()),
  );

  toggleMenuTabsMas(): void {
    this.menuTabsMasAbierto.update((v) => !v);
  }

  seleccionarTab(tab: TabDetalle): void {
    this.tabActiva.set(tab);
    this.menuTabsMasAbierto.set(false);
  }
  protected readonly comentarios = signal<TicketComentario[]>([]);
  protected readonly actividades = signal<TicketActividad[]>([]);
  protected readonly etiquetas = signal<TicketEtiqueta[]>([]);
  protected readonly historial = signal<TicketHistorialEstado[]>([]);
  protected readonly dependencias = signal<TicketDependencia[]>([]);
  /** Vínculos donde ESTE ticket es el relacionado (el otro ticket lo creó) — ver
   *  vinculosDelTicket, que junta esto con `dependencias` para mostrar ambos
   *  lados del vínculo con la etiqueta correcta según de qué lado se ve. */
  protected readonly dependenciasEntrantes = signal<TicketDependencia[]>([]);
  protected readonly seguidores = signal<TicketSeguidor[]>([]);

  /** Búsqueda de texto libre para "Convertir en subtarea" — mismo patrón que
   *  filtroAsociado (folio, folio interno o título, varios términos con coma). */
  protected readonly filtroSubtarea = signal('');
  protected readonly formSubtarea = this.fb.nonNullable.group({ titulo: ['', Validators.required] });
  protected readonly formSubtareaExistente = this.fb.nonNullable.group({ ticketId: [0] });

  /** Subtareas por ticket padre — a diferencia de dependenciasPorTicket/etiquetasPorTicket
   *  (entidades aparte), una subtarea ES un Ticket (con ticketPadreId apuntando al padre),
   *  así que se deriva directo de `tickets()` (ya cargado para el tablero) sin ninguna
   *  consulta extra. */
  protected readonly subtareasPorTicket = computed(() => {
    const mapa = new Map<number, Ticket[]>();
    for (const t of this.tickets()) {
      if (!t.ticketPadreId) continue;
      const padreId = Number(t.ticketPadreId);
      if (!mapa.has(padreId)) mapa.set(padreId, []);
      mapa.get(padreId)!.push(t);
    }
    return mapa;
  });

  /** Subtareas (hijos) del ticket actualmente abierto en el detalle. */
  protected readonly subtareasDelActivo = computed(() => {
    const activo = this.ticketActivo();
    if (!activo) return [];
    return this.subtareasPorTicket().get(Number(activo.id)) ?? [];
  });

  /** "3 de 5 completadas" del ticket abierto — null si todavía no tiene ninguna
   *  subtarea (no hay contra qué mostrar barra de progreso). "Completada" = misma
   *  regla que el resto del sistema para "resuelto": está en la última columna
   *  configurada del tablero (ver estaResuelto). */
  protected readonly progresoSubtareasActivo = computed(() => {
    const hijos = this.subtareasDelActivo();
    if (!hijos.length) return null;
    const completadas = hijos.filter((h) => this.estaResuelto(h)).length;
    return { completadas, total: hijos.length, pct: Math.round((completadas / hijos.length) * 100) };
  });

  /** Jira no permite subtareas de subtareas: un ticket que ya es subtarea de otro
   *  no puede a su vez tener sus propias subtareas — controla si se ofrece la
   *  sección para agregar subtareas o solo el aviso "Este ticket ya es subtarea". */
  protected readonly puedeTenerSubtareas = computed(() => !this.ticketActivo()?.ticketPadreId);

  /** Candidatos para "convertir ticket existente en subtarea": del mismo proyecto,
   *  que no sean ya subtarea de otro ni tengan ellos mismos subtareas (mismo límite
   *  de un solo nivel que puedeTenerSubtareas) y no sea el propio ticket activo. */
  protected readonly ticketsDisponiblesParaSubtarea = computed(() => {
    const activo = this.ticketActivo();
    if (!activo) return [];
    const conHijos = this.subtareasPorTicket();
    return this.tickets().filter(
      (t) => Number(t.id) !== Number(activo.id) && !t.ticketPadreId && !conHijos.has(Number(t.id)),
    );
  });

  protected readonly ticketsDisponiblesParaSubtareaFiltrados = computed(() => {
    const terminos = this.filtroSubtarea()
      .toLowerCase()
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (!terminos.length) return this.ticketsDisponiblesParaSubtarea();
    return this.ticketsDisponiblesParaSubtarea().filter((t) =>
      terminos.some(
        (termino) =>
          t.numeroTicket.toLowerCase().includes(termino) ||
          (t.folioInterno ?? '').toLowerCase().includes(termino) ||
          t.titulo.toLowerCase().includes(termino),
      ),
    );
  });

  /** Catálogo fijo de tipos de vínculo entre tickets (pestaña Asociados) — mismo
   *  concepto que los "issue links" de Jira (bloquea/duplica/relacionado). */
  protected static readonly TIPOS_VINCULO: { clave: TipoVinculoTicket; etiqueta: string }[] = [
    { clave: 'relacionado', etiqueta: 'Relacionado con' },
    { clave: 'bloquea', etiqueta: 'Bloquea a' },
    { clave: 'bloqueado_por', etiqueta: 'Bloqueado por' },
    { clave: 'duplica', etiqueta: 'Duplica a' },
    { clave: 'duplicado_por', etiqueta: 'Duplicado por' },
  ];
  protected readonly tiposVinculo = KanbanComponent.TIPOS_VINCULO;
  private static readonly ETIQUETA_VINCULO = new Map(
    KanbanComponent.TIPOS_VINCULO.map((t) => [t.clave, t.etiqueta]),
  );
  /** El inverso de cada tipo, para mostrar la etiqueta correcta del lado del
   *  ticket relacionado (ver dependenciasEntrantes/vinculosDelTicket). "relacionado"
   *  es simétrico: su inverso es él mismo. */
  private static readonly INVERSO_VINCULO: Record<TipoVinculoTicket, TipoVinculoTicket> = {
    relacionado: 'relacionado',
    bloquea: 'bloqueado_por',
    bloqueado_por: 'bloquea',
    duplica: 'duplicado_por',
    duplicado_por: 'duplica',
  };

  /** Pestañas cuya visibilidad depende de la columna actual del ticket (permiteActividades/permiteAnexos/permiteAsociados). */
  protected readonly tabsPermitidas = computed(() => {
    const activo = this.ticketActivo();
    const columna = activo ? this.columnaActualDe(activo) : undefined;
    return {
      actividades: columna?.permiteActividades ?? true,
      adjuntos: columna?.permiteAnexos ?? true,
      asociados: columna?.permiteAsociados ?? true,
    };
  });

  /** true si a este ticket todavía le falta la actividad obligatoria antes de poder
   *  cambiar de estado —ya sea avanzar o retroceder— (misma condición que revisa
   *  `mover()`) — controla el aviso que se muestra en la pestaña Actividades para
   *  explicar por qué es obligatorio. */
  protected readonly requiereActividadParaAvanzar = computed(() => {
    const activo = this.ticketActivo();
    if (!activo || !this.tabsPermitidas().actividades) return false;
    const hayCambioPosible = this.siguienteColumna(activo) !== null || this.columnaAnterior(activo) !== null;
    if (!hayCambioPosible) return false;
    return !this.tieneActividadDesdeUltimoCambio(activo);
  });

  protected readonly ticketsDisponiblesParaAsociar = computed(() => {
    const activo = this.ticketActivo();
    if (!activo) return [];
    // Se excluyen los tickets ya vinculados en CUALQUIER dirección (este ticket
    // los asoció, o al revés) para no ofrecer crear un vínculo duplicado.
    const yaVinculadosIds = new Set([
      ...this.dependencias().map((d) => Number(d.ticketRelacionadoId)),
      ...this.dependenciasEntrantes().map((d) => Number(d.ticketId)),
    ]);
    return this.tickets().filter((t) => Number(t.id) !== Number(activo.id) && !yaVinculadosIds.has(Number(t.id)));
  });

  /** Une dependencias() (vínculos creados por este ticket) y dependenciasEntrantes()
   *  (vínculos creados por el otro ticket, que apuntan a este) en una sola lista
   *  para la pestaña Asociados — con la etiqueta ya orientada del lado correcto
   *  (ver INVERSO_VINCULO) y el id del OTRO ticket a mostrar. eliminarAsociado()
   *  funciona igual para ambos casos: solo necesita dependencia.id. */
  protected readonly vinculosDelTicket = computed(() => {
    const salientes = this.dependencias().map((d) => ({
      dependencia: d,
      otroTicketId: d.ticketRelacionadoId,
      etiqueta: KanbanComponent.ETIQUETA_VINCULO.get(d.tipo ?? 'relacionado') ?? 'Relacionado con',
    }));
    const entrantes = this.dependenciasEntrantes().map((d) => {
      const tipoInverso = KanbanComponent.INVERSO_VINCULO[d.tipo ?? 'relacionado'];
      return {
        dependencia: d,
        otroTicketId: d.ticketId,
        etiqueta: KanbanComponent.ETIQUETA_VINCULO.get(tipoInverso) ?? 'Relacionado con',
      };
    });
    return [...salientes, ...entrantes];
  });

  /** Mismo criterio de búsqueda multi-término (coma) que ticketsFiltrados — folio,
   *  folio interno o título — aplicado sobre ticketsDisponiblesParaAsociar(). */
  protected readonly ticketsDisponiblesParaAsociarFiltrados = computed(() => {
    const terminos = this.filtroAsociado()
      .toLowerCase()
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (!terminos.length) return this.ticketsDisponiblesParaAsociar();
    return this.ticketsDisponiblesParaAsociar().filter((t) =>
      terminos.some(
        (termino) =>
          t.numeroTicket.toLowerCase().includes(termino) ||
          (t.folioInterno ?? '').toLowerCase().includes(termino) ||
          t.titulo.toLowerCase().includes(termino),
      ),
    );
  });

  protected readonly ticketsFiltrados = computed(() => {
    const tipoId = this.filtroTipoId();
    const moduloId = this.filtroModuloId();
    const prioridadId = this.filtroPrioridadId();
    const estadoId = this.filtroEstadoId();
    const asignadoId = this.filtroAsignadoId();
    const planeadoFiltro = this.filtroPlaneado();
    // Admite varios folios separados por coma (p.ej. "55350,55182"): cada término
    // se busca por separado (OR entre términos, igual que antes OR entre campos).
    const terminos = this.filtroTexto()
      .toLowerCase()
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const conInactivos = this.mostrarInactivos();
    return this.tickets().filter(
      (t) =>
        (conInactivos || t.activo !== false) &&
        (!tipoId || Number(t.ticketTipoId) === tipoId) &&
        // moduloId === 0 es "Todos" (sin filtro); -1 es el centinela de "Sin módulo"
        // (tickets sin ticketModuloId); cualquier otro valor filtra por ese módulo.
        (!moduloId || (moduloId === -1 ? !t.ticketModuloId : Number(t.ticketModuloId) === moduloId)) &&
        (!prioridadId || Number(t.ticketPrioridadId) === prioridadId) &&
        (!estadoId || Number(t.tableroColumnaId) === estadoId) &&
        (!asignadoId || Number(t.asignadoUsuarioId) === asignadoId) &&
        // planeadoFiltro === 1 es "solo planeados" (planeado !== false); === 2 es "solo no planeados".
        (!planeadoFiltro || (planeadoFiltro === 1 ? t.planeado !== false : t.planeado === false)) &&
        (!terminos.length ||
          terminos.some(
            (termino) =>
              t.numeroTicket.toLowerCase().includes(termino) ||
              (t.folioInterno ?? '').toLowerCase().includes(termino) ||
              t.titulo.toLowerCase().includes(termino) ||
              // También busca por etiqueta (p.ej. "urgente-cliente") — mismo mapa
              // etiquetasPorTicket que ya se usa para pintar los tags en la tarjeta.
              this.etiquetasDe(t.id).some((e) => e.texto.toLowerCase().includes(termino)),
          )),
    );
  });

  protected readonly ticketsPorColumna = computed(() => {
    const mapa = new Map<number, Ticket[]>();
    for (const columna of this.columnasTablero()) {
      mapa.set(
        columna.id,
        this.ticketsFiltrados().filter((t) => Number(t.tableroColumnaId) === Number(columna.id)),
      );
    }
    return mapa;
  });

  /** Columnas de la vista de Lista (tabla) — alternativa al tablero Kanban, mismo estándar del resto del sistema. */
  protected readonly columnasLista: ColumnaTabla<Ticket>[] = [
    { campo: 'numeroTicket', etiqueta: 'Folio' },
    { campo: 'folioInterno', etiqueta: 'Folio interno', formatear: (fila) => fila.folioInterno || '—' },
    { campo: 'titulo', etiqueta: 'Título' },
    {
      campo: 'ticketTipoId',
      etiqueta: 'Tipo',
      formatear: (fila) => `${this.iconoTipo(fila.ticketTipoId)} ${this.nombreTipo(fila.ticketTipoId)}`.trim(),
    },
    {
      campo: 'ticketModuloId',
      etiqueta: 'Módulo',
      formatear: (fila) => (fila.ticketModuloId ? `${this.iconoModulo(fila.ticketModuloId)} ${this.nombreModulo(fila.ticketModuloId)}`.trim() : 'Sin módulo'),
    },
    {
      campo: 'sprintId',
      etiqueta: 'Sprint',
      // Nombre corto (p.ej. solo "10.74.0") para que el renglón no se estire con
      // nombres largos de sprint — el nombre completo queda disponible al pasar
      // el mouse (columna.titulo, ver data-table.component.html).
      formatear: (fila) => nombreSprintCorto(this.nombreSprint(fila)),
      titulo: (fila) => this.nombreSprint(fila),
      claseValor: (fila) => (fila.sprintId ? 'grid-badge-success' : 'grid-badge-neutral'),
    },
    { campo: 'ticketPrioridadId', etiqueta: 'Prioridad', formatear: (fila) => this.nombrePrioridad(fila.ticketPrioridadId) },
    {
      campo: 'tableroColumnaId',
      etiqueta: 'Estado',
      formatear: (fila) => this.nombreColumna(fila.tableroColumnaId),
      claseValor: () => 'grid-badge-neutral',
    },
    { campo: 'asignadoUsuarioId', etiqueta: 'Asignado a', formatear: (fila) => this.nombreUsuario(fila.asignadoUsuarioId) },
    {
      campo: 'planeado',
      etiqueta: 'Planeado',
      formatear: (fila) => (fila.planeado !== false ? 'Sí' : 'No'),
      claseValor: (fila) => (fila.planeado !== false ? 'grid-badge-success' : 'grid-badge-muted'),
    },
    {
      campo: 'fechaCreacion',
      etiqueta: 'Vigencia',
      formatear: (fila) => this.textoSla(fila) || '—',
      claseValor: (fila) => this.claseBadgeSla(fila),
    },
  ];

  private readonly datePipe = new DatePipe('es-MX');

  protected formatearFecha(fecha?: string | null): string {
    if (!fecha) return '—';
    return this.datePipe.transform(fecha, 'short') ?? '—';
  }

  /** Columnas de la pestaña "Comentarios" del detalle, como grid en vez de tarjetas sueltas. */
  protected readonly columnasComentarios: ColumnaTabla<TicketComentario>[] = [
    { campo: 'fechaCreacion', etiqueta: 'Fecha', formatear: (fila) => this.formatearFecha(fila.fechaCreacion) },
    { campo: 'texto', etiqueta: 'Comentario' },
    { campo: 'creadoPor', etiqueta: 'Registrado por', formatear: (fila) => this.nombreUsuario(fila.creadoPor) },
  ];

  /** Columnas de la pestaña "Actividades" del detalle, como grid en vez de tarjetas sueltas. */
  protected readonly columnasActividades: ColumnaTabla<TicketActividad>[] = [
    { campo: 'fechaCreacion', etiqueta: 'Fecha', formatear: (fila) => this.formatearFecha(fila.fechaCreacion) },
    { campo: 'tiempoMin', etiqueta: 'Horas', formatear: (fila) => this.formatearHoras(fila.tiempoMin) },
    { campo: 'texto', etiqueta: 'Descripción' },
    { campo: 'creadoPor', etiqueta: 'Registrado por', formatear: (fila) => this.nombreUsuario(fila.creadoPor) },
  ];

  /** Columnas de la pestaña "Historial" del detalle, como grid en vez de tarjetas sueltas. */
  protected readonly columnasHistorial: ColumnaTabla<TicketHistorialEstado>[] = [
    {
      campo: 'tableroColumnaNuevaId',
      etiqueta: 'Cambio',
      formatear: (fila) =>
        `${fila.tableroColumnaAnteriorId ? this.nombreColumna(fila.tableroColumnaAnteriorId) : 'Creación'} → ${this.nombreColumna(fila.tableroColumnaNuevaId)}`,
    },
    { campo: 'usuarioId', etiqueta: 'Usuario', formatear: (fila) => this.nombreUsuario(fila.usuarioId) },
    { campo: 'fechaCreacion', etiqueta: 'Fecha', formatear: (fila) => this.formatearFecha(fila.fechaCreacion) },
  ];

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    ticketTipoId: [0, Validators.required],
    ticketPrioridadId: [0, Validators.required],
    // Opcional (a diferencia de Tipo/Prioridad): no todos los tickets necesariamente
    // pertenecen a un módulo/área concreta, y no se quiso volverlo obligatorio de golpe
    // sobre tickets ya existentes que no lo tenían.
    ticketModuloId: [0],
    asignadoUsuarioId: [0],
    reportadoPorUsuarioId: [0, Validators.required],
    numeroTicket: ['', Validators.required],
    folioInterno: [''],
    titulo: ['', Validators.required],
    descripcion: [''],
    planeado: [true],
    // Se captura/edita en DÍAS en el formulario (más natural que minutos para una
    // estimación); se convierte a minutos al guardar y de vuelta a días al cargar —
    // el campo real (Ticket.tiempoEstimadoMin) sigue siendo minutos, igual que en
    // TicketActividad.tiempoMin y como está documentado en esquema-tablas-saurix.md.
    tiempoEstimadoDias: [0, Validators.min(0)],
    fechaFinAnalisis: [''],
    fechaFinDesarrollo: [''],
    fechaFinCliente: [''],
    // Opcionales, solo para el diagrama de Gantt — si se dejan en blanco, el Gantt
    // sigue calculando con fechaCreacion + tiempoEstimadoDias, como antes.
    fechaInicio: [''],
    fechaFin: [''],
    solucion: [''],
    activo: [true],
  });

  protected readonly formComentario = this.fb.nonNullable.group({ texto: ['', Validators.required] });
  protected readonly formActividad = this.fb.nonNullable.group({
    texto: ['', Validators.required],
    // Se captura en HORAS (más natural que minutos para registrar trabajo) — se
    // convierte a minutos al guardar, mismo campo real (TicketActividad.tiempoMin,
    // documentado en esquema-tablas-saurix.md) que consume Reportes de horas.
    // Mínimo > 0: un 0 (o negativo) se cuela como "actividad válida" para la regla de
    // actividad-obligatoria de mover(), pero infla en cero los totales de Reportes de horas.
    tiempoHoras: [0.25, [Validators.required, Validators.min(0.01)]],
  });
  protected readonly formEtiqueta = this.fb.nonNullable.group({ texto: ['', Validators.required] });
  protected readonly formAsociado = this.fb.nonNullable.group({
    ticketRelacionadoId: [0],
    tipo: ['relacionado' as TipoVinculoTicket],
  });
  /** Texto libre para acotar el combo "Asociar ticket" (pestaña Asociados) — un select nativo con cientos de tickets es imposible de recorrer a ojo, así que se filtra igual que el buscador del tablero: por folio, folio interno o título, admitiendo varios términos separados por coma. */
  protected readonly filtroAsociado = signal('');

  ngOnInit(): void {
    // Deep link desde "Mi Dashboard" (u otra pantalla): ?ticket=123 abre
    // directo el detalle de ese ticket, en el proyecto al que pertenece.
    const ticketIdParam = Number(this.route.snapshot.queryParamMap.get('ticket')) || 0;
    // Deep link desde "Resumen ejecutivo": ?proyecto=123 abre el tablero directo en
    // ese proyecto en vez del primero de la lista (se ignora si viene junto con
    // ?ticket=, que ya trae su propio proyecto resuelto por el ticket).
    const proyectoIdParam = Number(this.route.snapshot.queryParamMap.get('proyecto')) || 0;

    this.data.list<ProyectoOpcion>('Proyecto').subscribe({
      next: (proyectos) => {
        this.proyectos.set(proyectos);
        if (!proyectos.length) return;

        if (ticketIdParam) {
          this.data.getById<Ticket>('Ticket', ticketIdParam).subscribe({
            next: (ticket) => {
              this.proyectoSeleccionadoId.set(Number(ticket.proyectoId));
              this.cargarTablero(ticketIdParam);
            },
            error: () => {
              this.proyectoSeleccionadoId.set(proyectos[0].id);
              this.cargarTablero();
            },
          });
        } else {
          const existe = proyectoIdParam && proyectos.some((p) => Number(p.id) === proyectoIdParam);
          this.proyectoSeleccionadoId.set(existe ? proyectoIdParam : proyectos[0].id);
          this.cargarTablero();
        }
      },
    });
    this.data.list<TicketTipo>('TicketTipo').subscribe((tipos) => this.tipos.set(tipos));
    this.data.list<TicketPrioridad>('TicketPrioridad').subscribe((prioridades) => this.prioridades.set(prioridades));
    this.data.list<TicketModulo>('TicketModulo').subscribe((modulos) => this.modulos.set(modulos));
    this.data.list<Sprint>('Sprint').subscribe((sprints) => this.sprints.set(sprints));
    // 'Usuario' no trae un campo nombreCompleto propio (ver Usuario.model.ts) — hay que
    // armarlo con nombreCompletoUsuario(), si no los combos de Asignado a / Reportado por
    // quedan con opciones en blanco.
    this.data.list<Usuario>('Usuario').subscribe((usuarios) =>
      this.usuarios.set(usuarios.map((u) => ({ id: u.id, nombreCompleto: nombreCompletoUsuario(u) }))),
    );

    // Refresca los badges de vigencia (SLA) cada minuto, igual que el prototipo.
    this.intervaloReloj = setInterval(() => this.ahora.set(Date.now()), 60000);
  }

  ngOnDestroy(): void {
    if (this.intervaloReloj) clearInterval(this.intervaloReloj);
  }

  nombreTipo(id: number): string {
    return this.tipos().find((t) => Number(t.id) === Number(id))?.nombre ?? '—';
  }

  iconoTipo(id: number): string {
    return this.tipos().find((t) => Number(t.id) === Number(id))?.icono ?? '';
  }

  nombreModulo(id: number | null): string {
    if (!id) return '—';
    return this.modulos().find((m) => Number(m.id) === Number(id))?.nombre ?? '—';
  }

  iconoModulo(id: number | null): string {
    if (!id) return '';
    return this.modulos().find((m) => Number(m.id) === Number(id))?.icono ?? '';
  }

  /** Nombre del sprint de un ticket, o 'Backlog' si no tiene ninguno asignado — a
   *  pedido del usuario, para poder ver desde el propio Kanban/Lista y el detalle
   *  del ticket si ya quedó metido en un sprint, sin tener que ir al Backlog. La
   *  asignación en sí (moverlo a un sprint u otro) se sigue haciendo solo desde
   *  ahí — aquí es de solo lectura. */
  nombreSprint(ticket: Ticket): string {
    if (!ticket.sprintId) return 'Backlog';
    return this.sprints().find((s) => Number(s.id) === Number(ticket.sprintId))?.nombre ?? 'Backlog';
  }

  nombrePrioridad(id: number): string {
    return this.prioridades().find((p) => Number(p.id) === Number(id))?.nombre ?? '—';
  }

  colorPrioridad(id: number): string {
    return this.prioridades().find((p) => Number(p.id) === Number(id))?.codigoHex ?? '#999';
  }

  nombreUsuario(id: number | null): string {
    if (!id) return 'Sin asignar';
    return this.usuarios().find((u) => Number(u.id) === Number(id))?.nombreCompleto ?? '—';
  }

  /** Opciones que se ofrecen al crear/editar un ticket (Tipo/Prioridad/Módulo): un
   *  catálogo desactivado deja de ofrecerse para asignaciones nuevas, pero si el
   *  ticket en edición ya lo tenía asignado, se sigue mostrando esa opción — si no,
   *  el <select> nativo se queda sin ninguna opción que calce con el valor guardado
   *  y aparenta (visualmente) haber cambiado de tipo/prioridad/módulo sin que nadie
   *  lo haya tocado. */
  protected readonly tiposSeleccionables = computed(() => {
    const actual = this.ticketEnEdicion()?.ticketTipoId ?? null;
    return this.tipos().filter((t) => t.activo !== false || Number(t.id) === Number(actual));
  });
  protected readonly prioridadesSeleccionables = computed(() => {
    const actual = this.ticketEnEdicion()?.ticketPrioridadId ?? null;
    return this.prioridades().filter((p) => p.activo !== false || Number(p.id) === Number(actual));
  });
  protected readonly modulosSeleccionables = computed(() => {
    const actual = this.ticketEnEdicion()?.ticketModuloId ?? null;
    return this.modulos().filter((m) => m.activo !== false || Number(m.id) === Number(actual));
  });

  columnaActualDe(ticket: Ticket): TableroColumna | undefined {
    return this.columnasTablero().find((c) => Number(c.id) === Number(ticket.tableroColumnaId));
  }

  nombreColumna(id: number): string {
    return this.columnasTablero().find((c) => Number(c.id) === Number(id))?.nombre ?? '—';
  }

  etiquetasDe(ticketId: number): TicketEtiqueta[] {
    return this.etiquetasPorTicket().get(ticketId) ?? [];
  }

  cambiarProyecto(id: number): void {
    this.proyectoSeleccionadoId.set(Number(id));
    this.limpiarFiltros();
    this.cargarTablero();
  }

  limpiarFiltros(): void {
    this.filtroTipoId.set(0);
    this.filtroModuloId.set(0);
    this.filtroPrioridadId.set(0);
    this.filtroEstadoId.set(0);
    this.filtroPlaneado.set(0);
    this.filtroAsignadoId.set(0);
    this.filtroTexto.set('');
  }

  cambiarModoVista(vista: 'tablero' | 'lista'): void {
    this.modoVista.set(vista);
    this.configuracionApariencia.cambiarVistaProyectos(vista);
  }

  exportarTicketsCsv(): void {
    const filas = this.ticketsFiltrados().map((t) => ({
      ...t,
      tipoTexto: this.nombreTipo(t.ticketTipoId),
      prioridadTexto: this.nombrePrioridad(t.ticketPrioridadId),
      estadoTexto: this.nombreColumna(t.tableroColumnaId),
      asignadoTexto: this.nombreUsuario(t.asignadoUsuarioId),
      slaTexto: this.textoSla(t) || 'Sin vigencia',
    }));

    exportarCsv(
      'tickets.csv',
      [
        { clave: 'numeroTicket', etiqueta: 'Folio' },
        { clave: 'titulo', etiqueta: 'Título' },
        { clave: 'tipoTexto', etiqueta: 'Tipo' },
        { clave: 'prioridadTexto', etiqueta: 'Prioridad' },
        { clave: 'estadoTexto', etiqueta: 'Estado' },
        { clave: 'asignadoTexto', etiqueta: 'Asignado a' },
        { clave: 'slaTexto', etiqueta: 'Vigencia' },
      ],
      filas,
    );
  }

  columnaPorDefecto(): number {
    return this.columnasTablero()[0]?.id ?? 0;
  }

  private cargarTablero(abrirTicketId?: number): void {
    const proyectoId = this.proyectoSeleccionadoId();
    if (!proyectoId) return;

    this.cargando.set(true);
    this.data.list<TableroColumna>('TableroColumna', { proyectoId }).subscribe({
      next: (columnas) => {
        this.columnasTablero.set(columnas.sort((a, b) => a.orden - b.orden));
        this.cargarTickets(abrirTicketId);
      },
      error: () => this.cargando.set(false),
    });
  }

  private cargarTickets(abrirTicketId?: number): void {
    const proyectoId = this.proyectoSeleccionadoId();
    this.data.list<Ticket>('Ticket', { proyectoId }).subscribe({
      next: (tickets) => {
        this.tickets.set(tickets);
        this.cargando.set(false);
        this.cargarEtiquetasDeTablero(tickets.map((t) => t.id));
        this.cargarDependenciasDeTablero(tickets.map((t) => t.id));
        if (abrirTicketId) {
          const ticket = tickets.find((t) => Number(t.id) === Number(abrirTicketId));
          if (ticket) this.abrirDetalle(ticket);
        }
      },
      error: () => this.cargando.set(false),
    });
  }

  private cargarEtiquetasDeTablero(ticketIds: number[]): void {
    this.data.list<TicketEtiqueta>('TicketEtiqueta').subscribe({
      next: (todas) => {
        const mapa = new Map<number, TicketEtiqueta[]>();
        for (const id of ticketIds) mapa.set(id, []);
        for (const etiqueta of todas) {
          mapa.get(etiqueta.ticketId)?.push(etiqueta);
        }
        this.etiquetasPorTicket.set(mapa);
      },
    });
  }

  private cargarDependenciasDeTablero(ticketIds: number[]): void {
    this.data.list<TicketDependencia>('TicketDependencia').subscribe({
      next: (todas) => {
        const mapa = new Map<number, TicketDependencia[]>();
        for (const id of ticketIds) mapa.set(id, []);
        for (const dependencia of todas) {
          mapa.get(dependencia.ticketId)?.push(dependencia);
          if (dependencia.ticketRelacionadoId !== dependencia.ticketId) {
            mapa.get(dependencia.ticketRelacionadoId)?.push(dependencia);
          }
        }
        this.dependenciasPorTicket.set(mapa);
      },
    });
  }

  /** Cuántos "Asociados" tiene este ticket — para el 🔗 de la tarjeta del tablero. */
  protected dependenciasDe(ticketId: number): TicketDependencia[] {
    return this.dependenciasPorTicket().get(ticketId) ?? [];
  }

  private folioSugerido(): string {
    const proyecto = this.proyectos().find((p) => p.id === this.proyectoSeleccionadoId());
    const numeros = this.tickets().map((t) => Number(t.numeroTicket.replace(/\D/g, '')) || 0);
    const siguiente = (numeros.length ? Math.max(...numeros) : 0) + 1;
    return `${proyecto?.clave ?? 'TCK'}-${String(siguiente).padStart(4, '0')}`;
  }

  /** Config editable/obligatorio (Gestor de Estados → "⚙ Campos") de los 4 campos
   *  de "Fechas" para la columna del ticket en edición, o la columna de alta si se
   *  está creando uno nuevo — se usa en el modal "Nuevo ticket" para NO mostrar un
   *  campo que la columna inicial tiene deshabilitado: vacío y sin poder tocarlo, no
   *  aporta nada al dar de alta (se captura después, ya con el ticket creado, desde
   *  la pestaña "Fechas"). Si la columna SÍ lo tiene habilitado (o es obligatorio),
   *  se sigue mostrando aquí mismo — igual que antes — para no repetir el bug de un
   *  campo obligatorio oculto que impedía guardar sin ninguna pista. */
  protected readonly configCamposFecha = computed(() => {
    const enEdicion = this.ticketEnEdicion();
    const columnaId = enEdicion ? Number(enEdicion.tableroColumnaId) : this.columnaCreacionId();
    const columna = this.columnasTablero().find((c) => Number(c.id) === Number(columnaId));
    const config = parsearConfiguracionCampos(columna?.configuracionCamposJson);
    return {
      fechaFinAnalisis: reglaCampo(config, 'fechaFinAnalisis'),
      fechaFinDesarrollo: reglaCampo(config, 'fechaFinDesarrollo'),
      fechaFinCliente: reglaCampo(config, 'fechaFinCliente'),
      tiempoEstimadoDias: reglaCampo(config, 'tiempoEstimadoDias'),
    };
  });

  /** Aplica, sobre `this.form`, las reglas editable/obligatorio configuradas para
   *  la columna actual (Gestión de Proyectos → Gestor de Estados → "⚙ Campos").
   *  Se llama cada vez que se abre/actualiza el formulario (alta, detalle, tras
   *  mover el ticket de columna). */
  private aplicarConfiguracionCampos(): void {
    const enEdicion = this.ticketEnEdicion();
    const columnaId = enEdicion ? Number(enEdicion.tableroColumnaId) : this.columnaCreacionId();
    const columna = this.columnasTablero().find((c) => Number(c.id) === Number(columnaId));
    const config = parsearConfiguracionCampos(columna?.configuracionCamposJson);

    for (const campo of TICKET_CAMPOS_CONFIGURABLES) {
      const regla = reglaCampo(config, campo.clave);
      const control = this.form.controls[campo.clave];
      if (regla.editable) control.enable({ emitEvent: false });
      else control.disable({ emitEvent: false });
      control.setValidators(regla.obligatorio ? [Validators.required] : []);
      control.updateValueAndValidity({ emitEvent: false });
    }
  }

  nuevoTicket(columnaId: number): void {
    if (!this.columnasTablero().length) {
      this.toast.advertencia(
        'Este proyecto todavía no tiene columnas configuradas. Créalas primero en Gestor de Estados.',
      );
      return;
    }

    this.ticketEnEdicion.set(null);
    this.columnaCreacionId.set(columnaId || this.columnaPorDefecto());
    this.form.reset({
      id: 0,
      ticketTipoId: 0,
      ticketPrioridadId: 0,
      ticketModuloId: 0,
      asignadoUsuarioId: 0,
      reportadoPorUsuarioId: this.auth.usuarioActual()?.id ?? 0,
      numeroTicket: this.folioSugerido(),
      folioInterno: '',
      titulo: '',
      descripcion: '',
      planeado: true,
      tiempoEstimadoDias: 0,
      fechaFinAnalisis: '',
      fechaFinDesarrollo: '',
      fechaFinCliente: '',
      fechaInicio: '',
      fechaFin: '',
      solucion: '',
      activo: true,
    });
    this.aplicarConfiguracionCampos();
    this.modalAbierto.set(true);
  }

  guardarTicket(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      // Con los campos repartidos en pestañas (Detalles/Fechas/Solución), un campo
      // obligatorio vacío en una pestaña que no es la activa dejaba "Guardar cambios"
      // sin hacer nada, sin ninguna pista de qué faltaba — hay que saltar a la
      // pestaña con el problema y avisar, si no parece que el botón no funciona.
      const controlesFechas = [
        this.form.controls.tiempoEstimadoDias,
        this.form.controls.fechaFinAnalisis,
        this.form.controls.fechaFinDesarrollo,
        this.form.controls.fechaFinCliente,
      ];
      if (controlesFechas.some((c) => c.invalid)) {
        this.tabActiva.set('fechas');
        this.toast.advertencia('Antes de guardar hay campos obligatorios sin llenar en la pestaña "Fechas".');
      } else if (this.form.controls.solucion.invalid) {
        this.tabActiva.set('solucion');
        this.toast.advertencia('Antes de guardar hay campos obligatorios sin llenar en la pestaña "Solución".');
      } else {
        this.tabActiva.set('detalles');
        this.toast.advertencia('Antes de guardar hay campos obligatorios sin llenar en "Detalles".');
      }
      return;
    }

    const valor = this.form.getRawValue();
    const enEdicion = this.ticketEnEdicion();

    // El folio es libre y siempre editable — sin este chequeo, dos tickets del
    // mismo proyecto podrían terminar con el mismo folio (o alguien podría
    // "robarle" el folio a otro ticket ya existente al editar el suyo).
    const folioDuplicado = this.tickets().some(
      (t) =>
        t.numeroTicket.trim().toLowerCase() === valor.numeroTicket.trim().toLowerCase() &&
        Number(t.id) !== Number(valor.id),
    );
    if (folioDuplicado) {
      this.toast.advertencia(`Ya existe un ticket con el folio "${valor.numeroTicket}" en este proyecto.`);
      return;
    }

    const payload = {
      id: valor.id,
      proyectoId: this.proyectoSeleccionadoId(),
      tableroColumnaId: enEdicion ? Number(enEdicion.tableroColumnaId) : this.columnaCreacionId(),
      ticketTipoId: Number(valor.ticketTipoId),
      ticketPrioridadId: Number(valor.ticketPrioridadId),
      ticketModuloId: valor.ticketModuloId ? Number(valor.ticketModuloId) : null,
      asignadoUsuarioId: valor.asignadoUsuarioId ? Number(valor.asignadoUsuarioId) : null,
      reportadoPorUsuarioId: Number(valor.reportadoPorUsuarioId),
      numeroTicket: valor.numeroTicket,
      folioInterno: valor.folioInterno || null,
      titulo: valor.titulo,
      descripcion: valor.descripcion || null,
      planeado: valor.planeado,
      tiempoEstimadoMin: valor.tiempoEstimadoDias ? Math.round(valor.tiempoEstimadoDias * 1440) : null,
      fechaFinAnalisis: valor.fechaFinAnalisis || null,
      fechaFinDesarrollo: valor.fechaFinDesarrollo || null,
      fechaFinCliente: valor.fechaFinCliente || null,
      fechaInicio: valor.fechaInicio || null,
      fechaFin: valor.fechaFin || null,
      solucion: valor.solucion || null,
      activo: valor.activo,
    };

    const esEdicion = enEdicion !== null;
    const peticion = esEdicion
      ? this.data.modificacion<Ticket>('Ticket', payload)
      : this.data.alta<Ticket>('Ticket', payload);

    // Para poder avisarle al nuevo asignado SOLO cuando el asignado realmente
    // cambió (y no en cada guardado, ni cuando se asigna a sí mismo).
    const asignadoAnteriorId = enEdicion?.asignadoUsuarioId ? Number(enEdicion.asignadoUsuarioId) : null;

    peticion.subscribe({
      next: (ticketGuardado) => {
        this.toast.exito(esEdicion ? 'Ticket actualizado.' : 'Ticket creado.');
        if (payload.asignadoUsuarioId && payload.asignadoUsuarioId !== asignadoAnteriorId) {
          this.notificarAsignacion(ticketGuardado, payload.asignadoUsuarioId);
        }
        if (esEdicion) {
          this.refrescarTicketActivo();
        } else {
          // Deja registro en Historial de que el ticket nació en esta columna —
          // si no, la pestaña Historial queda vacía hasta el primer cambio de estado.
          this.data
            .alta<TicketHistorialEstado>('TicketHistorialEstado', {
              ticketId: ticketGuardado.id,
              tableroColumnaAnteriorId: null,
              tableroColumnaNuevaId: payload.tableroColumnaId,
              usuarioId: this.auth.usuarioActual()?.id ?? null,
            })
            .subscribe({ error: () => undefined });
          this.modalAbierto.set(false);
        }
        this.cargarTickets();
      },
    });
  }

  /** Notifica al usuario recién asignado — no antes de guardar (si falla el guardado, no
   *  tiene sentido avisar de una asignación que no se llegó a persistir). */
  private notificarAsignacion(ticket: Ticket, asignadoUsuarioId: number): void {
    if (asignadoUsuarioId === this.auth.usuarioActual()?.id) return;
    this.notificaciones.notificar(
      asignadoUsuarioId,
      `Te asignaron el ticket #${ticket.numeroTicket} — ${ticket.titulo}`,
      `/proyectos/tablero?ticket=${ticket.id}`,
    );
  }

  /** Único punto que persiste un cambio de columna: lo usan los botones "Aceptar"/"Regresar"
   *  de la barra de estado del detalle (único lugar desde donde se cambia de estado — ver
   *  `mover()`). También deja registro en TicketHistorialEstado (bitácora de cambios de estado). */
  private moverTicketAColumna(ticket: Ticket, columnaId: number): void {
    if (Number(ticket.tableroColumnaId) === Number(columnaId)) return;
    const columnaAnteriorId = Number(ticket.tableroColumnaId);
    this.data.modificacion<Ticket>('Ticket', { ...ticket, tableroColumnaId: Number(columnaId) }).subscribe({
      next: () => {
        // Best-effort: el historial es una bitácora informativa, no debe
        // impedir que el movimiento del ticket (ya persistido arriba) se
        // refleje en pantalla si este registro en particular falla.
        this.data
          .alta<TicketHistorialEstado>('TicketHistorialEstado', {
            ticketId: ticket.id,
            tableroColumnaAnteriorId: columnaAnteriorId,
            tableroColumnaNuevaId: Number(columnaId),
            usuarioId: this.auth.usuarioActual()?.id ?? null,
          })
          .subscribe({ error: () => undefined });
        this.notificarCambioEstado(ticket, Number(columnaId));
        this.cargarTickets();
        if (this.ticketActivo()?.id === ticket.id) this.refrescarTicketActivo();
      },
      error: () => this.toast.error('No se pudo mover el ticket. Intenta de nuevo.'),
    });
  }

  /** Avisa a quien REPORTÓ el ticket y a sus seguidores (TicketSeguidor) cuando cambia
   *  de columna — antes solo se notificaba al asignado, y solo al asignárselo (ver
   *  notificarAsignacion), nunca al avanzar/retroceder de estado. Consulta
   *  TicketSeguidor directo (no this.seguidores(), que solo trae los del detalle
   *  abierto) para funcionar igual se mueva el ticket desde el detalle o el tablero. */
  private notificarCambioEstado(ticket: Ticket, columnaNuevaId: number): void {
    const propioId = this.auth.usuarioActual()?.id ?? null;
    const columnas = this.columnasTablero();
    const esResuelto = columnas.length > 0 && Number(columnaNuevaId) === Number(columnas[columnas.length - 1].id);
    const titulo = `${esResuelto ? '✅ Se resolvió' : '🔄 Cambió de estado'} el ticket #${ticket.numeroTicket} — ${ticket.titulo} (${this.nombreColumna(columnaNuevaId)})`;
    const link = `/proyectos/tablero?ticket=${ticket.id}`;

    const destinatarios = new Set<number>();
    if (ticket.reportadoPorUsuarioId && Number(ticket.reportadoPorUsuarioId) !== Number(propioId)) {
      destinatarios.add(Number(ticket.reportadoPorUsuarioId));
    }
    this.data.list<TicketSeguidor>('TicketSeguidor', { ticketId: ticket.id }).subscribe((seguidores) => {
      for (const s of seguidores) {
        if (Number(s.usuarioId) !== Number(propioId)) destinatarios.add(Number(s.usuarioId));
      }
      for (const usuarioId of destinatarios) {
        this.notificaciones.notificar(usuarioId, titulo, link);
      }
    });
  }

  mover(ticket: Ticket, direccion: -1 | 1): void {
    const columnas = this.columnasTablero();
    const indiceActual = columnas.findIndex((c) => Number(c.id) === Number(ticket.tableroColumnaId));
    const indiceDestino = indiceActual + direccion;
    if (indiceActual === -1 || indiceDestino < 0 || indiceDestino >= columnas.length) return;

    // Misma restricción de flujo configurada en Gestor de Estados ("🔀 Flujo") que ya
    // aplica onDrop()/esDestinoValido() al arrastrar — antes SOLO se validaba aquí el
    // límite del arreglo de columnas, así que "Aceptar"/"◀ Regresar" podían saltarse
    // por completo una restricción de transicionesPermitidasJson que drag&drop sí
    // respeta (bug encontrado en revisión general del módulo).
    const origen = columnas[indiceActual];
    const destino = columnas[indiceDestino];
    if (!puedeMoverA(origen, Number(destino.id))) {
      this.toast.advertencia(`No se puede mover de "${origen.nombre}" a "${destino.nombre}".`);
      return;
    }

    // Cambiar de estado (avanzar O retroceder) exige haber bitacoreado qué se hizo en la
    // columna actual — solo se puede verificar de forma confiable cuando el detalle de ESTE
    // ticket está abierto (actividades()/historial() traen datos de ese ticket en ese caso),
    // y solo si la columna actual permite la pestaña Actividades (si no la permite, no hay
    // dónde registrarla, así que no se puede exigir).
    if (
      this.ticketActivo()?.id === ticket.id &&
      this.tabsPermitidas().actividades &&
      !this.tieneActividadDesdeUltimoCambio(ticket)
    ) {
      this.tabActiva.set('actividades');
      this.toast.advertencia('Antes de cambiar de estado es obligatorio registrar una actividad describiendo qué se hizo.');
      return;
    }

    this.moverTicketAColumna(ticket, columnas[indiceDestino].id);
  }

  // ---------------- Arrastrar y soltar (mover tickets entre columnas del tablero) ----------------

  onDragStart(ticket: Ticket): void {
    this.ticketArrastrando.set(ticket);
  }

  onDragEnd(): void {
    this.ticketArrastrando.set(null);
  }

  /** Necesario para que el navegador permita soltar sobre la columna (por defecto lo bloquea). */
  onDragOver(evento: DragEvent): void {
    if (!this.ticketArrastrando()) return;
    evento.preventDefault();
  }

  /** Resalta como destino válido solo las columnas a las que el ticket arrastrado sí puede
   *  moverse — misma lógica de permisos (`puedeMoverA`) que aplica `soltarTicket()` al soltar. */
  esDestinoValido(columna: TableroColumna): boolean {
    const ticket = this.ticketArrastrando();
    if (!ticket) return false;
    const origen = this.columnasTablero().find((c) => Number(c.id) === Number(ticket.tableroColumnaId));
    if (!origen) return false;
    return puedeMoverA(origen, Number(columna.id));
  }

  /** Suelta el ticket arrastrado sobre `columnaDestino` — respeta la misma restricción de
   *  flujo configurada en Gestor de Estados (`puedeMoverA`) y la misma regla de "actividad
   *  obligatoria antes de cambiar de estado" que `mover()`, para que arrastrar no sea un atajo
   *  que se salte esa validación. */
  onDrop(evento: DragEvent, columnaDestino: TableroColumna): void {
    evento.preventDefault();
    const ticket = this.ticketArrastrando();
    this.ticketArrastrando.set(null);
    if (!ticket) return;

    const origen = this.columnasTablero().find((c) => Number(c.id) === Number(ticket.tableroColumnaId));
    if (!origen || Number(origen.id) === Number(columnaDestino.id)) return;

    if (!puedeMoverA(origen, Number(columnaDestino.id))) {
      this.toast.advertencia(`No se puede mover de "${origen.nombre}" a "${columnaDestino.nombre}".`);
      return;
    }

    if (
      this.ticketActivo()?.id === ticket.id &&
      this.tabsPermitidas().actividades &&
      !this.tieneActividadDesdeUltimoCambio(ticket)
    ) {
      this.tabActiva.set('actividades');
      this.toast.advertencia('Antes de cambiar de estado es obligatorio registrar una actividad describiendo qué se hizo.');
      return;
    }

    this.moverTicketAColumna(ticket, Number(columnaDestino.id));
  }

  /** true si ya se registró al menos una Actividad después del último cambio de columna
   *  (o, si nunca ha cambiado de columna, después de creado) — la condición para poder
   *  avanzar de estado desde la barra "Siguiente estado" del detalle. */
  private tieneActividadDesdeUltimoCambio(ticket: Ticket): boolean {
    const ultimoCambio = this.historial()[0]?.fechaCreacion ?? ticket.fechaCreacion ?? '';
    return this.actividades().some((a) => (a.fechaCreacion ?? '') > ultimoCambio);
  }

  /** Columna que sigue en el orden configurado, o null si el ticket ya está en la
   *  última — usada por la barra "Siguiente estado" del detalle (un solo paso hacia
   *  adelante). */
  siguienteColumna(ticket: Ticket): TableroColumna | null {
    const columnas = this.columnasTablero();
    const indiceActual = columnas.findIndex((c) => Number(c.id) === Number(ticket.tableroColumnaId));
    if (indiceActual === -1 || indiceActual >= columnas.length - 1) return null;
    return columnas[indiceActual + 1];
  }

  /** Columna anterior en el orden configurado, o null si el ticket ya está en la primera —
   *  usada por el botón "Regresar" de la barra de estado del detalle (único lugar desde
   *  donde ahora se puede retroceder de estado; ver nota en `mover()`). */
  columnaAnterior(ticket: Ticket): TableroColumna | null {
    const columnas = this.columnasTablero();
    const indiceActual = columnas.findIndex((c) => Number(c.id) === Number(ticket.tableroColumnaId));
    if (indiceActual <= 0) return null;
    return columnas[indiceActual - 1];
  }

  // ---------------- Detalle del ticket (tabs: Detalles / Actividades / Comentarios / Etiquetas) ----------------

  abrirDetalle(ticket: Ticket): void {
    this.data.getById<Ticket>('Ticket', ticket.id).subscribe({
      next: (completo) => {
        this.ticketEnEdicion.set(completo);
        this.ticketActivo.set(completo);
        this.tabActiva.set('detalles');
        this.form.reset({
          id: completo.id,
          ticketTipoId: Number(completo.ticketTipoId),
          ticketPrioridadId: Number(completo.ticketPrioridadId),
          ticketModuloId: completo.ticketModuloId ? Number(completo.ticketModuloId) : 0,
          asignadoUsuarioId: completo.asignadoUsuarioId ? Number(completo.asignadoUsuarioId) : 0,
          reportadoPorUsuarioId: Number(completo.reportadoPorUsuarioId),
          numeroTicket: completo.numeroTicket,
          folioInterno: completo.folioInterno ?? '',
          titulo: completo.titulo,
          descripcion: completo.descripcion ?? '',
          planeado: completo.planeado,
          tiempoEstimadoDias: completo.tiempoEstimadoMin ? completo.tiempoEstimadoMin / 1440 : 0,
          fechaFinAnalisis: (completo.fechaFinAnalisis ?? '').slice(0, 10),
          fechaFinDesarrollo: (completo.fechaFinDesarrollo ?? '').slice(0, 10),
          fechaFinCliente: (completo.fechaFinCliente ?? '').slice(0, 10),
          fechaInicio: (completo.fechaInicio ?? '').slice(0, 10),
          fechaFin: (completo.fechaFin ?? '').slice(0, 10),
          solucion: completo.solucion ?? '',
          activo: completo.activo ?? true,
        });
        this.aplicarConfiguracionCampos();
        this.formComentario.reset({ texto: '' });
        this.formActividad.reset({ texto: '', tiempoHoras: 0.25 });
        this.formEtiqueta.reset({ texto: '' });
        this.formAsociado.reset({ ticketRelacionadoId: 0, tipo: 'relacionado' });
        this.filtroAsociado.set('');
        this.formSubtarea.reset({ titulo: '' });
        this.formSubtareaExistente.reset({ ticketId: 0 });
        this.filtroSubtarea.set('');
        this.cargarDetalle(completo.id);
      },
    });
  }

  cerrarDetalle(): void {
    this.ticketActivo.set(null);
    this.ticketEnEdicion.set(null);
  }

  private refrescarTicketActivo(): void {
    const activo = this.ticketActivo();
    if (!activo) return;
    this.data.getById<Ticket>('Ticket', activo.id).subscribe({
      next: (completo) => {
        this.ticketActivo.set(completo);
        this.ticketEnEdicion.set(completo);
        this.aplicarConfiguracionCampos();
        this.cargarDetalle(completo.id);
        this.ajustarTabSiNoPermitida();
      },
    });
  }

  /** Si la columna nueva ya no permite la pestaña activa (p.ej. se movió a una columna sin permiteAnexos), vuelve a "Detalles". */
  private ajustarTabSiNoPermitida(): void {
    const permitidas = this.tabsPermitidas();
    const tab = this.tabActiva();
    if (
      (tab === 'actividades' && !permitidas.actividades) ||
      (tab === 'adjuntos' && !permitidas.adjuntos) ||
      (tab === 'asociados' && !permitidas.asociados)
    ) {
      this.tabActiva.set('detalles');
    }
  }

  pedirEliminarTicket(ticket: Ticket): void {
    this.ticketAEliminar.set(ticket);
  }

  confirmarEliminarTicket(): void {
    const ticket = this.ticketAEliminar();
    if (!ticket) return;

    // IndexedDB no tiene integridad referencial: si solo se borra el Ticket,
    // su bitácora de actividades y su historial de cambios de estado quedan
    // huérfanos en la base. Antes de dar de baja el ticket, se borran esos
    // registros relacionados.
    forkJoin([
      this.data.list<TicketActividad>('TicketActividad', { ticketId: ticket.id }),
      this.data.list<TicketHistorialEstado>('TicketHistorialEstado', { ticketId: ticket.id }),
    ])
      .pipe(
        switchMap(([actividades, historial]) => {
          const bajas = [
            ...actividades.map((a) => this.data.baja('TicketActividad', a.id)),
            ...historial.map((h) => this.data.baja('TicketHistorialEstado', h.id)),
          ];
          return bajas.length ? forkJoin(bajas) : of(null);
        }),
        switchMap(() => this.data.baja('Ticket', ticket.id)),
      )
      .subscribe({
        next: () => {
          this.toast.exito('Ticket eliminado.');
          this.ticketAEliminar.set(null);
          this.cerrarDetalle();
          this.cargarTickets();
        },
      });
  }

  private cargarDetalle(ticketId: number): void {
    this.data
      .list<TicketComentario>('TicketComentario', { ticketId })
      .subscribe((comentarios) => this.comentarios.set(comentarios));
    this.data
      .list<TicketActividad>('TicketActividad', { ticketId })
      .subscribe((actividades) => this.actividades.set(actividades));
    this.data.list<TicketEtiqueta>('TicketEtiqueta', { ticketId }).subscribe((etiquetas) => this.etiquetas.set(etiquetas));
    this.data
      .list<TicketHistorialEstado>('TicketHistorialEstado', { ticketId })
      .subscribe((historial) =>
        this.historial.set(
          [...historial].sort((a, b) => (b.fechaCreacion ?? '').localeCompare(a.fechaCreacion ?? '')),
        ),
      );
    this.data
      .list<TicketDependencia>('TicketDependencia', { ticketId })
      .subscribe((dependencias) => this.dependencias.set(dependencias));
    this.data
      .list<TicketDependencia>('TicketDependencia', { ticketRelacionadoId: ticketId })
      .subscribe((entrantes) => this.dependenciasEntrantes.set(entrantes));
    this.data.list<TicketSeguidor>('TicketSeguidor', { ticketId }).subscribe((seguidores) => this.seguidores.set(seguidores));
  }

  // ---------------- Asociados (TicketDependencia) ----------------

  ticketPorId(id: number): Ticket | undefined {
    return this.tickets().find((t) => Number(t.id) === Number(id));
  }

  agregarAsociado(): void {
    const activo = this.ticketActivo();
    const ticketRelacionadoId = Number(this.formAsociado.controls.ticketRelacionadoId.value);
    const tipo = this.formAsociado.controls.tipo.value;
    if (!activo || !ticketRelacionadoId) return;

    this.data
      .alta<TicketDependencia>('TicketDependencia', { ticketId: activo.id, ticketRelacionadoId, tipo })
      .subscribe({
        next: () => {
          this.formAsociado.reset({ ticketRelacionadoId: 0, tipo: 'relacionado' });
        this.filtroAsociado.set('');
          this.cargarDetalle(activo.id);
          this.cargarDependenciasDeTablero(this.tickets().map((t) => t.id));
        },
      });
  }

  eliminarAsociado(dependencia: TicketDependencia): void {
    const activo = this.ticketActivo();
    if (!activo) return;
    this.data.baja('TicketDependencia', dependencia.id).subscribe({
      next: () => {
        this.cargarDetalle(activo.id);
        this.cargarDependenciasDeTablero(this.tickets().map((t) => t.id));
      },
    });
  }

  // ---------------- Subtareas (Ticket.ticketPadreId) ----------------

  /** true si esta subtarea ya se dio por terminada — misma regla que "resuelto"
   *  para cualquier ticket (última columna del tablero). Wrapper protected porque
   *  estaResuelto() es privado y el template necesita leerlo (progresoSubtareasActivo/lista). */
  protected subtareaCompletada(ticket: Ticket): boolean {
    return this.estaResuelto(ticket);
  }

  /** Cuántas de estas subtareas ya están completadas — para el tag "🧩 X/Y" de
   *  la tarjeta del tablero (ver subtareasPorTicket). Método aparte en vez de
   *  `hijos.filter(this.subtareaCompletada)` en el template: pasar un método de
   *  la clase como callback de filter() pierde el `this` (no es un arrow bound). */
  protected subtareasCompletadasDe(hijos: Ticket[]): number {
    return hijos.filter((h) => this.estaResuelto(h)).length;
  }

  /** Alta rápida de una subtarea: solo pide título (como el "+ agregar subtarea"
   *  de Jira) y hereda proyecto/tipo/prioridad/módulo del ticket padre — el resto
   *  se captura después, ya con el ticket creado, igual que cualquier otro ticket. */
  crearSubtarea(): void {
    const activo = this.ticketActivo();
    if (!activo || this.formSubtarea.invalid) return;
    const titulo = this.formSubtarea.controls.titulo.value.trim();
    if (!titulo) return;

    this.data
      .alta<Ticket>('Ticket', {
        proyectoId: activo.proyectoId,
        tableroColumnaId: this.columnaPorDefecto(),
        ticketTipoId: activo.ticketTipoId,
        ticketPrioridadId: activo.ticketPrioridadId,
        ticketModuloId: activo.ticketModuloId ?? null,
        asignadoUsuarioId: null,
        reportadoPorUsuarioId: this.auth.usuarioActual()?.id ?? activo.reportadoPorUsuarioId,
        numeroTicket: this.folioSugerido(),
        folioInterno: null,
        titulo,
        descripcion: null,
        planeado: true,
        tiempoEstimadoMin: null,
        fechaFinAnalisis: null,
        fechaFinDesarrollo: null,
        fechaFinCliente: null,
        fechaInicio: null,
        fechaFin: null,
        solucion: null,
        activo: true,
        ticketPadreId: activo.id,
      })
      .subscribe({
        next: () => {
          this.formSubtarea.reset({ titulo: '' });
          this.toast.exito('Subtarea creada.');
          this.cargarTickets();
        },
      });
  }

  /** Convierte un ticket ya existente (sin padre ni subtareas propias) en
   *  subtarea del ticket abierto — ver ticketsDisponiblesParaSubtarea. */
  convertirEnSubtarea(): void {
    const activo = this.ticketActivo();
    const ticketId = Number(this.formSubtareaExistente.controls.ticketId.value);
    if (!activo || !ticketId) return;
    const candidato = this.tickets().find((t) => Number(t.id) === ticketId);
    if (!candidato) return;

    this.data.modificacion<Ticket>('Ticket', { ...candidato, ticketPadreId: activo.id }).subscribe({
      next: () => {
        this.formSubtareaExistente.reset({ ticketId: 0 });
        this.filtroSubtarea.set('');
        this.toast.exito('Ticket convertido en subtarea.');
        this.cargarTickets();
      },
    });
  }

  /** Quita el vínculo (no elimina el ticket, solo deja de ser subtarea). */
  quitarDeSubtareas(ticket: Ticket): void {
    this.data.modificacion<Ticket>('Ticket', { ...ticket, ticketPadreId: null }).subscribe({
      next: () => {
        this.toast.exito('Se quitó como subtarea.');
        this.cargarTickets();
      },
    });
  }

  // ---------------- Seguidores (TicketSeguidor) ----------------

  esSeguidor(usuarioId: number): boolean {
    return this.seguidores().some((s) => Number(s.usuarioId) === Number(usuarioId));
  }

  toggleSeguidor(usuarioId: number, marcado: boolean): void {
    const activo = this.ticketActivo();
    if (!activo) return;

    if (marcado) {
      this.data.alta<TicketSeguidor>('TicketSeguidor', { ticketId: activo.id, usuarioId }).subscribe({
        next: () => this.cargarDetalle(activo.id),
      });
    } else {
      const fila = this.seguidores().find((s) => Number(s.usuarioId) === Number(usuarioId));
      if (!fila) return;
      this.data.baja('TicketSeguidor', fila.id).subscribe({
        next: () => this.cargarDetalle(activo.id),
      });
    }
  }

  agregarComentario(): void {
    const activo = this.ticketActivo();
    if (!activo || this.formComentario.invalid) return;

    const texto = this.formComentario.controls.texto.value;
    this.data
      .alta<TicketComentario>('TicketComentario', {
        ticketId: activo.id,
        texto,
        creadoPor: this.auth.usuarioActual()?.id ?? null,
      })
      .subscribe({
        next: () => {
          this.notificarMenciones(activo, texto);
          this.formComentario.reset({ texto: '' });
          this.cargarDetalle(activo.id);
        },
      });
  }

  /** Notifica a cada usuario mencionado con "@primerNombre" en un comentario recién
   *  guardado. Se compara solo contra el primer nombre (sin apellido, insensible a
   *  mayúsculas) porque el catálogo de Usuarios no tiene un @usuario/slug propio. */
  private notificarMenciones(ticket: Ticket, texto: string): void {
    const tokens = new Set(
      Array.from(texto.matchAll(/@([\p{L}\p{N}_]+)/gu)).map((m) => m[1].toLowerCase()),
    );
    if (!tokens.size) return;

    const propioId = this.auth.usuarioActual()?.id ?? null;
    const yaNotificados = new Set<number>();
    for (const usuario of this.usuarios()) {
      const primerNombre = usuario.nombreCompleto.trim().split(/\s+/)[0]?.toLowerCase();
      if (!primerNombre || !tokens.has(primerNombre)) continue;
      if (Number(usuario.id) === Number(propioId) || yaNotificados.has(Number(usuario.id))) continue;
      yaNotificados.add(Number(usuario.id));
      this.notificaciones.notificar(
        Number(usuario.id),
        `Te mencionaron en el ticket #${ticket.numeroTicket} — ${ticket.titulo}`,
        `/proyectos/tablero?ticket=${ticket.id}`,
      );
    }
  }

  agregarActividad(): void {
    const activo = this.ticketActivo();
    if (!activo || this.formActividad.invalid) return;

    const { tiempoHoras, ...resto } = this.formActividad.getRawValue();

    this.data
      .alta<TicketActividad>('TicketActividad', {
        ticketId: activo.id,
        ...resto,
        tiempoMin: Math.round(tiempoHoras * 60),
        creadoPor: this.auth.usuarioActual()?.id ?? null,
      })
      .subscribe({
        next: () => {
          this.formActividad.reset({ texto: '', tiempoHoras: 0.25 });
          this.cargarDetalle(activo.id);
        },
      });
  }

  agregarEtiqueta(): void {
    const activo = this.ticketActivo();
    if (!activo || this.formEtiqueta.invalid) return;

    this.data
      .alta<TicketEtiqueta>('TicketEtiqueta', {
        ticketId: activo.id,
        texto: this.formEtiqueta.controls.texto.value,
      })
      .subscribe({
        next: () => {
          this.formEtiqueta.reset({ texto: '' });
          this.cargarDetalle(activo.id);
          this.cargarEtiquetasDeTablero(this.tickets().map((t) => t.id));
        },
      });
  }

  eliminarEtiqueta(etiqueta: TicketEtiqueta): void {
    const activo = this.ticketActivo();
    if (!activo) return;

    this.data.baja('TicketEtiqueta', etiqueta.id).subscribe({
      next: () => {
        this.cargarDetalle(activo.id);
        this.cargarEtiquetasDeTablero(this.tickets().map((t) => t.id));
      },
    });
  }

  totalMinutosActividad(): number {
    return this.actividades().reduce((acc, a) => acc + a.tiempoMin, 0);
  }

  /** Comparación estimado vs. registrado del ticket abierto (pestaña Actividades) —
   *  mismo criterio que "Horas est./Horas reales" de Resumen ejecutivo, pero a
   *  nivel de un solo ticket (ahí ya se comparaba por proyecto; aquí faltaba verlo
   *  en el propio ticket, como la barra de "time tracking" de Jira). null cuando
   *  el ticket no tiene nada estimado (no hay contra qué comparar). */
  protected readonly progresoTiempoActividad = computed(() => {
    const estimadoMin = this.ticketActivo()?.tiempoEstimadoMin ?? null;
    if (!estimadoMin || estimadoMin <= 0) return null;
    const realMin = this.actividades().reduce((acc, a) => acc + a.tiempoMin, 0);
    const pct = Math.round((realMin / estimadoMin) * 100);
    return { estimadoMin, realMin, pct, sobrepasado: realMin > estimadoMin };
  });

  /** Formatea minutos como horas para la UI (el dato real sigue en minutos — ver
   *  formActividad — para no romper las sumas de Reportes de horas/Dashboard, que
   *  asumen TicketActividad.tiempoMin en minutos). */
  protected formatearHoras(minutos: number): string {
    return (Math.round((minutos / 60) * 100) / 100).toString();
  }

  // ---------------- Vigencia (SLA) según la prioridad del ticket ----------------

  private estaResuelto(ticket: Ticket): boolean {
    const columnas = this.columnasTablero();
    return columnas.length > 0 && Number(ticket.tableroColumnaId) === Number(columnas[columnas.length - 1].id);
  }

  private slaInfo(ticket: Ticket): { deadline: number; warnAt: number; isExpired: boolean; isWarning: boolean } | null {
    const prioridad = this.prioridades().find((p) => Number(p.id) === Number(ticket.ticketPrioridadId));
    if (!prioridad?.vigenciaHoras || !ticket.fechaCreacion || this.estaResuelto(ticket)) return null;

    const creado = new Date(ticket.fechaCreacion).getTime();
    const deadline = creado + prioridad.vigenciaHoras * 3600000;
    const warnAt = deadline - (prioridad.avisoHoras || 0) * 3600000;
    const ahora = this.ahora();
    return {
      deadline,
      warnAt,
      isExpired: ahora >= deadline,
      isWarning: ahora >= warnAt && ahora < deadline,
    };
  }

  claseSla(ticket: Ticket): ClaseSla | null {
    const info = this.slaInfo(ticket);
    if (!info) return null;
    return info.isExpired ? 'sla-expired' : info.isWarning ? 'sla-warning' : 'sla-ok';
  }

  /** Mismo semáforo de `claseSla`, traducido a las clases `.grid-badge-*` que usa la vista de Lista. */
  claseBadgeSla(ticket: Ticket): string {
    const clase = this.claseSla(ticket);
    if (clase === 'sla-expired') return 'grid-badge-danger';
    if (clase === 'sla-warning') return 'grid-badge-warning';
    if (clase === 'sla-ok') return 'grid-badge-success';
    return 'grid-badge-muted';
  }

  textoSla(ticket: Ticket): string {
    const info = this.slaInfo(ticket);
    if (!info) return '';
    if (info.isExpired) return '🔥 Vencido';
    if (info.isWarning) return '⏰ Por vencer';
    return '🕐 ' + this.tiempoRestante(info.deadline);
  }

  private tiempoRestante(deadline: number): string {
    const ms = deadline - this.ahora();
    if (ms <= 0) return 'vencido';
    const totalMinutos = Math.round(ms / 60000);
    if (totalMinutos < 60) return `faltan ${totalMinutos}min`;

    const totalHoras = Math.round(totalMinutos / 60);
    if (totalHoras < 24) return `faltan ${totalHoras}h`;

    // A partir de 24h se muestra en días + horas (p.ej. "faltan 3d 12h") en vez de
    // solo un número grande de horas, más fácil de leer de un vistazo.
    const dias = Math.floor(totalHoras / 24);
    const horas = totalHoras % 24;
    return horas > 0 ? `faltan ${dias}d ${horas}h` : `faltan ${dias}d`;
  }
}

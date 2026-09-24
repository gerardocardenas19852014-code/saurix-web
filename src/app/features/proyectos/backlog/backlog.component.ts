import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable, forkJoin, of } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { ToastService } from '../../../shared/services/toast.service';
import { colorAvatar, colorBadgeFondo, colorBadgeTexto, iniciales } from '../kanban/avatar.util';
import { Ticket } from '../kanban/ticket.model';
import { ProyectoOpcion, TableroColumna } from '../tableros/tablero-columna.model';
import { TicketPrioridad } from '../ticket-prioridades/ticket-prioridad.model';
import { TicketTipo } from '../ticket-tipos/ticket-tipo.model';
import { TicketModulo } from '../ticket-modulos/ticket-modulo.model';
import { Usuario, nombreCompletoUsuario } from '../../seguridad/usuarios/usuario.model';
import { Sprint } from '../sprints/sprint.model';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';

/**
 * Backlog + Sprints (Gestión de Proyectos) — patrón Scrum de Jira, ausente
 * hasta ahora en Saurix (que solo tenía el tablero Kanban). Un ticket sin
 * sprint asignado (Ticket.sprintId null) vive en el Backlog; desde aquí se
 * arma un Sprint con fechas/objetivo, se le "meten" tickets del Backlog, se
 * inicia (estado 'activo' — solo uno a la vez por proyecto) y se completa
 * (estado 'cerrado' — los tickets no resueltos regresan solos al Backlog).
 *
 * El tablero Kanban (columnas/estado) sigue siendo el mismo de siempre: un
 * ticket puede estar en un sprint Y en cualquier columna del tablero a la
 * vez — son dos clasificaciones independientes, igual que en Jira (el
 * sprint no reemplaza al workflow de estados, lo complementa).
 */
@Component({
  selector: 'app-backlog',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, ConfirmDialogComponent],
  templateUrl: './backlog.component.html',
  styleUrl: './backlog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BacklogComponent implements OnInit {
  private readonly data = inject(DataClientService);
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  protected readonly toast = inject(ToastService);

  protected readonly colorAvatar = colorAvatar;
  protected readonly iniciales = iniciales;
  protected readonly nombreCompletoUsuario = nombreCompletoUsuario;

  protected readonly cargando = signal(false);
  protected readonly proyectos = signal<ProyectoOpcion[]>([]);
  protected readonly proyectoSeleccionadoId = signal<number>(0);
  protected readonly columnasTablero = signal<TableroColumna[]>([]);
  protected readonly tickets = signal<Ticket[]>([]);
  protected readonly sprints = signal<Sprint[]>([]);
  protected readonly prioridades = signal<TicketPrioridad[]>([]);
  protected readonly usuarios = signal<Usuario[]>([]);
  protected readonly tipos = signal<TicketTipo[]>([]);
  protected readonly modulos = signal<TicketModulo[]>([]);

  /** Mismos filtros de catálogo que la pantalla Ticket (Tipo/Módulo/Prioridad/
   *  Asignado a) — aplican a TODO lo que se muestra en esta pantalla (Backlog y
   *  cada sprint), para poder acotar la lista cuando hay muchos tickets. */
  protected readonly filtroTipoId = signal<number>(0);
  protected readonly filtroModuloId = signal<number>(0);
  protected readonly filtroPrioridadId = signal<number>(0);
  protected readonly filtroAsignadoId = signal<number>(0);
  protected readonly hayFiltros = computed(
    () =>
      !!(
        this.filtroTipoId() ||
        this.filtroModuloId() ||
        this.filtroPrioridadId() ||
        this.filtroAsignadoId() ||
        this.filtroBacklog().trim()
      ),
  );

  limpiarFiltros(): void {
    this.filtroTipoId.set(0);
    this.filtroModuloId.set(0);
    this.filtroPrioridadId.set(0);
    this.filtroAsignadoId.set(0);
    this.filtroBacklog.set('');
  }

  /** true si el ticket pasa los filtros de catálogo (Tipo/Módulo/Prioridad/
   *  Asignado a) — el filtro de texto del Backlog se aplica aparte, en
   *  ticketsBacklogFiltrados, porque solo existe ahí (los sprints ya suelen
   *  traer pocos tickets). -1 en Módulo significa "Sin módulo", igual que en
   *  la pantalla Ticket. */
  private coincideFiltrosCatalogo(t: Ticket): boolean {
    if (this.filtroTipoId() && Number(t.ticketTipoId) !== Number(this.filtroTipoId())) return false;
    if (this.filtroModuloId()) {
      if (this.filtroModuloId() === -1 && t.ticketModuloId) return false;
      if (this.filtroModuloId() !== -1 && Number(t.ticketModuloId) !== Number(this.filtroModuloId())) return false;
    }
    if (this.filtroPrioridadId() && Number(t.ticketPrioridadId) !== Number(this.filtroPrioridadId())) return false;
    if (this.filtroAsignadoId() && Number(t.asignadoUsuarioId) !== Number(this.filtroAsignadoId())) return false;
    return true;
  }

  /** 2 vistas a elegir para esta pantalla (mismo patrón de pestañas que
   *  Tablero Kanban/Lista) — antes se mostraban SIEMPRE los sprints Y el
   *  Backlog agrupado por fecha en la misma página larga; ahora se elige
   *  cuál ver, para no tener que hacer scroll por todo junto. */
  protected readonly vistaBacklog = signal<'sprints' | 'backlog'>('sprints');
  cambiarVistaBacklog(vista: 'sprints' | 'backlog'): void {
    this.vistaBacklog.set(vista);
  }

  /** Formato de cada ticket dentro de un sprint o del Backlog: Lista (filas
   *  compactas, el default de siempre) o Tarjetas (mismo diseño .kanban-card
   *  que el Tablero Kanban) — a pedido del usuario, para poder elegir entre
   *  las dos formas de ver los tickets, igual que Tablero/Lista. */
  protected readonly formatoTicket = signal<'lista' | 'tarjeta'>('lista');
  cambiarFormatoTicket(formato: 'lista' | 'tarjeta'): void {
    this.formatoTicket.set(formato);
  }

  /** Recorta una lista de tickets a lo visible según la paginación de esa
   *  clave — evita repetir el .slice(...) en la vista de Lista y la de
   *  Tarjetas para la misma lista. */
  protected ticketsVisibles(lista: Ticket[], clave: string): Ticket[] {
    return lista.slice(0, this.cantidadVisible(clave));
  }

  protected readonly mostrarFormSprint = signal(false);
  protected readonly formSprint = this.fb.nonNullable.group({
    nombre: ['', Validators.required],
    objetivo: [''],
    fechaInicio: [''],
    fechaFin: [''],
  });

  ngOnInit(): void {
    // Deep link desde otra pantalla (igual que /proyectos/tablero?proyecto=).
    const proyectoIdParam = Number(this.route.snapshot.queryParamMap.get('proyecto')) || 0;

    this.data.list<ProyectoOpcion>('Proyecto').subscribe({
      next: (proyectos) => {
        this.proyectos.set(proyectos);
        if (!proyectos.length) return;
        const existe = proyectoIdParam && proyectos.some((p) => Number(p.id) === proyectoIdParam);
        this.proyectoSeleccionadoId.set(existe ? proyectoIdParam : proyectos[0].id);
        this.cargarProyecto();
      },
    });
    this.data.list<TicketPrioridad>('TicketPrioridad').subscribe((p) => this.prioridades.set(p));
    this.data.list<Usuario>('Usuario').subscribe((u) => this.usuarios.set(u));
    this.data.list<TicketTipo>('TicketTipo').subscribe((t) => this.tipos.set(t));
    this.data.list<TicketModulo>('TicketModulo').subscribe((m) => this.modulos.set(m));
  }

  cambiarProyecto(idTexto: string): void {
    this.proyectoSeleccionadoId.set(Number(idTexto));
    this.cargarProyecto();
  }

  private cargarProyecto(): void {
    const proyectoId = this.proyectoSeleccionadoId();
    if (!proyectoId) return;
    this.cargando.set(true);
    // Mismo criterio de "resuelto" que el tablero Kanban (última columna
    // configurada, ordenada por `orden`) — ver estaResuelto más abajo.
    this.data.list<TableroColumna>('TableroColumna', { proyectoId }).subscribe({
      next: (columnas) => {
        this.columnasTablero.set([...columnas].sort((a, b) => a.orden - b.orden));
        this.cargarSprintsYTickets();
      },
      error: () => this.cargando.set(false),
    });
  }

  /** Carga Sprint y Ticket JUNTOS (forkJoin) y recién entonces actualiza las
   *  señales — antes se pedían por separado y, si Ticket resolvía primero,
   *  el <select> "Mover a" se pintaba con SOLO la opción "Backlog" (todavía
   *  sin las <option> de los sprints, que llegaban después). Angular no
   *  vuelve a aplicar el binding [value] de un <select> si el valor de JS no
   *  cambió, así que aunque las opciones de sprint aparecieran un instante
   *  después, el navegador se quedaba mostrando "Backlog" como seleccionado
   *  aunque el ticket.sprintId real fuera otro — haciendo parecer que "Mover
   *  a Backlog" no hacía nada (el navegador ya lo consideraba seleccionado y
   *  no disparaba 'change' al hacer clic ahí). Cargando ambas listas a la
   *  vez, todas las <option> ya existen desde el primer render. */
  private cargarSprintsYTickets(): void {
    const proyectoId = this.proyectoSeleccionadoId();
    forkJoin({
      sprints: this.data.list<Sprint>('Sprint', { proyectoId }),
      tickets: this.data.list<Ticket>('Ticket', { proyectoId }),
    }).subscribe({
      next: ({ sprints, tickets }) => {
        this.sprints.set([...sprints].sort(this.compararSprints));
        this.tickets.set(tickets);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  /** Orden de los sprints de un proyecto: los que ya tienen 'orden' explícito (ver
   *  moverSprint más abajo) van primero, ordenados entre sí por ese valor; el resto
   *  (todavía no reordenado a mano) cae al final, ordenado por fecha de inicio como
   *  se hacía antes de que existiera este campo. No usa 'this', se puede pasar
   *  directo a Array.sort. */
  private compararSprints(a: Sprint, b: Sprint): number {
    const ordenA = a.orden ?? null;
    const ordenB = b.orden ?? null;
    if (ordenA !== null && ordenB !== null) return ordenA - ordenB;
    if (ordenA !== null) return -1;
    if (ordenB !== null) return 1;
    return (a.fechaInicio ?? '').localeCompare(b.fechaInicio ?? '');
  }

  protected estaResuelto(ticket: Ticket): boolean {
    const columnas = this.columnasTablero();
    return columnas.length > 0 && Number(ticket.tableroColumnaId) === Number(columnas[columnas.length - 1].id);
  }

  /** Nombre de la columna del Tablero (BACKLOG/ANÁLISIS/DESARROLLO/...) en la
   *  que está el ticket ahora mismo — se muestra en la tarjeta para dar ese
   *  mismo contexto de estado que ya se ve en el Tablero Kanban, ya que aquí
   *  los tickets no están agrupados por columna (sino por sprint/fecha). */
  protected nombreColumna(id: number): string {
    return this.columnasTablero().find((c) => Number(c.id) === Number(id))?.nombre ?? '—';
  }

  protected readonly ticketsBacklog = computed(() => this.tickets().filter((t) => !t.sprintId));

  /** Búsqueda de texto libre para el Backlog — con muchos tickets sin sprint la
   *  lista plana se vuelve difícil de manejar; mismo patrón (folio/folio interno/
   *  título, varios términos con coma) que el resto de buscadores del sistema. */
  protected readonly filtroBacklog = signal('');
  protected readonly ticketsBacklogFiltrados = computed(() => {
    const terminos = this.filtroBacklog()
      .toLowerCase()
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const base = this.ticketsBacklog().filter((t) => this.coincideFiltrosCatalogo(t));
    if (!terminos.length) return base;
    return base.filter((t) =>
      terminos.some(
        (termino) =>
          t.numeroTicket.toLowerCase().includes(termino) ||
          (t.folioInterno ?? '').toLowerCase().includes(termino) ||
          t.titulo.toLowerCase().includes(termino),
      ),
    );
  });

  /** Agrupa el Backlog por mes de creación (Ticket.fechaCreacion) — con muchos
   *  tickets sin sprint, una sola lista plana es difícil de manejar; agruparlos
   *  en bloques por fecha (más reciente primero) da anclas visuales para
   *  ubicarse, en vez de tener que hacer scroll por una lista gigante. Los
   *  tickets sin fechaCreacion (dato legado) caen en un bloque "Sin fecha" al
   *  final, no se pierden ni rompen el orden cronológico del resto. */
  protected readonly gruposBacklogPorFecha = computed(() => {
    const grupos = new Map<string, Ticket[]>();
    for (const t of this.ticketsBacklogFiltrados()) {
      const clave = t.fechaCreacion ? t.fechaCreacion.slice(0, 7) : 'sin-fecha';
      if (!grupos.has(clave)) grupos.set(clave, []);
      grupos.get(clave)!.push(t);
    }
    const claves = [...grupos.keys()].sort((a, b) => {
      if (a === 'sin-fecha') return 1;
      if (b === 'sin-fecha') return -1;
      return b.localeCompare(a);
    });
    return claves.map((clave, indice) => ({
      clave,
      etiqueta: this.etiquetaGrupoFecha(clave),
      tickets: grupos.get(clave)!,
      esPrimero: indice === 0,
    }));
  });

  private etiquetaGrupoFecha(clave: string): string {
    if (clave === 'sin-fecha') return 'Sin fecha';
    const [anioTexto, mesTexto] = clave.split('-');
    const meses = [
      'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
      'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
    ];
    const nombreMes = meses[Number(mesTexto) - 1];
    if (!nombreMes) return clave;
    return `${nombreMes.charAt(0).toUpperCase()}${nombreMes.slice(1)} ${anioTexto}`;
  }

  /** Solo el primer grupo (más reciente) empieza expandido — el resto arranca
   *  colapsado para no volver a caer en la "mega lista" de antes. null =
   *  modo automático (solo el primero abierto, como al cargar la pantalla);
   *  un Set = modo explícito, una vez que el usuario toca CUALQUIER control
   *  de expandir/colapsar (individual o "todos"), para que "Expandir todo"/
   *  "Colapsar todo" tengan un estado real que sobreescribir. */
  private readonly gruposAbiertosExplicito = signal<Set<string> | null>(null);
  protected grupoBacklogAbierto(clave: string, esPrimero: boolean): boolean {
    const explicito = this.gruposAbiertosExplicito();
    if (explicito) return explicito.has(clave);
    return esPrimero;
  }
  protected toggleGrupoBacklog(clave: string): void {
    this.gruposAbiertosExplicito.update((set) => {
      // Primera interacción manual: parte del estado automático actual
      // (solo el primer grupo) para no cerrar de golpe lo demás.
      const base = set ?? new Set(this.gruposBacklogPorFecha().filter((g) => g.esPrimero).map((g) => g.clave));
      const nuevo = new Set(base);
      if (nuevo.has(clave)) nuevo.delete(clave);
      else nuevo.add(clave);
      return nuevo;
    });
  }
  protected expandirTodosGrupos(): void {
    this.gruposAbiertosExplicito.set(new Set(this.gruposBacklogPorFecha().map((g) => g.clave)));
  }
  protected colapsarTodosGrupos(): void {
    this.gruposAbiertosExplicito.set(new Set());
  }
  protected irAGrupo(clave: string): void {
    // Asegura que el grupo destino quede abierto antes de saltar a él.
    this.gruposAbiertosExplicito.update((set) => {
      const base = set ?? new Set(this.gruposBacklogPorFecha().filter((g) => g.esPrimero).map((g) => g.clave));
      if (base.has(clave)) return base;
      return new Set([...base, clave]);
    });
    setTimeout(() => {
      document.getElementById(`backlog-grupo-${clave}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  protected ticketsDeSprint(sprintId: number): Ticket[] {
    return this.tickets().filter((t) => Number(t.sprintId) === Number(sprintId));
  }

  /** Misma lista pero con los filtros de catálogo aplicados — solo para lo que
   *  se MUESTRA en pantalla. completarSprint()/eliminarSprint() siguen usando
   *  ticketsDeSprint() sin filtrar: completar un sprint debe procesar TODOS sus
   *  tickets, no solo los que un filtro activo deja visibles en ese momento. */
  protected ticketsDeSprintFiltrados(sprintId: number): Ticket[] {
    return this.ticketsDeSprint(sprintId).filter((t) => this.coincideFiltrosCatalogo(t));
  }

  /** Paginación por grupo/sprint — cada lista (un sprint o un grupo de fecha
   *  del Backlog) se identifica con una "clave" propia ('sprint-' + id, o la
   *  clave del grupo de fecha) y arranca mostrando solo PAGINA_INICIAL
   *  tickets; "Ver más" suma otra tanda SOLO a esa clave, sin afectar las
   *  demás listas. */
  private static readonly PAGINA_INICIAL = 10;
  private readonly paginacion = signal<Map<string, number>>(new Map());
  protected cantidadVisible(clave: string): number {
    return this.paginacion().get(clave) ?? BacklogComponent.PAGINA_INICIAL;
  }
  protected verMas(clave: string): void {
    this.paginacion.update((mapa) => {
      const nuevo = new Map(mapa);
      nuevo.set(clave, this.cantidadVisible(clave) + BacklogComponent.PAGINA_INICIAL);
      return nuevo;
    });
  }

  protected readonly sprintsActivos = computed(() => this.sprints().filter((s) => s.estado === 'activo'));
  protected readonly sprintsPlaneados = computed(() => this.sprints().filter((s) => s.estado === 'planeado'));
  protected readonly sprintsCerrados = computed(() => this.sprints().filter((s) => s.estado === 'cerrado'));
  /** Activo(s) + planeados, en ese orden — los que se muestran arriba del
   *  Backlog (los cerrados van aparte, hasta abajo). */
  protected readonly sprintsAbiertos = computed(() => [...this.sprintsActivos(), ...this.sprintsPlaneados()]);

  /** Destinos ofrecidos en el <select> "Mover a" de cada ticket — Backlog (valor 0,
   *  ya está en el template) más cualquier sprint que todavía admite tickets
   *  (planeado o el activo); uno cerrado no se puede volver a usar. */
  protected readonly sprintsDestino = computed(() => this.sprints().filter((s) => s.estado !== 'cerrado'));

  /** Colapsar/expandir cada panel de sprint por separado — a pedido del
   *  usuario, cuando hay varios sprints abiertos a la vez conviene poder
   *  ocultar el detalle (lista de tickets) de los que no se están usando en
   *  ese momento, sin perder de vista el encabezado (nombre/fechas/acciones).
   *  Arrancan todos COLAPSADOS (pedido explícito del usuario); expandido es
   *  un estado explícito por sprint. Ojo: no llamar "sprintsAbiertos" — ese
   *  nombre ya lo usa el computed de arriba (activos + planeados). */
  private readonly sprintsExpandidos = signal<Set<number>>(new Set());
  protected sprintAbierto(sprintId: number): boolean {
    return this.sprintsExpandidos().has(sprintId);
  }
  protected toggleSprint(sprintId: number): void {
    this.sprintsExpandidos.update((set) => {
      const nuevo = new Set(set);
      if (nuevo.has(sprintId)) nuevo.delete(sprintId);
      else nuevo.add(sprintId);
      return nuevo;
    });
  }

  protected nombrePrioridad(id: number): string {
    return this.prioridades().find((p) => Number(p.id) === Number(id))?.nombre ?? '—';
  }

  protected nombreTipo(id: number | null): string {
    return this.tipos().find((t) => Number(t.id) === Number(id))?.nombre ?? '—';
  }
  protected iconoTipo(id: number | null): string {
    return this.tipos().find((t) => Number(t.id) === Number(id))?.icono ?? '';
  }
  protected nombreModulo(id: number | null): string {
    return this.modulos().find((m) => Number(m.id) === Number(id))?.nombre ?? '—';
  }
  protected iconoModulo(id: number | null): string {
    return this.modulos().find((m) => Number(m.id) === Number(id))?.icono ?? '';
  }
  protected colorPrioridad(id: number): string {
    return this.prioridades().find((p) => Number(p.id) === Number(id))?.codigoHex ?? '#999';
  }
  /** Par fondo+texto normalizado (ver avatar.util.ts) para pintar la prioridad como
   *  pill siempre legible, sin importar qué tan pálido u oscuro sea el color elegido. */
  protected fondoPrioridad(id: number): string {
    return colorBadgeFondo(this.colorPrioridad(id));
  }
  protected textoPrioridad(id: number): string {
    return colorBadgeTexto(this.colorPrioridad(id));
  }
  protected nombreUsuarioAsignado(id: number | null): string {
    if (!id) return 'Sin asignar';
    const usuario = this.usuarios().find((u) => Number(u.id) === Number(id));
    return usuario ? nombreCompletoUsuario(usuario) : '—';
  }

  /** Sprint que se está editando (null = el form crea uno nuevo) — el mismo
   *  form/panel de "Nuevo sprint" se reusa para editar, en vez de duplicar
   *  campos: ver editarSprint() y crearSprint(). */
  protected readonly sprintEditando = signal<Sprint | null>(null);

  toggleFormSprint(): void {
    this.mostrarFormSprint.update((v) => !v);
    this.sprintEditando.set(null);
    if (this.mostrarFormSprint()) {
      this.formSprint.reset({ nombre: '', objetivo: '', fechaInicio: '', fechaFin: '' });
    }
  }

  /** Abre el mismo panel de "Nuevo sprint", precargado con los datos de este
   *  sprint — a pedido del usuario, para poder corregir nombre/objetivo/fechas
   *  sin tener que eliminarlo y crearlo de nuevo (lo que además le haría perder
   *  sus tickets asignados y su historial). */
  editarSprint(sprint: Sprint): void {
    this.sprintEditando.set(sprint);
    this.formSprint.reset({
      nombre: sprint.nombre,
      objetivo: sprint.objetivo ?? '',
      fechaInicio: sprint.fechaInicio ?? '',
      fechaFin: sprint.fechaFin ?? '',
    });
    this.mostrarFormSprint.set(true);
  }

  crearSprint(): void {
    if (this.formSprint.invalid) {
      this.formSprint.markAllAsTouched();
      return;
    }
    const valor = this.formSprint.getRawValue();
    const editando = this.sprintEditando();
    const operacion = editando
      ? this.data.modificacion<Sprint>('Sprint', {
          ...editando,
          nombre: valor.nombre,
          objetivo: valor.objetivo || null,
          fechaInicio: valor.fechaInicio || null,
          fechaFin: valor.fechaFin || null,
        })
      : this.data.alta<Sprint>('Sprint', {
          proyectoId: this.proyectoSeleccionadoId(),
          nombre: valor.nombre,
          objetivo: valor.objetivo || null,
          fechaInicio: valor.fechaInicio || null,
          fechaFin: valor.fechaFin || null,
          estado: 'planeado',
        });
    operacion.subscribe({
      next: () => {
        this.toast.exito(editando ? 'Sprint actualizado.' : 'Sprint creado.');
        this.mostrarFormSprint.set(false);
        this.sprintEditando.set(null);
        this.cargarSprintsYTickets();
      },
      error: () => this.toast.error('No se pudo guardar el sprint. Intenta de nuevo.'),
    });
  }

  /** true si `sprint` es el primero/último entre los sprints PLANEADOS (para
   *  deshabilitar la flecha correspondiente) — el o los sprints 'activo' van
   *  siempre primero en sprintsAbiertos() y no participan de este reordenado
   *  manual, así que solo tiene sentido mover un planeado contra otro planeado. */
  protected esPrimerPlaneado(sprint: Sprint): boolean {
    return this.sprintsPlaneados()[0]?.id === sprint.id;
  }
  protected esUltimoPlaneado(sprint: Sprint): boolean {
    const lista = this.sprintsPlaneados();
    return lista.length > 0 && lista[lista.length - 1].id === sprint.id;
  }

  /** Reordena un sprint PLANEADO un lugar hacia arriba/abajo — a pedido del
   *  usuario, para poder priorizar manualmente qué sigue sin depender solo de
   *  la fecha de inicio (útil, por ejemplo, con sprints que todavía no tienen
   *  fechas definidas). Al mover, se fija un 'orden' explícito y consecutivo
   *  en TODOS los sprints planeados (no solo los dos que intercambian lugar),
   *  para que el resultado quede determinista la próxima vez que se cargue la
   *  pantalla (ver compararSprints). */
  protected moverSprint(sprint: Sprint, direccion: -1 | 1): void {
    const lista = [...this.sprintsPlaneados()];
    const indice = lista.findIndex((s) => Number(s.id) === Number(sprint.id));
    const destino = indice + direccion;
    if (indice === -1 || destino < 0 || destino >= lista.length) return;
    [lista[indice], lista[destino]] = [lista[destino], lista[indice]];
    const actualizaciones = lista.map((s, i) => this.data.modificacion<Sprint>('Sprint', { ...s, orden: i }));
    forkJoin(actualizaciones).subscribe({
      next: () => this.cargarSprintsYTickets(),
      error: () => this.toast.error('No se pudo reordenar el sprint. Intenta de nuevo.'),
    });
  }

  /** Solo puede haber un sprint 'activo' por proyecto a la vez — mismo límite
   *  real de Jira/Scrum (un tablero, un sprint en curso). */
  iniciarSprint(sprint: Sprint): void {
    const activo = this.sprintsActivos()[0];
    if (activo && Number(activo.id) !== Number(sprint.id)) {
      this.toast.advertencia(
        `Ya hay un sprint activo ("${activo.nombre}"). Complétalo antes de iniciar otro.`,
      );
      return;
    }
    this.data.modificacion<Sprint>('Sprint', { ...sprint, estado: 'activo' }).subscribe({
      next: () => {
        this.toast.exito(`Sprint "${sprint.nombre}" iniciado.`);
        this.cargarSprintsYTickets();
      },
    });
  }

  /** Deshace un "Completar sprint" hecho por error — lo regresa a 'activo' (mismo límite de
   *  "un solo sprint activo a la vez" que iniciarSprint). Los tickets NO resueltos que se
   *  liberaron solos al Backlog al cerrarlo (ver completarSprint) no vuelven automáticamente:
   *  no queda registro de cuáles eran, así que si hace falta se reasignan a mano con "Mover a". */
  reabrirSprint(sprint: Sprint): void {
    const activo = this.sprintsActivos()[0];
    if (activo && Number(activo.id) !== Number(sprint.id)) {
      this.toast.advertencia(
        `Ya hay un sprint activo ("${activo.nombre}"). Complétalo antes de reabrir "${sprint.nombre}".`,
      );
      return;
    }
    this.data.modificacion<Sprint>('Sprint', { ...sprint, estado: 'activo' }).subscribe({
      next: () => {
        this.toast.exito(
          `Sprint "${sprint.nombre}" reabierto. Los tickets que se liberaron al Backlog al cerrarlo no vuelven solos — muévelos de nuevo si hace falta.`,
        );
        this.cargarSprintsYTickets();
      },
    });
  }

  /** Al completar, los tickets NO resueltos regresan al Backlog (igual que
   *  "Complete sprint" en Jira); los ya resueltos se quedan con el sprint como
   *  registro histórico de qué se cerró en esta iteración. */
  completarSprint(sprint: Sprint): void {
    const pendientes = this.ticketsDeSprint(sprint.id).filter((t) => !this.estaResuelto(t));
    const liberar$: Observable<unknown> = pendientes.length
      ? forkJoin(pendientes.map((t) => this.data.modificacion<Ticket>('Ticket', { ...t, sprintId: null })))
      : of(null);

    liberar$.subscribe({
      next: () => {
        this.data.modificacion<Sprint>('Sprint', { ...sprint, estado: 'cerrado' }).subscribe({
          next: () => {
            this.toast.exito(
              pendientes.length
                ? `Sprint completado. ${pendientes.length} ticket(s) sin resolver regresaron al Backlog.`
                : 'Sprint completado.',
            );
            this.cargarSprintsYTickets();
          },
        });
      },
    });
  }

  /** Se puede eliminar un sprint en cualquier estado (planeado, activo o cerrado) — sus
   *  tickets siempre regresan primero al Backlog (sprintId = null), nunca se borran junto
   *  con el sprint. Pide confirmación (ver sprintAEliminar/confirmarEliminarSprint) porque
   *  borrar un sprint cerrado sí pierde el registro histórico de qué se cerró en esa
   *  iteración — a diferencia de completarSprint(), que lo conserva a propósito. */
  protected readonly sprintAEliminar = signal<Sprint | null>(null);

  pedirEliminarSprint(sprint: Sprint): void {
    this.sprintAEliminar.set(sprint);
  }

  confirmarEliminarSprint(): void {
    const sprint = this.sprintAEliminar();
    if (!sprint) return;

    const ticketsDelSprint = this.ticketsDeSprint(sprint.id);
    const liberar$: Observable<unknown> = ticketsDelSprint.length
      ? forkJoin(ticketsDelSprint.map((t) => this.data.modificacion<Ticket>('Ticket', { ...t, sprintId: null })))
      : of(null);

    liberar$.subscribe({
      next: () => {
        this.data.baja('Sprint', sprint.id).subscribe({
          next: () => {
            this.toast.exito(
              ticketsDelSprint.length
                ? `Sprint eliminado. ${ticketsDelSprint.length} ticket(s) regresaron al Backlog.`
                : 'Sprint eliminado.',
            );
            this.sprintAEliminar.set(null);
            this.cargarSprintsYTickets();
          },
        });
      },
    });
  }

  /** Antes esta llamada no tenía manejo de error: si data.modificacion() fallaba
   *  (p.ej. un problema de IndexedDB), el <select> se quedaba en el valor recién
   *  elegido por el navegador pero el ticket JAMÁS se movía — sin ningún aviso,
   *  se veía igual que "no deja mandarlo". Ahora siempre hay una confirmación
   *  visible (éxito o error), para que un fallo real deje de ser silencioso. */
  moverTicketASprint(ticket: Ticket, sprintIdTexto: string): void {
    const sprintId = Number(sprintIdTexto) || null;
    if (Number(ticket.sprintId ?? 0) === Number(sprintId ?? 0)) return;
    const destino = sprintId
      ? (this.sprints().find((s) => Number(s.id) === sprintId)?.nombre ?? 'el sprint')
      : 'Backlog';
    this.data.modificacion<Ticket>('Ticket', { ...ticket, sprintId }).subscribe({
      next: () => {
        this.cargarSprintsYTickets();
        this.toast.exito(`Ticket movido a ${destino}.`);
      },
      error: () => this.toast.error('No se pudo mover el ticket. Intenta de nuevo.'),
    });
  }

  /** Opciones del <select> "Mover a" para UN ticket en particular: los sprints abiertos
   *  (sprintsDestino, destino válido) más, si el ticket ya está en un sprint CERRADO, ese
   *  mismo sprint agregado al final — así el <select> siempre tiene una opción que calza
   *  con su valor actual. Sin esto, un ticket que quedó en un sprint cerrado (ver
   *  completarSprint) mostraría el navegador seleccionando "Backlog" por defecto (al no
   *  existir su <option>), aunque el ticket siga asignado a ese sprint cerrado. */
  opcionesSprintPara(ticket: Ticket): Sprint[] {
    const destino = this.sprintsDestino();
    if (!ticket.sprintId) return destino;
    if (destino.some((s) => Number(s.id) === Number(ticket.sprintId))) return destino;
    const propio = this.sprints().find((s) => Number(s.id) === Number(ticket.sprintId));
    return propio ? [...destino, propio] : destino;
  }

  /** true si `sprintId` (0 = Backlog) es el sprint actual del ticket — marca [selected]
   *  en cada <option> del <select> "Mover a" de forma explícita. Antes solo se ponía
   *  [value] en el propio <select>, confiando en que el navegador seleccionara la
   *  <option> que coincidiera; pero esas <option> las genera un @for anidado, que en el
   *  primer render puede terminar de crear sus elementos DESPUÉS de que Angular ya
   *  aplicó [value] al <select> — como todavía no hay ninguna <option> con ese valor, el
   *  navegador cae de vuelta a la primera ("Backlog") y ahí se queda (Angular no vuelve
   *  a tocar [value] si ticket.sprintId no cambia). Resultado: el <select> se veía en
   *  "Backlog" aunque el ticket sí tuviera sprint, y click en "Backlog" no hacía nada
   *  porque para el navegador ese ya era el valor actual (no disparaba (change)).
   *  [selected] en cada <option>, en cambio, se aplica junto con la propia <option> al
   *  crearse, así que siempre queda bien marcada desde el primer render. */
  protected esOpcionSeleccionada(ticket: Ticket, sprintId: number): boolean {
    return Number(ticket.sprintId ?? 0) === Number(sprintId);
  }
}

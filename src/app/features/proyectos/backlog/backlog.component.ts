import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable, forkJoin, of } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { ToastService } from '../../../shared/services/toast.service';
import { colorAvatar } from '../kanban/avatar.util';
import { Ticket } from '../kanban/ticket.model';
import { ProyectoOpcion, TableroColumna } from '../tableros/tablero-columna.model';
import { TicketPrioridad } from '../ticket-prioridades/ticket-prioridad.model';
import { TicketTipo } from '../ticket-tipos/ticket-tipo.model';
import { TicketModulo } from '../ticket-modulos/ticket-modulo.model';
import { Usuario, nombreCompletoUsuario } from '../../seguridad/usuarios/usuario.model';
import { Sprint } from '../sprints/sprint.model';

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
  imports: [ReactiveFormsModule, RouterLink],
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

  private cargarSprintsYTickets(): void {
    const proyectoId = this.proyectoSeleccionadoId();
    this.data.list<Sprint>('Sprint', { proyectoId }).subscribe((sprints) =>
      this.sprints.set([...sprints].sort((a, b) => (a.fechaInicio ?? '').localeCompare(b.fechaInicio ?? ''))),
    );
    this.data.list<Ticket>('Ticket', { proyectoId }).subscribe({
      next: (tickets) => {
        this.tickets.set(tickets);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  protected estaResuelto(ticket: Ticket): boolean {
    const columnas = this.columnasTablero();
    return columnas.length > 0 && Number(ticket.tableroColumnaId) === Number(columnas[columnas.length - 1].id);
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
   *  Arrancan todos expandidos (mismo comportamiento que antes de este
   *  cambio); colapsado es un estado explícito por sprint. */
  private readonly sprintsColapsados = signal<Set<number>>(new Set());
  protected sprintAbierto(sprintId: number): boolean {
    return !this.sprintsColapsados().has(sprintId);
  }
  protected toggleSprint(sprintId: number): void {
    this.sprintsColapsados.update((set) => {
      const nuevo = new Set(set);
      if (nuevo.has(sprintId)) nuevo.delete(sprintId);
      else nuevo.add(sprintId);
      return nuevo;
    });
  }

  protected nombrePrioridad(id: number): string {
    return this.prioridades().find((p) => Number(p.id) === Number(id))?.nombre ?? '—';
  }
  protected colorPrioridad(id: number): string {
    return this.prioridades().find((p) => Number(p.id) === Number(id))?.codigoHex ?? '#999';
  }
  protected nombreUsuarioAsignado(id: number | null): string {
    if (!id) return 'Sin asignar';
    const usuario = this.usuarios().find((u) => Number(u.id) === Number(id));
    return usuario ? nombreCompletoUsuario(usuario) : '—';
  }

  toggleFormSprint(): void {
    this.mostrarFormSprint.update((v) => !v);
    if (this.mostrarFormSprint()) {
      this.formSprint.reset({ nombre: '', objetivo: '', fechaInicio: '', fechaFin: '' });
    }
  }

  crearSprint(): void {
    if (this.formSprint.invalid) {
      this.formSprint.markAllAsTouched();
      return;
    }
    const valor = this.formSprint.getRawValue();
    this.data
      .alta<Sprint>('Sprint', {
        proyectoId: this.proyectoSeleccionadoId(),
        nombre: valor.nombre,
        objetivo: valor.objetivo || null,
        fechaInicio: valor.fechaInicio || null,
        fechaFin: valor.fechaFin || null,
        estado: 'planeado',
      })
      .subscribe({
        next: () => {
          this.toast.exito('Sprint creado.');
          this.mostrarFormSprint.set(false);
          this.cargarSprintsYTickets();
        },
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

  /** Solo se puede eliminar un sprint que todavía no se ha iniciado — uno activo
   *  o cerrado se completa, no se borra (para no perder el registro histórico). */
  eliminarSprint(sprint: Sprint): void {
    if (sprint.estado !== 'planeado') {
      this.toast.advertencia('Solo se puede eliminar un sprint que todavía no se ha iniciado.');
      return;
    }
    const ticketsDelSprint = this.ticketsDeSprint(sprint.id);
    const liberar$: Observable<unknown> = ticketsDelSprint.length
      ? forkJoin(ticketsDelSprint.map((t) => this.data.modificacion<Ticket>('Ticket', { ...t, sprintId: null })))
      : of(null);

    liberar$.subscribe({
      next: () => {
        this.data.baja('Sprint', sprint.id).subscribe({
          next: () => {
            this.toast.exito('Sprint eliminado.');
            this.cargarSprintsYTickets();
          },
        });
      },
    });
  }

  moverTicketASprint(ticket: Ticket, sprintIdTexto: string): void {
    const sprintId = Number(sprintIdTexto) || null;
    if (Number(ticket.sprintId ?? 0) === Number(sprintId ?? 0)) return;
    this.data.modificacion<Ticket>('Ticket', { ...ticket, sprintId }).subscribe({
      next: () => this.cargarSprintsYTickets(),
    });
  }
}

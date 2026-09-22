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

  protected readonly cargando = signal(false);
  protected readonly proyectos = signal<ProyectoOpcion[]>([]);
  protected readonly proyectoSeleccionadoId = signal<number>(0);
  protected readonly columnasTablero = signal<TableroColumna[]>([]);
  protected readonly tickets = signal<Ticket[]>([]);
  protected readonly sprints = signal<Sprint[]>([]);
  protected readonly prioridades = signal<TicketPrioridad[]>([]);
  protected readonly usuarios = signal<Usuario[]>([]);

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
    if (!terminos.length) return this.ticketsBacklog();
    return this.ticketsBacklog().filter((t) =>
      terminos.some(
        (termino) =>
          t.numeroTicket.toLowerCase().includes(termino) ||
          (t.folioInterno ?? '').toLowerCase().includes(termino) ||
          t.titulo.toLowerCase().includes(termino),
      ),
    );
  });
  protected ticketsDeSprint(sprintId: number): Ticket[] {
    return this.tickets().filter((t) => Number(t.sprintId) === Number(sprintId));
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

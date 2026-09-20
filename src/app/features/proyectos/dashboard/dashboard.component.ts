import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { DataClientService } from '../../../core/services/data-client.service';
import { exportarCsv } from '../../../shared/utils/csv.util';
import { Ticket, TicketSeguidor, UsuarioOpcion } from '../kanban/ticket.model';
import { TicketPrioridad } from '../ticket-prioridades/ticket-prioridad.model';
import { ProyectoOpcion, TableroColumna } from '../tableros/tablero-columna.model';

type ClaseSla = 'sla-ok' | 'sla-warning' | 'sla-expired';

interface TicketResumen {
  ticket: Ticket;
  proyectoClave: string;
  proyectoNombre: string;
  columnaNombre: string;
  prioridadNombre: string;
  prioridadColor: string;
  clase: ClaseSla | null;
  texto: string;
}

/**
 * "Mi Dashboard" (Gestión de Proyectos) — igual que en el prototipo original:
 * resumen de los tickets asignados a un usuario (por defecto, quien tiene la
 * sesión iniciada, pero se puede "ver" el de cualquier otro desde el selector
 * "Viendo tareas de"), en todos los proyectos. Se agrega "Tickets que sigo"
 * al final (TicketSeguidor no existía en el prototipo original en esta
 * pantalla, pero sin una vista así el seguimiento de tickets quedaría sin
 * forma de consultarse). Todo se calcula del lado del cliente a partir de
 * los GetList ya disponibles (Ticket, TicketSeguidor) — no requiere ningún
 * SP de agregación (ver esquema-tablas-saurix.md).
 */
@Component({
  selector: 'app-proyectos-dashboard',
  standalone: true,
  imports: [],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProyectosDashboardComponent implements OnInit {
  private readonly data = inject(DataClientService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly cargando = signal(false);
  protected readonly proyectos = signal<ProyectoOpcion[]>([]);
  protected readonly columnas = signal<TableroColumna[]>([]);
  protected readonly tickets = signal<Ticket[]>([]);
  protected readonly prioridades = signal<TicketPrioridad[]>([]);
  protected readonly usuarios = signal<UsuarioOpcion[]>([]);
  protected readonly seguidos = signal<TicketSeguidor[]>([]);

  /** A quién se le está viendo el dashboard — por defecto, quien tiene la sesión iniciada. */
  protected readonly usuarioViendoId = signal<number>(this.auth.usuarioActual()?.id ?? 0);

  private get usuarioActualId(): number {
    return this.auth.usuarioActual()?.id ?? 0;
  }

  ngOnInit(): void {
    this.cargando.set(true);
    this.data.list<ProyectoOpcion>('Proyecto').subscribe((p) => this.proyectos.set(p));
    this.data.list<TableroColumna>('TableroColumna').subscribe((c) => this.columnas.set(c));
    this.data.list<TicketPrioridad>('TicketPrioridad').subscribe((p) => this.prioridades.set(p));
    this.data.list<UsuarioOpcion>('Usuario').subscribe((u) => this.usuarios.set(u));
    this.data.list<Ticket>('Ticket').subscribe({
      next: (tickets) => {
        this.tickets.set(tickets);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
    this.data
      .list<TicketSeguidor>('TicketSeguidor', { usuarioId: this.usuarioActualId })
      .subscribe((seguidos) => this.seguidos.set(seguidos));
  }

  cambiarUsuarioViendo(id: string | number): void {
    this.usuarioViendoId.set(Number(id));
  }

  nombreUsuario(id: number): string {
    return this.usuarios().find((u) => Number(u.id) === Number(id))?.nombreCompleto ?? '—';
  }

  esUsuarioActual(id: number): boolean {
    return Number(id) === this.usuarioActualId;
  }

  /** Abre el ticket directo en el tablero Kanban de su proyecto (mismo comportamiento que el prototipo). */
  abrirTicket(ticket: Ticket): void {
    this.router.navigate(['/proyectos/tablero'], { queryParams: { ticket: ticket.id } });
  }

  protected readonly viendoAMi = computed(() => this.usuarioViendoId() === this.usuarioActualId);

  /** Última columna (por orden) del tablero de cada proyecto — se considera "resuelto" al llegar ahí. */
  private readonly ultimaColumnaPorProyecto = computed(() => {
    const porProyecto = new Map<number, TableroColumna[]>();
    for (const c of this.columnas()) {
      const id = Number(c.proyectoId);
      const arr = porProyecto.get(id) ?? [];
      arr.push(c);
      porProyecto.set(id, arr);
    }
    const mapa = new Map<number, number>();
    for (const [proyectoId, cols] of porProyecto) {
      const ordenadas = [...cols].sort((a, b) => a.orden - b.orden);
      const ultima = ordenadas[ordenadas.length - 1];
      if (ultima) mapa.set(proyectoId, Number(ultima.id));
    }
    return mapa;
  });

  private estaResuelto(ticket: Ticket): boolean {
    return this.ultimaColumnaPorProyecto().get(Number(ticket.proyectoId)) === Number(ticket.tableroColumnaId);
  }

  private slaDe(ticket: Ticket): { clase: ClaseSla | null; texto: string } {
    const prioridad = this.prioridades().find((p) => Number(p.id) === Number(ticket.ticketPrioridadId));
    if (!prioridad?.vigenciaHoras || !ticket.fechaCreacion || this.estaResuelto(ticket)) {
      return { clase: null, texto: '' };
    }
    const creado = new Date(ticket.fechaCreacion).getTime();
    const deadline = creado + prioridad.vigenciaHoras * 3600000;
    const warnAt = deadline - (prioridad.avisoHoras || 0) * 3600000;
    const ahora = Date.now();
    if (ahora >= deadline) return { clase: 'sla-expired', texto: '🔥 Vencido' };
    if (ahora >= warnAt) return { clase: 'sla-warning', texto: '⏰ Por vencer' };
    const totalMin = Math.round((deadline - ahora) / 60000);
    const texto = totalMin < 60 ? `🕐 faltan ${totalMin}min` : `🕐 faltan ${Math.round(totalMin / 60)}h`;
    return { clase: 'sla-ok', texto };
  }

  private aResumen(ticket: Ticket): TicketResumen {
    const proyecto = this.proyectos().find((p) => Number(p.id) === Number(ticket.proyectoId));
    const columna = this.columnas().find((c) => Number(c.id) === Number(ticket.tableroColumnaId));
    const prioridad = this.prioridades().find((p) => Number(p.id) === Number(ticket.ticketPrioridadId));
    const sla = this.slaDe(ticket);
    return {
      ticket,
      proyectoClave: proyecto?.clave ?? '—',
      proyectoNombre: proyecto?.nombre ?? '—',
      columnaNombre: columna?.nombre ?? '—',
      prioridadNombre: prioridad?.nombre ?? '—',
      prioridadColor: prioridad?.codigoHex ?? '#999',
      clase: sla.clase,
      texto: sla.texto,
    };
  }

  /** Todos los tickets asignados a la persona que se está viendo (resueltos y pendientes). */
  protected readonly ticketsDeUsuarioViendo = computed(() =>
    this.tickets()
      .filter((t) => Number(t.asignadoUsuarioId) === this.usuarioViendoId())
      .map((t) => this.aResumen(t)),
  );

  protected readonly pendientes = computed(() => this.ticketsDeUsuarioViendo().filter((r) => !this.estaResuelto(r.ticket)));
  protected readonly resueltos = computed(() => this.ticketsDeUsuarioViendo().filter((r) => this.estaResuelto(r.ticket)));
  protected readonly porVencer = computed(() => this.ticketsDeUsuarioViendo().filter((r) => r.clase === 'sla-warning'));
  protected readonly vencidos = computed(() => this.ticketsDeUsuarioViendo().filter((r) => r.clase === 'sla-expired'));

  private readonly pesoSla: Record<'sla-expired' | 'sla-warning' | 'sla-ok' | 'sin-sla', number> = {
    'sla-expired': 0,
    'sla-warning': 1,
    'sla-ok': 2,
    'sin-sla': 3,
  };

  /** Pendientes ordenados: primero lo más urgente (SLA), luego lo más reciente — igual que el prototipo. */
  protected readonly pendientesOrdenados = computed(() =>
    [...this.pendientes()].sort(
      (a, b) =>
        this.pesoSla[a.clase ?? 'sin-sla'] - this.pesoSla[b.clase ?? 'sin-sla'] ||
        (b.ticket.fechaCreacion ?? '').localeCompare(a.ticket.fechaCreacion ?? ''),
    ),
  );

  /** Resueltos: solo los 8 más recientes, igual que el prototipo. */
  protected readonly resueltosMostrados = computed(() =>
    [...this.resueltos()]
      .sort((a, b) => (b.ticket.fechaCreacion ?? '').localeCompare(a.ticket.fechaCreacion ?? ''))
      .slice(0, 8),
  );

  exportarPendientesCsv(): void {
    const nombre = this.nombreUsuario(this.usuarioViendoId());
    const filas = this.pendientesOrdenados().map((r) => ({
      folio: r.ticket.numeroTicket,
      titulo: r.ticket.titulo,
      proyecto: `${r.proyectoClave} — ${r.proyectoNombre}`,
      estado: r.columnaNombre,
      prioridad: r.prioridadNombre,
    }));

    exportarCsv(
      `tareas-${nombre}.csv`,
      [
        { clave: 'folio', etiqueta: 'Folio' },
        { clave: 'titulo', etiqueta: 'Título' },
        { clave: 'proyecto', etiqueta: 'Proyecto' },
        { clave: 'estado', etiqueta: 'Estado' },
        { clave: 'prioridad', etiqueta: 'Prioridad' },
      ],
      filas,
    );
  }

  protected readonly ticketsQueSigo = computed(() => {
    const idsSeguidos = new Set(this.seguidos().map((s) => Number(s.ticketId)));
    return this.tickets()
      .filter((t) => idsSeguidos.has(Number(t.id)))
      .map((t) => this.aResumen(t));
  });
}

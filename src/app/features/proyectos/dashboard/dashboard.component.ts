import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { AuthService } from '../../../core/services/auth.service';
import { DataClientService } from '../../../core/services/data-client.service';
import { colorAvatar, iniciales } from '../kanban/avatar.util';
import { Ticket, TicketActividad, TicketSeguidor } from '../kanban/ticket.model';
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
 * "Mi Dashboard" (Gestión de Proyectos) — resumen personal del usuario en
 * sesión: tickets asignados a mí (con su vigencia/SLA), tickets que sigo y
 * horas registradas por mí en la última semana. Igual que el resto de
 * pantallas de "Reportes"/dashboards del sistema, todo se calcula del lado
 * del cliente a partir de los GetList ya disponibles (Ticket, TicketActividad,
 * TicketSeguidor) — no requiere ningún SP de agregación (ver esquema-tablas-saurix.md).
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

  protected readonly iniciales = iniciales;
  protected readonly colorAvatar = colorAvatar;

  protected readonly cargando = signal(false);
  protected readonly proyectos = signal<ProyectoOpcion[]>([]);
  protected readonly columnas = signal<TableroColumna[]>([]);
  protected readonly tickets = signal<Ticket[]>([]);
  protected readonly prioridades = signal<TicketPrioridad[]>([]);
  protected readonly actividades = signal<TicketActividad[]>([]);
  protected readonly seguidos = signal<TicketSeguidor[]>([]);

  private get usuarioActualId(): number {
    return this.auth.usuarioActual()?.id ?? 0;
  }

  ngOnInit(): void {
    this.cargando.set(true);
    this.data.list<ProyectoOpcion>('Proyecto').subscribe((p) => this.proyectos.set(p));
    this.data.list<TableroColumna>('TableroColumna').subscribe((c) => this.columnas.set(c));
    this.data.list<TicketPrioridad>('TicketPrioridad').subscribe((p) => this.prioridades.set(p));
    this.data.list<Ticket>('Ticket').subscribe({
      next: (tickets) => {
        this.tickets.set(tickets);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
    this.data
      .list<TicketActividad>('TicketActividad', { creadoPor: this.usuarioActualId })
      .subscribe((actividades) => this.actividades.set(actividades));
    this.data
      .list<TicketSeguidor>('TicketSeguidor', { usuarioId: this.usuarioActualId })
      .subscribe((seguidos) => this.seguidos.set(seguidos));
  }

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

  private readonly pesoSla: Record<'sla-expired' | 'sla-warning' | 'sla-ok' | 'sin-sla', number> = {
    'sla-expired': 0,
    'sla-warning': 1,
    'sla-ok': 2,
    'sin-sla': 3,
  };

  protected readonly misTickets = computed(() =>
    this.tickets()
      .filter((t) => Number(t.asignadoUsuarioId) === this.usuarioActualId)
      .map((t) => this.aResumen(t))
      .sort((a, b) => this.pesoSla[a.clase ?? 'sin-sla'] - this.pesoSla[b.clase ?? 'sin-sla']),
  );

  protected readonly misTicketsActivos = computed(() => this.misTickets().filter((r) => !this.estaResuelto(r.ticket)));
  protected readonly ticketsVencidos = computed(() => this.misTickets().filter((r) => r.clase === 'sla-expired'));
  protected readonly ticketsPorVencer = computed(() => this.misTickets().filter((r) => r.clase === 'sla-warning'));

  protected readonly horasSemana = computed(() => {
    const hace7dias = Date.now() - 7 * 24 * 3600000;
    const minutos = this.actividades()
      .filter((a) => !a.fechaCreacion || new Date(a.fechaCreacion).getTime() >= hace7dias)
      .reduce((s, a) => s + a.tiempoMin, 0);
    return Math.round((minutos / 60) * 10) / 10;
  });

  protected readonly ticketsQueSigo = computed(() => {
    const idsSeguidos = new Set(this.seguidos().map((s) => Number(s.ticketId)));
    return this.tickets()
      .filter((t) => idsSeguidos.has(Number(t.id)))
      .map((t) => this.aResumen(t));
  });
}

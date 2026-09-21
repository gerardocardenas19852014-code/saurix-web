import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DataClientService } from '../../../core/services/data-client.service';
import { exportarCsv } from '../../../shared/utils/csv.util';
import { Usuario, nombreCompletoUsuario } from '../../seguridad/usuarios/usuario.model';
import { colorAvatar } from '../kanban/avatar.util';
import { Ticket, TicketActividad } from '../kanban/ticket.model';
import { ProyectoOpcion } from '../tableros/tablero-columna.model';
import { TicketModulo } from '../ticket-modulos/ticket-modulo.model';

type PeriodoId = 'todo' | 'mes-actual' | 'mes-anterior' | 'anio-actual' | 'anio-anterior';

interface RangoFecha {
  inicio: Date;
  fin: Date;
}

interface HorasAgrupadas {
  id: number;
  nombre: string;
  subtitulo?: string;
  minutos: number;
  horas: number;
  pct: number;
  color: string;
}

/**
 * "Reportes de horas" (Gestión de Proyectos) — agrega TicketActividad (la
 * bitácora de tiempo trabajado) por usuario, por proyecto y por ticket.
 * Igual que el resto de pantallas de "Reportes" del sistema, toda la
 * suma/agrupación se hace en el cliente sobre los GetList ya disponibles
 * (GetListTicketActividad admite traer todas las actividades sin filtrar
 * por ticket) — no requiere ningún SP de agregación.
 */
@Component({
  selector: 'app-reportes-horas',
  standalone: true,
  imports: [],
  templateUrl: './reportes-horas.component.html',
  styleUrl: './reportes-horas.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportesHorasComponent implements OnInit {
  private readonly data = inject(DataClientService);

  protected readonly colorAvatar = colorAvatar;

  protected readonly cargando = signal(false);
  protected readonly proyectos = signal<ProyectoOpcion[]>([]);
  protected readonly tickets = signal<Ticket[]>([]);
  protected readonly actividades = signal<TicketActividad[]>([]);
  protected readonly usuarios = signal<Usuario[]>([]);
  protected readonly modulos = signal<TicketModulo[]>([]);

  protected readonly filtroProyectoId = signal<number>(0);
  protected readonly filtroModuloId = signal<number>(0);
  protected readonly periodo = signal<PeriodoId>('mes-actual');
  /** Rango de fechas manual — siempre visible en el filtro (formato yyyy-mm-dd,
   *  input type=date). En cuanto se llena Desde y/o Hasta, manda sobre el
   *  preset de "Periodo" (que sigue disponible como atajo rápido). */
  protected readonly rangoDesde = signal<string>('');
  protected readonly rangoHasta = signal<string>('');
  protected readonly hayRangoManual = computed(() => !!(this.rangoDesde() || this.rangoHasta()));

  ngOnInit(): void {
    this.cargando.set(true);
    this.data.list<ProyectoOpcion>('Proyecto').subscribe((p) => this.proyectos.set(p));
    this.data.list<TicketModulo>('TicketModulo').subscribe((m) => this.modulos.set(m));
    this.data.list<Usuario>('Usuario').subscribe((u) => this.usuarios.set(u));
    this.data.list<Ticket>('Ticket').subscribe((t) => this.tickets.set(t));
    this.data.list<TicketActividad>('TicketActividad').subscribe({
      next: (actividades) => {
        this.actividades.set(actividades);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  private rangoDe(id: PeriodoId): RangoFecha | null {
    if (id === 'todo') return null;
    const hoy = new Date();
    if (id === 'mes-actual' || id === 'mes-anterior') {
      const offset = id === 'mes-actual' ? 0 : -1;
      const base = new Date(hoy.getFullYear(), hoy.getMonth() + offset, 1);
      return {
        inicio: new Date(base.getFullYear(), base.getMonth(), 1),
        fin: new Date(base.getFullYear(), base.getMonth() + 1, 0, 23, 59, 59),
      };
    }
    const anio = hoy.getFullYear() + (id === 'anio-actual' ? 0 : -1);
    return { inicio: new Date(anio, 0, 1), fin: new Date(anio, 11, 31, 23, 59, 59) };
  }

  /** Rango efectivo a aplicar: si hay un rango manual (Desde/Hasta) capturado,
   *  ese manda; si no, se usa el preset de "Periodo" como antes. */
  private readonly rangoManual = computed<RangoFecha | null>(() => {
    const desde = this.rangoDesde();
    const hasta = this.rangoHasta();
    if (!desde && !hasta) return null;
    const inicio = desde ? new Date(`${desde}T00:00:00`) : new Date(0);
    const fin = hasta ? new Date(`${hasta}T23:59:59`) : new Date(8640000000000000);
    return { inicio, fin };
  });

  protected readonly rangoActivo = computed<RangoFecha | null>(
    () => this.rangoManual() ?? this.rangoDe(this.periodo()),
  );

  limpiarRangoManual(): void {
    this.rangoDesde.set('');
    this.rangoHasta.set('');
  }

  protected readonly etiquetaPeriodo = computed(() => {
    const desde = this.rangoDesde();
    const hasta = this.rangoHasta();
    if (desde || hasta) return `del ${desde || '…'} al ${hasta || '…'}`;
    switch (this.periodo()) {
      case 'todo':
        return 'todo el historial';
      case 'mes-actual':
        return 'este mes';
      case 'mes-anterior':
        return 'el mes anterior';
      case 'anio-actual':
        return 'este año';
      case 'anio-anterior':
        return 'el año anterior';
    }
  });

  private ticketDe(id: number): Ticket | undefined {
    return this.tickets().find((t) => Number(t.id) === Number(id));
  }

  /** Actividades que caen dentro del periodo elegido y, si aplica, del proyecto filtrado. */
  protected readonly actividadesFiltradas = computed(() => {
    const rango = this.rangoActivo();
    const proyectoId = this.filtroProyectoId();
    const moduloId = this.filtroModuloId();
    return this.actividades().filter((a) => {
      if (rango) {
        if (!a.fechaCreacion) return false;
        const f = new Date(a.fechaCreacion);
        if (f < rango.inicio || f > rango.fin) return false;
      }
      if (proyectoId) {
        const ticket = this.ticketDe(a.ticketId);
        if (!ticket || Number(ticket.proyectoId) !== proyectoId) return false;
      }
      if (moduloId) {
        const ticket = this.ticketDe(a.ticketId);
        // moduloId === -1 es el centinela de "Sin módulo" (mismo criterio que en
        // Kanban/Dashboard); cualquier otro valor filtra por ese módulo.
        if (!ticket) return false;
        if (moduloId === -1 ? !!ticket.ticketModuloId : Number(ticket.ticketModuloId) !== moduloId) return false;
      }
      return true;
    });
  });

  protected readonly totalMinutos = computed(() => this.actividadesFiltradas().reduce((s, a) => s + a.tiempoMin, 0));
  protected readonly totalHoras = computed(() => Math.round((this.totalMinutos() / 60) * 10) / 10);

  private agrupar(claves: (a: TicketActividad) => number | null, resolver: (id: number) => { nombre: string; subtitulo?: string }): HorasAgrupadas[] {
    const porClave = new Map<number, number>();
    for (const a of this.actividadesFiltradas()) {
      const clave = claves(a);
      if (clave === null) continue;
      porClave.set(clave, (porClave.get(clave) ?? 0) + a.tiempoMin);
    }
    const totalMin = this.totalMinutos();
    const filas = [...porClave.entries()].map(([id, minutos]) => {
      const info = resolver(id);
      return {
        id,
        nombre: info.nombre,
        subtitulo: info.subtitulo,
        minutos,
        horas: Math.round((minutos / 60) * 10) / 10,
        pct: totalMin > 0 ? (minutos / totalMin) * 100 : 0,
        color: colorAvatar(info.nombre),
      };
    });
    return filas.sort((a, b) => b.minutos - a.minutos);
  }

  protected readonly horasPorUsuario = computed(() =>
    this.agrupar(
      (a) => (a.creadoPor ? Number(a.creadoPor) : null),
      (id) => {
        const usuario = this.usuarios().find((u) => Number(u.id) === id);
        return { nombre: usuario ? nombreCompletoUsuario(usuario) : 'Sin usuario' };
      },
    ),
  );

  protected readonly horasPorProyecto = computed(() =>
    this.agrupar(
      (a) => {
        const ticket = this.ticketDe(a.ticketId);
        return ticket ? Number(ticket.proyectoId) : null;
      },
      (id) => {
        const proyecto = this.proyectos().find((p) => Number(p.id) === id);
        return { nombre: proyecto ? `${proyecto.clave} — ${proyecto.nombre}` : '—' };
      },
    ),
  );

  protected readonly horasPorModulo = computed(() =>
    this.agrupar(
      (a) => {
        const ticket = this.ticketDe(a.ticketId);
        if (!ticket) return null;
        return ticket.ticketModuloId ? Number(ticket.ticketModuloId) : 0;
      },
      (id) => {
        if (id === 0) return { nombre: 'Sin módulo' };
        const modulo = this.modulos().find((m) => Number(m.id) === id);
        return { nombre: modulo ? `${modulo.icono} ${modulo.nombre}`.trim() : '—' };
      },
    ),
  );

  /** Top 10 tickets con más horas registradas en el periodo/proyecto filtrado. */
  protected readonly horasPorTicket = computed(() =>
    this.agrupar(
      (a) => Number(a.ticketId),
      (id) => {
        const ticket = this.ticketDe(id);
        return { nombre: ticket ? `#${ticket.numeroTicket} — ${ticket.titulo}` : 'Ticket eliminado' };
      },
    ).slice(0, 10),
  );

  protected readonly maxUsuario = computed(() => Math.max(1, ...this.horasPorUsuario().map((f) => f.minutos)));
  protected readonly maxProyecto = computed(() => Math.max(1, ...this.horasPorProyecto().map((f) => f.minutos)));
  protected readonly maxModulo = computed(() => Math.max(1, ...this.horasPorModulo().map((f) => f.minutos)));
  protected readonly maxTicket = computed(() => Math.max(1, ...this.horasPorTicket().map((f) => f.minutos)));

  private nombreUsuarioDe(id: number | null): string {
    if (!id) return 'Sin usuario';
    const usuario = this.usuarios().find((u) => Number(u.id) === Number(id));
    return usuario ? nombreCompletoUsuario(usuario) : 'Sin usuario';
  }

  /** Exporta el detalle (no solo los agrupados) de las actividades del periodo/proyecto
   *  filtrado — mismo patrón que el CSV de Kanban/Dashboard, vía shared/utils/csv.util. */
  exportarActividadesCsv(): void {
    const filas = this.actividadesFiltradas().map((a) => {
      const ticket = this.ticketDe(a.ticketId);
      return {
        fecha: a.fechaCreacion ? new Date(a.fechaCreacion).toLocaleString('es-MX') : '',
        folio: ticket ? `#${ticket.numeroTicket}` : '—',
        ticket: ticket ? ticket.titulo : 'Ticket eliminado',
        usuario: this.nombreUsuarioDe(a.creadoPor),
        // Igual que en Kanban (formActividad/columnasActividades): se presenta en horas;
        // el dato real (TicketActividad.tiempoMin) sigue en minutos.
        horas: Math.round((a.tiempoMin / 60) * 100) / 100,
        descripcion: a.texto,
      };
    });

    exportarCsv(
      `horas-${this.periodo()}.csv`,
      [
        { clave: 'fecha', etiqueta: 'Fecha' },
        { clave: 'folio', etiqueta: 'Folio' },
        { clave: 'ticket', etiqueta: 'Ticket' },
        { clave: 'usuario', etiqueta: 'Usuario' },
        { clave: 'horas', etiqueta: 'Horas' },
        { clave: 'descripcion', etiqueta: 'Descripción' },
      ],
      filas,
    );
  }
}

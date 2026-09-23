import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DataClientService } from '../../../core/services/data-client.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { ColumnaCsv, exportarCsv } from '../../../shared/utils/csv.util';
import { colorBadgeFondo, colorBadgeTexto } from '../kanban/avatar.util';
import { Ticket, TicketHistorialEstado, UsuarioOpcion } from '../kanban/ticket.model';
import { Sprint } from '../sprints/sprint.model';
import { ProyectoOpcion, TableroColumna } from '../tableros/tablero-columna.model';
import { TicketPrioridad } from '../ticket-prioridades/ticket-prioridad.model';
import { Usuario, nombreCompletoUsuario } from '../../seguridad/usuarios/usuario.model';

type Pestana = 'hecho' | 'pendiente' | 'sprint' | 'velocidad' | 'cfd' | 'control';
type Metrica = 'tickets' | 'horas';
type OrdenSprint = 'nombre' | 'estado' | 'fecha' | 'tickets' | 'horas';

interface PuntoBarra {
  etiqueta: string;
  valor: number;
}

interface SegmentoColumna {
  columnaId: number;
  inicioMs: number;
  finMs: number;
}

interface PuntoControl {
  fecha: string;
  dias: number;
  folio: string;
  titulo: string;
}

interface SerieCfd {
  nombre: string;
  color: string;
  valores: number[];
}

const COLORES_SERIE = ['var(--indigo)', 'var(--amber)', 'var(--teal)', 'var(--danger)', 'var(--accent)', 'var(--client)', 'var(--technical)'];

/**
 * "Reportes ejecutivos" (Gestión de Proyectos → Reportes) — 6 gráficas pensadas
 * para nivel directivo, todo calculado del lado del cliente a partir de los
 * GetList ya disponibles (mismo criterio que Resumen Ejecutivo, sin requerir
 * ningún SP de agregación):
 *
 *  1. Trabajo hecho     — tickets resueltos por mes (conteo u horas estimadas).
 *  2. Trabajo pendiente — tickets pendientes por columna del tablero.
 *  3. Reporte de sprint — resumen de un sprint (completado vs. total).
 *  4. Velocidad         — trabajo completado por sprint cerrado (clásica de Scrum).
 *  5. Diagrama de flujo acumulado (CFD) — cuántos tickets había en cada etapa
 *     cada día, reconstruido a partir de TicketHistorialEstado (el log de
 *     cambios de columna que ya se genera en KanbanComponent.moverTicketAColumna).
 *     OJO: como ese historial solo tiene los movimientos hechos desde que existe
 *     ese campo, entre más reciente sea un proyecto/columna, más "plano" se verá
 *     el diagrama al principio — se va enriqueciendo solo con el uso diario.
 *  6. Gráfica de control — tiempo de ciclo (días de creación a resolución) de
 *     cada ticket resuelto, con promedio y percentil 85 — mismo TicketHistorialEstado.
 *
 * CFD y Control chart reconstruyen, para cada ticket, en qué columna estuvo y
 * durante qué rango de tiempo (segmentosDeTicket) encadenando TicketHistorialEstado
 * en orden; el primer tramo (antes del primer movimiento registrado) usa
 * Ticket.fechaCreacion como inicio.
 */
@Component({
  selector: 'app-reportes-ejecutivos',
  standalone: true,
  imports: [],
  templateUrl: './reportes-ejecutivos.component.html',
  styleUrl: './reportes-ejecutivos.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportesEjecutivosComponent implements OnInit {
  private readonly data = inject(DataClientService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);
  private readonly MS_POR_DIA = 86400000;

  protected readonly cargando = signal(false);
  protected readonly pestana = signal<Pestana>('hecho');
  protected readonly metrica = signal<Metrica>('tickets');
  /** 0 = "Todos los proyectos" — válido para Trabajo hecho/pendiente/Control;
   *  Sprint/Velocidad/CFD necesitan un proyecto concreto (columnas y sprints
   *  son propios de cada proyecto, no comparables entre sí). */
  protected readonly proyectoId = signal<number>(0);
  protected readonly sprintSeleccionadoId = signal<number>(0);
  protected readonly diasCfd = signal<number>(30);

  protected readonly proyectos = signal<ProyectoOpcion[]>([]);
  protected readonly columnas = signal<TableroColumna[]>([]);
  protected readonly tickets = signal<Ticket[]>([]);
  protected readonly sprints = signal<Sprint[]>([]);
  protected readonly historial = signal<TicketHistorialEstado[]>([]);
  protected readonly prioridades = signal<TicketPrioridad[]>([]);
  protected readonly usuarios = signal<UsuarioOpcion[]>([]);

  /** Orden de la tabla "Todos los sprints" — por defecto el más reciente primero
   *  (mismo orden que ya traía sprintsDelProyecto), pero cualquier columna se
   *  puede usar para ordenar (mismo patrón th-ordenable que Balanceo). */
  protected readonly ordenSprintPor = signal<OrdenSprint>('fecha');
  protected readonly ordenSprintDireccion = signal<'desc' | 'asc'>('desc');

  ngOnInit(): void {
    this.cargando.set(true);
    this.data.list<ProyectoOpcion>('Proyecto').subscribe((p) => this.proyectos.set(p));
    this.data.list<TableroColumna>('TableroColumna').subscribe((c) => this.columnas.set(c));
    this.data.list<Sprint>('Sprint').subscribe((s) => this.sprints.set(s));
    this.data.list<TicketHistorialEstado>('TicketHistorialEstado').subscribe((h) => this.historial.set(h));
    this.data.list<TicketPrioridad>('TicketPrioridad').subscribe((p) => this.prioridades.set(p));
    // 'Usuario' no trae un campo nombreCompleto propio — hay que armarlo con
    // nombreCompletoUsuario(), igual que en Mi Dashboard/Resumen ejecutivo/Kanban.
    this.data
      .list<Usuario>('Usuario')
      .subscribe((u) => this.usuarios.set(u.map((x) => ({ id: x.id, nombreCompleto: nombreCompletoUsuario(x) }))));
    this.data.list<Ticket>('Ticket').subscribe((t) => {
      this.tickets.set(t);
      this.cargando.set(false);
    });
  }

  protected ordenarSprintsPor(campo: OrdenSprint): void {
    if (this.ordenSprintPor() === campo) {
      this.ordenSprintDireccion.update((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      this.ordenSprintPor.set(campo);
      // Nombre/Estatus se leen mejor de A-Z por defecto; Fecha/Tickets/Horas, de
      // mayor a menor (lo más reciente o lo más avanzado primero).
      this.ordenSprintDireccion.set(campo === 'nombre' || campo === 'estado' ? 'asc' : 'desc');
    }
  }

  protected indicadorOrdenSprint(campo: OrdenSprint): string {
    if (this.ordenSprintPor() !== campo) return '';
    return this.ordenSprintDireccion() === 'desc' ? ' ▾' : ' ▴';
  }

  protected nombreUsuario(id: number | null): string {
    if (!id) return 'Sin asignar';
    return this.usuarios().find((u) => Number(u.id) === Number(id))?.nombreCompleto ?? '—';
  }

  protected nombrePrioridad(id: number): string {
    return this.prioridades().find((p) => Number(p.id) === Number(id))?.nombre ?? '—';
  }

  private colorPrioridad(id: number): string | undefined {
    return this.prioridades().find((p) => Number(p.id) === Number(id))?.codigoHex;
  }

  protected textoPrioridad(id: number): string {
    return colorBadgeTexto(this.colorPrioridad(id));
  }

  protected fondoPrioridad(id: number): string {
    return colorBadgeFondo(this.colorPrioridad(id));
  }

  protected nombreColumna(id: number): string {
    return this.columnas().find((c) => Number(c.id) === Number(id))?.nombre ?? '—';
  }

  /** Recorta la lista de tickets del sprint a lo que la preferencia "Registros
   *  por página" (Panel de Control → Apariencia → Tablas y listados) diga mostrar
   *  — mismo servicio/convención que ya usan Usuarios y el resto de los listados
   *  del sistema (PreferenciasGridService). El CSV exporta siempre todos. */
  protected ticketsVisibles(tickets: Ticket[]): Ticket[] {
    return tickets.slice(0, this.preferenciasGrid.tamanoPagina());
  }

  protected exportarTicketsSprintCsv(sprint: Sprint, tickets: Ticket[]): void {
    const filas = tickets.map((t) => ({
      ...t,
      estadoTexto: this.nombreColumna(t.tableroColumnaId),
      prioridadTexto: this.nombrePrioridad(t.ticketPrioridadId),
      asignadoTexto: this.nombreUsuario(t.asignadoUsuarioId),
      horasTexto: this.horasDeTicket(t),
    }));

    const columnas: ColumnaCsv<(typeof filas)[number]>[] = [
      { clave: 'numeroTicket', etiqueta: 'Folio' },
      { clave: 'folioInterno', etiqueta: 'Folio interno' },
      { clave: 'titulo', etiqueta: 'Título' },
      { clave: 'estadoTexto', etiqueta: 'Estado' },
      { clave: 'prioridadTexto', etiqueta: 'Prioridad' },
      { clave: 'asignadoTexto', etiqueta: 'Asignado a' },
      { clave: 'horasTexto', etiqueta: 'Horas est.' },
    ];

    const nombreArchivo = `sprint-${sprint.nombre}-tickets.csv`.replace(/[^a-z0-9.\-]+/gi, '-');
    exportarCsv(nombreArchivo, columnas, filas);
  }

  protected cambiarPestana(p: Pestana): void {
    this.pestana.set(p);
  }

  protected cambiarMetrica(m: Metrica): void {
    this.metrica.set(m);
  }

  protected cambiarProyecto(idTexto: string): void {
    this.proyectoId.set(Number(idTexto) || 0);
    this.sprintSeleccionadoId.set(0);
  }

  protected cambiarSprintSeleccionado(idTexto: string): void {
    this.sprintSeleccionadoId.set(Number(idTexto) || 0);
  }

  protected cambiarDiasCfd(diasTexto: string): void {
    this.diasCfd.set(Math.max(7, Math.min(180, Number(diasTexto) || 30)));
  }

  protected nombreProyecto(id: number): string {
    return this.proyectos().find((p) => Number(p.id) === Number(id))?.nombre ?? '—';
  }

  // ---------------------------------------------------------------------
  // Helpers compartidos (mismo criterio que Resumen Ejecutivo/Mi Dashboard)
  // ---------------------------------------------------------------------

  private readonly ultimaColumnaPorProyecto = computed(() => {
    const porProyecto = new Map<number, TableroColumna[]>();
    for (const c of this.columnas()) {
      const arr = porProyecto.get(Number(c.proyectoId)) ?? [];
      arr.push(c);
      porProyecto.set(Number(c.proyectoId), arr);
    }
    const mapa = new Map<number, number>();
    for (const [proyectoId, cols] of porProyecto) {
      const ordenadas = [...cols].sort((a, b) => b.orden - a.orden);
      if (ordenadas[0]) mapa.set(proyectoId, Number(ordenadas[0].id));
    }
    return mapa;
  });

  protected estaResuelto(ticket: Ticket): boolean {
    return this.ultimaColumnaPorProyecto().get(Number(ticket.proyectoId)) === Number(ticket.tableroColumnaId);
  }

  private readonly historialPorTicket = computed(() => {
    const mapa = new Map<number, TicketHistorialEstado[]>();
    for (const h of this.historial()) {
      const arr = mapa.get(Number(h.ticketId)) ?? [];
      arr.push(h);
      mapa.set(Number(h.ticketId), arr);
    }
    for (const arr of mapa.values()) {
      arr.sort((a, b) => (a.fechaCreacion ?? '').localeCompare(b.fechaCreacion ?? ''));
    }
    return mapa;
  });

  /** Reconstruye, para un ticket, la lista de tramos {columna, desde, hasta} que
   *  ha recorrido — encadenando TicketHistorialEstado en orden. El primer tramo
   *  (antes del primer movimiento registrado, o si nunca se ha movido) empieza en
   *  Ticket.fechaCreacion. El último tramo llega hasta "ahora" (un ticket resuelto
   *  se queda contando en su columna final, no "desaparece" del diagrama). */
  private segmentosDeTicket(ticket: Ticket): SegmentoColumna[] {
    if (!ticket.fechaCreacion) return [];
    const entradas = this.historialPorTicket().get(Number(ticket.id)) ?? [];
    const segmentos: SegmentoColumna[] = [];
    let cursorMs = new Date(ticket.fechaCreacion).getTime();
    let columnaActual = entradas[0]
      ? Number(entradas[0].tableroColumnaAnteriorId ?? entradas[0].tableroColumnaNuevaId)
      : Number(ticket.tableroColumnaId);

    for (const entrada of entradas) {
      if (!entrada.fechaCreacion) continue;
      const finMs = new Date(entrada.fechaCreacion).getTime();
      if (finMs > cursorMs) segmentos.push({ columnaId: columnaActual, inicioMs: cursorMs, finMs });
      columnaActual = Number(entrada.tableroColumnaNuevaId);
      cursorMs = finMs;
    }
    segmentos.push({ columnaId: columnaActual, inicioMs: cursorMs, finMs: Date.now() });
    return segmentos;
  }

  private columnaEnMomento(segmentos: SegmentoColumna[], momentoMs: number): number | null {
    for (const seg of segmentos) {
      if (momentoMs >= seg.inicioMs && momentoMs <= seg.finMs) return seg.columnaId;
    }
    return null;
  }

  protected horasDeTicket(t: Ticket): number {
    return t.tiempoEstimadoMin ? t.tiempoEstimadoMin / 60 : 0;
  }

  /** Tickets del proyecto elegido, o todos si proyectoId() es 0 ("Todos los proyectos"). */
  private ticketsFiltrados(): Ticket[] {
    const id = this.proyectoId();
    const activos = this.tickets().filter((t) => t.activo !== false);
    return id ? activos.filter((t) => Number(t.proyectoId) === id) : activos;
  }

  private redondear(valor: number): number {
    return Math.round(valor * 10) / 10;
  }

  private ultimosMeses(n: number): { clave: string; etiqueta: string }[] {
    const resultado: { clave: string; etiqueta: string }[] = [];
    const ahora = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
      const clave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const etiqueta = d.toLocaleDateString('es-MX', { month: 'short', year: '2-digit' }).replace('.', '');
      resultado.push({ clave, etiqueta });
    }
    return resultado;
  }

  // ---------------------------------------------------------------------
  // 1. Trabajo hecho — tickets resueltos por mes, últimos 6 meses.
  // ---------------------------------------------------------------------

  /** Fecha en que un ticket llegó a su columna final: la entrada de historial más
   *  reciente hacia esa columna; si no hay historial (se creó ya resuelto, o el
   *  historial no alcanza a cubrir ese movimiento) usa fechaModificacion. */
  private fechaResolucion(ticket: Ticket): string | null {
    const entradas = (this.historialPorTicket().get(Number(ticket.id)) ?? []).filter(
      (h) => Number(h.tableroColumnaNuevaId) === Number(ticket.tableroColumnaId),
    );
    const ultima = entradas[entradas.length - 1];
    return ultima?.fechaCreacion ?? ticket.fechaModificacion ?? ticket.fechaCreacion ?? null;
  }

  protected readonly trabajoHecho = computed<PuntoBarra[]>(() => {
    const meses = this.ultimosMeses(6);
    const resueltos = this.ticketsFiltrados().filter((t) => this.estaResuelto(t));
    const porMes = new Map<string, number>();
    for (const t of resueltos) {
      const fecha = this.fechaResolucion(t);
      if (!fecha) continue;
      const clave = fecha.slice(0, 7);
      const valor = this.metrica() === 'horas' ? this.horasDeTicket(t) : 1;
      porMes.set(clave, (porMes.get(clave) ?? 0) + valor);
    }
    return meses.map((m) => ({ etiqueta: m.etiqueta, valor: this.redondear(porMes.get(m.clave) ?? 0) }));
  });

  protected readonly maxTrabajoHecho = computed(() => Math.max(1, ...this.trabajoHecho().map((p) => p.valor)));
  protected readonly totalTrabajoHecho = computed(() => this.redondear(this.trabajoHecho().reduce((s, p) => s + p.valor, 0)));

  // ---------------------------------------------------------------------
  // 2. Trabajo pendiente — tickets pendientes por columna del tablero.
  // ---------------------------------------------------------------------

  protected readonly trabajoPendiente = computed<PuntoBarra[]>(() => {
    const proyectoId = this.proyectoId();
    const pendientes = this.ticketsFiltrados().filter((t) => !this.estaResuelto(t));

    if (proyectoId) {
      const columnas = this.columnas()
        .filter((c) => Number(c.proyectoId) === proyectoId)
        .sort((a, b) => a.orden - b.orden);
      return columnas.map((c) => {
        const deEstaColumna = pendientes.filter((t) => Number(t.tableroColumnaId) === Number(c.id));
        const valor = this.metrica() === 'horas' ? deEstaColumna.reduce((s, t) => s + this.horasDeTicket(t), 0) : deEstaColumna.length;
        return { etiqueta: c.nombre, valor: this.redondear(valor) };
      });
    }

    // "Todos los proyectos": las columnas no son comparables entre sí (cada
    // Proyecto tiene las suyas), así que se agrupan por NOMBRE de columna —
    // convención habitual (Backlog/Análisis/Desarrollo/…) aunque sean
    // registros distintos en cada proyecto.
    const columnasPorId = new Map(this.columnas().map((c) => [Number(c.id), c]));
    const porNombre = new Map<string, number>();
    for (const t of pendientes) {
      const columna = columnasPorId.get(Number(t.tableroColumnaId));
      if (!columna) continue;
      const valor = this.metrica() === 'horas' ? this.horasDeTicket(t) : 1;
      porNombre.set(columna.nombre, (porNombre.get(columna.nombre) ?? 0) + valor);
    }
    return [...porNombre.entries()]
      .map(([nombre, valor]) => ({ etiqueta: nombre, valor: this.redondear(valor) }))
      .sort((a, b) => b.valor - a.valor);
  });

  protected readonly maxTrabajoPendiente = computed(() => Math.max(1, ...this.trabajoPendiente().map((p) => p.valor)));
  protected readonly totalTrabajoPendiente = computed(() => this.redondear(this.trabajoPendiente().reduce((s, p) => s + p.valor, 0)));

  // ---------------------------------------------------------------------
  // 3. Reporte de sprint — resumen de un sprint (completado vs. total).
  // ---------------------------------------------------------------------

  protected readonly sprintsDelProyecto = computed(() => {
    const proyectoId = this.proyectoId();
    if (!proyectoId) return [];
    return this.sprints()
      .filter((s) => Number(s.proyectoId) === proyectoId)
      .sort((a, b) => (b.fechaInicio ?? '').localeCompare(a.fechaInicio ?? ''));
  });

  /** Mismo cálculo que antes tenía sprintReporte() en línea, ahora factorizado para
   *  poder aplicarlo a UN sprint (sprintReporte, drill-down de abajo) o a TODOS los
   *  del proyecto a la vez (resumenSprints, la tabla de arriba). */
  private resumenDeSprint(sprint: Sprint) {
    const ticketsSprint = this.tickets()
      .filter((t) => t.activo !== false && Number(t.sprintId) === Number(sprint.id))
      // Pendientes primero (lo que falta es lo que más le importa a quien revisa
      // el sprint); dentro de cada grupo, por folio — orden estable y predecible.
      .sort((a, b) => Number(this.estaResuelto(a)) - Number(this.estaResuelto(b)) || a.numeroTicket.localeCompare(b.numeroTicket));
    const resueltos = ticketsSprint.filter((t) => this.estaResuelto(t));
    const horasTotales = ticketsSprint.reduce((s, t) => s + this.horasDeTicket(t), 0);
    const horasResueltas = resueltos.reduce((s, t) => s + this.horasDeTicket(t), 0);

    return {
      sprint,
      tickets: ticketsSprint,
      totalTickets: ticketsSprint.length,
      resueltos: resueltos.length,
      pendientes: ticketsSprint.length - resueltos.length,
      horasTotales: this.redondear(horasTotales),
      horasResueltas: this.redondear(horasResueltas),
      porcentajeTickets: ticketsSprint.length ? Math.round((resueltos.length / ticketsSprint.length) * 100) : 0,
      porcentajeHoras: horasTotales ? Math.round((horasResueltas / horasTotales) * 100) : 0,
    };
  }

  protected readonly sprintReporte = computed(() => {
    const disponibles = this.sprintsDelProyecto();
    const id = this.sprintSeleccionadoId() || disponibles[0]?.id || 0;
    const sprint = disponibles.find((s) => Number(s.id) === Number(id));
    if (!sprint) return null;
    return this.resumenDeSprint(sprint);
  });

  /** Tabla con TODOS los sprints del proyecto (no solo el elegido en el selector) —
   *  para poder ver de un vistazo cuáles hay y su avance antes de decidir cuáles
   *  reportar a nivel directivo, sin tener que ir eligiéndolos uno por uno. Se puede
   *  reordenar por cualquier columna (ordenarSprintsPor/ordenSprintPor). */
  protected readonly resumenSprints = computed(() => {
    const campo = this.ordenSprintPor();
    const direccion = this.ordenSprintDireccion() === 'desc' ? -1 : 1;
    const valorDe = (r: ReturnType<typeof this.resumenDeSprint>): number | string => {
      switch (campo) {
        case 'nombre':
          return r.sprint.nombre.toLowerCase();
        case 'estado':
          return r.sprint.estado;
        case 'tickets':
          return r.porcentajeTickets;
        case 'horas':
          return r.porcentajeHoras;
        case 'fecha':
        default:
          return r.sprint.fechaInicio ?? '';
      }
    };
    return this.sprintsDelProyecto()
      .map((s) => this.resumenDeSprint(s))
      .sort((a, b) => {
        const va = valorDe(a);
        const vb = valorDe(b);
        const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
        return direccion * cmp || a.sprint.nombre.localeCompare(b.sprint.nombre);
      });
  });

  // ---------------------------------------------------------------------
  // 4. Velocidad — trabajo completado por sprint cerrado (últimos 8).
  // ---------------------------------------------------------------------

  protected readonly velocidad = computed<PuntoBarra[]>(() => {
    const proyectoId = this.proyectoId();
    if (!proyectoId) return [];
    const cerrados = this.sprints()
      .filter((s) => s.estado === 'cerrado' && Number(s.proyectoId) === proyectoId)
      .sort((a, b) => (a.fechaFin ?? a.fechaInicio ?? '').localeCompare(b.fechaFin ?? b.fechaInicio ?? ''))
      .slice(-8);
    return cerrados.map((s) => {
      const resueltosDelSprint = this.tickets().filter(
        (t) => t.activo !== false && Number(t.sprintId) === Number(s.id) && this.estaResuelto(t),
      );
      const valor =
        this.metrica() === 'horas'
          ? resueltosDelSprint.reduce((acc, t) => acc + this.horasDeTicket(t), 0)
          : resueltosDelSprint.length;
      return { etiqueta: s.nombre, valor: this.redondear(valor) };
    });
  });

  protected readonly maxVelocidad = computed(() => Math.max(1, ...this.velocidad().map((p) => p.valor)));
  protected readonly promedioVelocidad = computed(() => {
    const puntos = this.velocidad();
    if (!puntos.length) return 0;
    return this.redondear(puntos.reduce((s, p) => s + p.valor, 0) / puntos.length);
  });

  // ---------------------------------------------------------------------
  // 5. Diagrama de flujo acumulado (CFD) — requiere un proyecto concreto.
  // ---------------------------------------------------------------------

  protected readonly cfd = computed<{ dias: string[]; series: SerieCfd[] }>(() => {
    const proyectoId = this.proyectoId();
    if (!proyectoId) return { dias: [], series: [] };
    const columnas = this.columnas()
      .filter((c) => Number(c.proyectoId) === proyectoId)
      .sort((a, b) => a.orden - b.orden);
    if (!columnas.length) return { dias: [], series: [] };

    const ordenPorColumna = new Map(columnas.map((c) => [Number(c.id), c.orden]));
    const ticketsProyecto = this.tickets().filter((t) => t.activo !== false && Number(t.proyectoId) === proyectoId);
    const segmentosPorTicket = ticketsProyecto.map((t) => this.segmentosDeTicket(t)).filter((s) => s.length > 0);

    const numDias = this.diasCfd();
    const hoy = new Date();
    hoy.setHours(23, 59, 59, 999);
    const etiquetasDias: string[] = [];
    const valoresPorSerie: number[][] = columnas.map(() => []);

    for (let i = numDias - 1; i >= 0; i--) {
      const momento = new Date(hoy);
      momento.setDate(momento.getDate() - i);
      const momentoMs = momento.getTime();
      etiquetasDias.push(momento.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }).replace('.', ''));

      columnas.forEach((col, idx) => {
        let cuenta = 0;
        for (const segmentos of segmentosPorTicket) {
          const columnaId = this.columnaEnMomento(segmentos, momentoMs);
          if (columnaId === null) continue;
          const ordenTicket = ordenPorColumna.get(columnaId);
          if (ordenTicket !== undefined && ordenTicket >= col.orden) cuenta++;
        }
        valoresPorSerie[idx].push(cuenta);
      });
    }

    return {
      dias: etiquetasDias,
      series: columnas.map((c, idx) => ({
        nombre: c.nombre,
        color: COLORES_SERIE[idx % COLORES_SERIE.length],
        valores: valoresPorSerie[idx],
      })),
    };
  });

  protected readonly cfdMaximo = computed(() => Math.max(1, ...this.cfd().series.flatMap((s) => s.valores)));

  /** true si CADA valor de CADA serie es 0 — el proyecto no tiene ni un solo
   *  movimiento de columna registrado en el rango elegido (historial vacío para
   *  este proyecto en este rango; se muestra un aviso en vez de un diagrama
   *  plano en blanco, para que quede claro que es falta de datos, no un error). */
  protected readonly cfdSinDatos = computed(() => this.cfd().series.every((s) => s.valores.every((v) => v === 0)));

  /** Genera el "path" SVG de la serie i como área sólida desde la base (0) hasta
   *  su curva — dibujando las series MÁS GRANDES primero (columnas tempranas,
   *  p.ej. "Backlog o después" = prácticamente el total) y las MÁS CHICAS encima
   *  (columnas tardías, p.ej. "Terminado"), cada área sólida oculta el pedazo
   *  correspondiente de la anterior: lo que queda visible de una serie alrededor
   *  de la siguiente es exactamente el WIP (trabajo en proceso) de esa etapa —
   *  el mismo resultado visual que un stacked-area clásico, con mucho menos
   *  matemática (sin necesidad de calcular el área ENTRE dos curvas). */
  protected pathSerieCfd(valores: number[], anchoSvg: number, altoSvg: number): string {
    const maximo = this.cfdMaximo();
    const n = valores.length;
    if (n === 0) return '';
    const pasoX = n > 1 ? anchoSvg / (n - 1) : 0;
    const y = (v: number) => altoSvg - (v / maximo) * altoSvg;
    let d = `M 0 ${altoSvg}`;
    valores.forEach((v, i) => {
      d += ` L ${this.redondear(i * pasoX)} ${this.redondear(y(v))}`;
    });
    d += ` L ${anchoSvg} ${altoSvg} Z`;
    return d;
  }

  // ---------------------------------------------------------------------
  // 6. Gráfica de control — tiempo de ciclo por ticket resuelto.
  // ---------------------------------------------------------------------

  protected readonly control = computed<PuntoControl[]>(() => {
    const resueltos = this.ticketsFiltrados().filter((t) => this.estaResuelto(t));
    const puntos: PuntoControl[] = [];
    for (const t of resueltos) {
      const segmentos = this.segmentosDeTicket(t);
      if (segmentos.length < 1) continue;
      const inicioMs = segmentos[0].inicioMs;
      const finMs = segmentos[segmentos.length - 1].inicioMs;
      if (finMs <= inicioMs) continue;
      puntos.push({
        fecha: new Date(finMs).toISOString().slice(0, 10),
        dias: this.redondear((finMs - inicioMs) / this.MS_POR_DIA),
        folio: t.numeroTicket,
        titulo: t.titulo,
      });
    }
    return puntos.sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(-80);
  });

  protected readonly controlPromedio = computed(() => {
    const puntos = this.control();
    if (!puntos.length) return 0;
    return this.redondear(puntos.reduce((s, p) => s + p.dias, 0) / puntos.length);
  });

  protected readonly controlP85 = computed(() => {
    const valores = this.control()
      .map((p) => p.dias)
      .sort((a, b) => a - b);
    if (!valores.length) return 0;
    const idx = Math.min(valores.length - 1, Math.ceil(0.85 * valores.length) - 1);
    return this.redondear(valores[idx]);
  });

  protected readonly controlMaximo = computed(() => Math.max(1, ...this.control().map((p) => p.dias)));

  protected posicionControl(indice: number, dias: number, anchoSvg: number, altoSvg: number): { x: number; y: number } {
    const puntos = this.control();
    const n = puntos.length;
    const pasoX = n > 1 ? anchoSvg / (n - 1) : anchoSvg / 2;
    const x = n > 1 ? indice * pasoX : anchoSvg / 2;
    const y = altoSvg - (dias / this.controlMaximo()) * altoSvg;
    return { x: this.redondear(x), y: this.redondear(y) };
  }
}

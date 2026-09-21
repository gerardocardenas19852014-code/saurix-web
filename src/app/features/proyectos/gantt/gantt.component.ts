import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DataClientService } from '../../../core/services/data-client.service';
import { Usuario, nombreCompletoUsuario } from '../../seguridad/usuarios/usuario.model';
import { ProyectoOpcion, TableroColumna } from '../tableros/tablero-columna.model';
import { Ticket, UsuarioOpcion } from '../kanban/ticket.model';
import { TicketTipo } from '../ticket-tipos/ticket-tipo.model';
import { TicketPrioridad } from '../ticket-prioridades/ticket-prioridad.model';

interface DiaEncabezado {
  numero: number;
  mesCorto: string;
  primerDiaDelMes: boolean;
  finDeSemana: boolean;
  esHoy: boolean;
}

interface TicketConBarra {
  ticket: Ticket;
  leftPx: number;
  widthPx: number;
  sinEstimacion: boolean;
  /** Ticket.planeado === false — se resalta con un patrón de rayas en la barra
   *  (independiente de sinEstimacion: un ticket puede no estar planeado y aun así
   *  tener estimación, o viceversa). */
  noPlaneado: boolean;
  color: string;
  colorTexto: '#fff' | '#1a1a1a';
  asignadoNombre: string;
}

interface GrupoEstado {
  columna: TableroColumna | null;
  tickets: TicketConBarra[];
}

/**
 * Diagrama de Gantt de un proyecto a la vez. La línea de tiempo de cada
 * ticket se calcula así:
 *  - Inicio de la barra = Ticket.fechaInicio si se capturó, si no Ticket.fechaCreacion.
 *  - Fin/duración de la barra = Ticket.fechaFin si se capturó (duración = fechaFin -
 *    inicio); si no hay fechaFin, se usa Ticket.tiempoEstimadoMin / 1440 (días) — el
 *    campo real sigue en MINUTOS (igual que en Kanban/Reportes de horas), aquí solo
 *    se convierte para dibujar; nunca se lee como si ya fueran días.
 * fechaInicio/fechaFin son opcionales (pensados solo para este diagrama); un ticket
 * sin ninguno de los dos sigue mostrándose con el cálculo original (creación + estimado).
 * Los tickets sin fecha de creación NI de inicio no tienen dónde ubicarse en la línea
 * de tiempo y se excluyen del diagrama (se informa cuántos quedaron fuera).
 */
@Component({
  selector: 'app-gantt',
  standalone: true,
  imports: [],
  templateUrl: './gantt.component.html',
  styleUrl: './gantt.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GanttComponent implements OnInit {
  private readonly data = inject(DataClientService);

  /** Ancho, en píxeles, de un día en la línea de tiempo. */
  protected readonly ANCHO_DIA = 36;
  private readonly MS_POR_DIA = 86400000;

  protected readonly proyectos = signal<ProyectoOpcion[]>([]);
  protected readonly proyectoSeleccionadoId = signal<number>(0);
  protected readonly columnasTablero = signal<TableroColumna[]>([]);
  protected readonly tickets = signal<Ticket[]>([]);
  protected readonly tipos = signal<TicketTipo[]>([]);
  protected readonly prioridades = signal<TicketPrioridad[]>([]);
  protected readonly usuarios = signal<UsuarioOpcion[]>([]);
  protected readonly cargando = signal(false);

  /** Rango de fechas manual — igual que en Reportes de horas: siempre visible,
   *  formato yyyy-mm-dd (input type=date). Filtra el diagrama a los tickets cuya
   *  barra (inicio→fin) se cruza con el rango elegido; no toca el cálculo de la
   *  barra en sí, solo qué tickets se muestran. */
  protected readonly rangoDesde = signal<string>('');
  protected readonly rangoHasta = signal<string>('');
  protected readonly hayRangoManual = computed(() => !!(this.rangoDesde() || this.rangoHasta()));

  limpiarRangoManual(): void {
    this.rangoDesde.set('');
    this.rangoHasta.set('');
  }

  private readonly ticketsConFechaSinRango = computed(() =>
    this.tickets().filter((t) => t.activo !== false && !!(t.fechaInicio || t.fechaCreacion)),
  );
  protected readonly cantidadSinFecha = computed(
    () => this.tickets().filter((t) => t.activo !== false && !t.fechaInicio && !t.fechaCreacion).length,
  );

  protected readonly ticketsConFecha = computed(() => {
    const desde = this.rangoDesde();
    const hasta = this.rangoHasta();
    const base = this.ticketsConFechaSinRango();
    if (!desde && !hasta) return base;

    const desdeMs = desde ? new Date(`${desde}T00:00:00`).getTime() : -Infinity;
    const hastaMs = hasta ? new Date(`${hasta}T23:59:59`).getTime() : Infinity;
    return base.filter((t) => {
      const inicioMs = this.inicioDeTicket(t);
      const finMs = inicioMs + this.duracionDiasDe(t) * this.MS_POR_DIA;
      // Se cruza con el rango elegido (no hace falta que quede totalmente adentro).
      return inicioMs <= hastaMs && finMs >= desdeMs;
    });
  });

  /** De los tickets con fecha, cuántos quedaron fuera solo por el rango manual
   *  (para poder avisar sin confundirlo con "sin fecha de creación"). */
  protected readonly cantidadFueraDeRango = computed(
    () => this.ticketsConFechaSinRango().length - this.ticketsConFecha().length,
  );

  protected readonly rango = computed(() => {
    const ticks = this.ticketsConFecha();
    if (!ticks.length) return null;

    let minMs = Infinity;
    let maxMs = -Infinity;
    for (const t of ticks) {
      const inicioMs = this.inicioDeTicket(t);
      const finMs = inicioMs + this.duracionDiasDe(t) * this.MS_POR_DIA;
      if (inicioMs < minMs) minMs = inicioMs;
      if (finMs > maxMs) maxMs = finMs;
    }
    // Un día de aire a cada lado para que las barras de los extremos no queden pegadas al borde.
    minMs -= this.MS_POR_DIA;
    maxMs += this.MS_POR_DIA;
    const totalDias = Math.max(1, Math.ceil((maxMs - minMs) / this.MS_POR_DIA));
    return { minMs, maxMs, totalDias };
  });

  protected readonly anchoTimelinePx = computed(() => (this.rango()?.totalDias ?? 0) * this.ANCHO_DIA);

  /** Gridlines verticales (una por día) dibujadas como fondo, en vez de repetir
   *  un div por día en cada fila de ticket — mismo resultado visual, mucho más barato. */
  protected readonly fondoDias = computed(
    () => `repeating-linear-gradient(90deg, var(--line) 0, var(--line) 1px, transparent 1px, transparent ${this.ANCHO_DIA}px)`,
  );

  protected readonly diasEncabezado = computed<DiaEncabezado[]>(() => {
    const rango = this.rango();
    if (!rango) return [];
    const hoyInicio = this.inicioDelDia(Date.now());
    const dias: DiaEncabezado[] = [];
    for (let ms = rango.minMs; ms < rango.maxMs; ms += this.MS_POR_DIA) {
      const fecha = new Date(ms);
      dias.push({
        numero: fecha.getDate(),
        mesCorto: fecha.toLocaleDateString('es-MX', { month: 'short' }),
        primerDiaDelMes: fecha.getDate() === 1,
        finDeSemana: fecha.getDay() === 0 || fecha.getDay() === 6,
        esHoy: ms === hoyInicio,
      });
    }
    return dias;
  });

  protected readonly offsetHoyPx = computed(() => {
    const rango = this.rango();
    if (!rango) return null;
    const hoy = this.inicioDelDia(Date.now());
    if (hoy < rango.minMs || hoy > rango.maxMs) return null;
    return Math.round(((hoy - rango.minMs) / this.MS_POR_DIA) * this.ANCHO_DIA);
  });

  /** Tickets agrupados por columna del tablero (estado), en el mismo orden que
   *  el Kanban, y dentro de cada grupo ordenados por fecha de creación. */
  protected readonly gruposPorEstado = computed<GrupoEstado[]>(() => {
    const columnas = this.columnasTablero();
    const ticks = this.ticketsConFecha();
    const grupos: GrupoEstado[] = [];

    for (const columna of columnas) {
      const deEstaColumna = ticks
        .filter((t) => Number(t.tableroColumnaId) === Number(columna.id))
        .sort((a, b) => (a.fechaCreacion ?? '').localeCompare(b.fechaCreacion ?? ''))
        .map((t) => this.aTicketConBarra(t));
      if (deEstaColumna.length) grupos.push({ columna, tickets: deEstaColumna });
    }

    const idsConocidos = new Set(columnas.map((c) => Number(c.id)));
    const huerfanos = ticks
      .filter((t) => !idsConocidos.has(Number(t.tableroColumnaId)))
      .sort((a, b) => (a.fechaCreacion ?? '').localeCompare(b.fechaCreacion ?? ''))
      .map((t) => this.aTicketConBarra(t));
    if (huerfanos.length) grupos.push({ columna: null, tickets: huerfanos });

    return grupos;
  });

  ngOnInit(): void {
    this.data.list<ProyectoOpcion>('Proyecto').subscribe({
      next: (proyectos) => {
        this.proyectos.set(proyectos);
        if (!proyectos.length) return;
        this.proyectoSeleccionadoId.set(proyectos[0].id);
        this.cargarTablero();
      },
    });
    this.data.list<TicketTipo>('TicketTipo').subscribe((tipos) => this.tipos.set(tipos));
    this.data.list<TicketPrioridad>('TicketPrioridad').subscribe((prioridades) => this.prioridades.set(prioridades));
    // 'Usuario' no trae un campo nombreCompleto propio (ver Usuario.model.ts) — hay que
    // armarlo con nombreCompletoUsuario(), igual que en Kanban.
    this.data.list<Usuario>('Usuario').subscribe((usuarios) =>
      this.usuarios.set(usuarios.map((u) => ({ id: u.id, nombreCompleto: nombreCompletoUsuario(u) }))),
    );
  }

  cambiarProyecto(id: number): void {
    this.proyectoSeleccionadoId.set(Number(id));
    this.cargarTablero();
  }

  nombreTipo(id: number): string {
    return this.tipos().find((t) => Number(t.id) === Number(id))?.nombre ?? '—';
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

  private cargarTablero(): void {
    const proyectoId = this.proyectoSeleccionadoId();
    if (!proyectoId) return;

    this.cargando.set(true);
    this.data.list<TableroColumna>('TableroColumna', { proyectoId }).subscribe({
      next: (columnas) => {
        this.columnasTablero.set(columnas.sort((a, b) => a.orden - b.orden));
        this.data.list<Ticket>('Ticket', { proyectoId }).subscribe({
          next: (tickets) => {
            this.tickets.set(tickets);
            this.cargando.set(false);
          },
          error: () => this.cargando.set(false),
        });
      },
      error: () => this.cargando.set(false),
    });
  }

  private aTicketConBarra(ticket: Ticket): TicketConBarra {
    const rango = this.rango();
    const inicioMs = this.inicioDeTicket(ticket);
    const leftPx = rango ? Math.round(((inicioMs - rango.minMs) / this.MS_POR_DIA) * this.ANCHO_DIA) : 0;
    const widthPx = Math.round(this.duracionDiasDe(ticket) * this.ANCHO_DIA);
    const color = this.colorPrioridad(ticket.ticketPrioridadId);
    return {
      ticket,
      leftPx,
      widthPx: Math.max(widthPx, 14),
      sinEstimacion: !ticket.fechaFin && !ticket.tiempoEstimadoMin,
      noPlaneado: ticket.planeado === false,
      color,
      colorTexto: this.colorLegiblePara(color),
      asignadoNombre: this.nombreUsuario(ticket.asignadoUsuarioId),
    };
  }

  /** Colores de prioridad claros (amarillo, verde, etc.) dejan el texto blanco
   *  ilegible encima — se elige negro o blanco según qué tan clara sea la barra. */
  private colorLegiblePara(hex: string): '#fff' | '#1a1a1a' {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
    if (!m) return '#fff';
    const [r, g, b] = [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
    const luminancia = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminancia > 165 ? '#1a1a1a' : '#fff';
  }

  private inicioDeTicket(ticket: Ticket): number {
    const fecha = ticket.fechaInicio || ticket.fechaCreacion;
    return this.inicioDelDia(fecha ? new Date(fecha).getTime() : Date.now());
  }

  private inicioDelDia(ms: number): number {
    const fecha = new Date(ms);
    fecha.setHours(0, 0, 0, 0);
    return fecha.getTime();
  }

  /** Si el ticket tiene fechaFin capturada, esa manda sobre el estimado (se calcula
   *  la duración real entre inicio y fin). Si no, tiempoEstimadoMin —que está en
   *  MINUTOS, ver esquema-tablas-saurix.md— se divide entre 1440 solo para dibujar
   *  la barra; nunca se guarda ni se lee como si ya fueran días. */
  private duracionDiasDe(ticket: Ticket): number {
    if (ticket.fechaFin) {
      const inicioMs = this.inicioDeTicket(ticket);
      const finMs = this.inicioDelDia(new Date(ticket.fechaFin).getTime());
      // +1 para incluir por completo el día de fin (si inicio === fin, dura ese mismo día).
      const dias = (finMs - inicioMs) / this.MS_POR_DIA + 1;
      return Math.max(dias, 0.5);
    }
    const minutos = ticket.tiempoEstimadoMin;
    if (!minutos || minutos <= 0) return 0.5; // sin estimación: barra mínima visible
    return Math.max(minutos / 1440, 0.5);
  }
}

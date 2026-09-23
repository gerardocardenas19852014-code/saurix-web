import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DataClientService } from '../../../core/services/data-client.service';
import { exportarCsv } from '../../../shared/utils/csv.util';
import { colorAvatar } from '../kanban/avatar.util';
import { Usuario, nombreCompletoUsuario } from '../../seguridad/usuarios/usuario.model';
import { Ticket, TicketActividad, TicketHistorialEstado, UsuarioOpcion } from '../kanban/ticket.model';
import { TicketPrioridad } from '../ticket-prioridades/ticket-prioridad.model';
import { ProyectoOpcion, TableroColumna } from '../tableros/tablero-columna.model';

type EstadoSalud = 'ok' | 'atencion' | 'critico' | 'sin-datos';

interface ResumenProyecto {
  proyecto: ProyectoOpcion;
  pendientes: number;
  resueltos: number;
  vencidos: number;
  porVencer: number;
  /** Pendientes cuya Prioridad está marcada como "crítica" (p.ej. "DETIENE
   *  OPERACION") — igual criterio que la tarjeta "🚨 Críticos" de Mi Dashboard.
   *  Un ticket así puede no estar vencido todavía y aun así ser el más urgente
   *  del proyecto, por eso también cuenta para estadoSalud. */
  criticos: number;
  estadoSalud: EstadoSalud;
  horasEstimadas: number;
  horasReales: number;
  /** null cuando el proyecto no tiene nada estimado (no hay contra qué comparar). */
  desviacionPct: number | null;
  /** Ya formateada para mostrar (o null si no hay pendientes, o pendientes sin ninguna fecha). */
  fechaCierreEstimada: string | null;
}

interface CargaUsuario {
  id: number;
  nombre: string;
  color: string;
  pendientes: number;
  vencidos: number;
}

interface TiempoColumna {
  id: number;
  nombre: string;
  promedioDias: number;
  muestras: number;
}

/**
 * "Resumen ejecutivo" (Gestión de Proyectos) — a diferencia de "Mi Dashboard"
 * (que es por persona), esta pantalla es la vista de portafolio: salud de
 * cada proyecto, estimado vs. horas reales, carga de trabajo del equipo
 * completo y en qué estado se atoran más los tickets. Pensada para tomar
 * decisiones (dónde meterle mano, a quién no sobrecargar, qué proyecto va
 * a salirse de fecha) sin tener que entrar tablero por tablero.
 *
 * Todo se calcula del lado del cliente a partir de los GetList ya
 * disponibles (Proyecto, TableroColumna, Ticket, TicketPrioridad,
 * TicketActividad, TicketHistorialEstado) — no requiere ningún SP de
 * agregación (ver esquema-tablas-saurix.md). Reutiliza los mismos criterios
 * ya usados en otras pantallas: "resuelto" = última columna del tablero
 * (igual que Mi Dashboard), vigencia/SLA (igual que Mi Dashboard) y el
 * cálculo de inicio/fin de un ticket para el cierre estimado (igual que
 * Gantt: fechaInicio/fechaCreacion + fechaFin o tiempoEstimadoMin).
 */
@Component({
  selector: 'app-resumen-ejecutivo',
  standalone: true,
  imports: [],
  templateUrl: './resumen-ejecutivo.component.html',
  styleUrl: './resumen-ejecutivo.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResumenEjecutivoComponent implements OnInit {
  private readonly data = inject(DataClientService);
  private readonly router = inject(Router);
  private readonly MS_POR_DIA = 86400000;

  protected readonly cargando = signal(false);

  protected readonly proyectos = signal<ProyectoOpcion[]>([]);
  protected readonly columnas = signal<TableroColumna[]>([]);
  protected readonly tickets = signal<Ticket[]>([]);
  protected readonly prioridades = signal<TicketPrioridad[]>([]);
  protected readonly actividades = signal<TicketActividad[]>([]);
  protected readonly historial = signal<TicketHistorialEstado[]>([]);
  protected readonly usuarios = signal<UsuarioOpcion[]>([]);

  /** Proyecto elegido para el detalle de "Cuellos de botella" — las demás secciones son globales. */
  protected readonly proyectoDetalleId = signal<number>(0);

  ngOnInit(): void {
    this.cargando.set(true);
    this.data.list<ProyectoOpcion>('Proyecto').subscribe((proyectos) => {
      this.proyectos.set(proyectos);
      if (proyectos.length && !this.proyectoDetalleId()) this.proyectoDetalleId.set(proyectos[0].id);
    });
    this.data.list<TableroColumna>('TableroColumna').subscribe((c) => this.columnas.set(c));
    this.data.list<TicketPrioridad>('TicketPrioridad').subscribe((p) => this.prioridades.set(p));
    this.data.list<TicketActividad>('TicketActividad').subscribe((a) => this.actividades.set(a));
    this.data.list<TicketHistorialEstado>('TicketHistorialEstado').subscribe((h) => this.historial.set(h));
    // 'Usuario' no trae un campo nombreCompleto propio — hay que armarlo con
    // nombreCompletoUsuario(), igual que en Mi Dashboard/Kanban/Gantt.
    this.data
      .list<Usuario>('Usuario')
      .subscribe((u) => this.usuarios.set(u.map((x) => ({ id: x.id, nombreCompleto: nombreCompletoUsuario(x) }))));
    this.data.list<Ticket>('Ticket').subscribe({
      next: (tickets) => {
        this.tickets.set(tickets);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  cambiarProyectoDetalle(id: string | number): void {
    this.proyectoDetalleId.set(Number(id));
  }

  protected abrirProyecto(resumen: ResumenProyecto): void {
    this.router.navigate(['/proyectos/tablero'], { queryParams: { proyecto: resumen.proyecto.id } });
  }

  private nombreUsuario(id: number | null): string {
    if (!id) return 'Sin asignar';
    return this.usuarios().find((u) => Number(u.id) === Number(id))?.nombreCompleto ?? '—';
  }

  /** Última columna (por orden) del tablero de cada proyecto — se considera
   *  "resuelto" al llegar ahí (mismo criterio que Mi Dashboard). */
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

  /** Mismo cálculo de vigencia (SLA) que Mi Dashboard: null si no aplica (sin prioridad
   *  con vigencia, sin fecha de creación) o si el ticket ya está resuelto. */
  private claseSla(ticket: Ticket): 'sla-ok' | 'sla-warning' | 'sla-expired' | null {
    const prioridad = this.prioridades().find((p) => Number(p.id) === Number(ticket.ticketPrioridadId));
    if (!prioridad?.vigenciaHoras || !ticket.fechaCreacion || this.estaResuelto(ticket)) return null;
    const creado = new Date(ticket.fechaCreacion).getTime();
    const deadline = creado + prioridad.vigenciaHoras * 3600000;
    const warnAt = deadline - (prioridad.avisoHoras || 0) * 3600000;
    const ahora = Date.now();
    if (ahora >= deadline) return 'sla-expired';
    if (ahora >= warnAt) return 'sla-warning';
    return 'sla-ok';
  }

  /** Mismo cálculo de inicio que el Gantt: fechaInicio si se capturó, si no fechaCreacion. */
  private inicioDeTicket(ticket: Ticket): number {
    const fecha = ticket.fechaInicio || ticket.fechaCreacion;
    return fecha ? new Date(fecha).getTime() : Date.now();
  }

  /** Fin estimado de un ticket para el cierre del proyecto — mismo criterio que el Gantt:
   *  fechaFin si se capturó, si no inicio + tiempoEstimadoMin (que está en MINUTOS). null
   *  cuando el ticket no tiene ninguna de las dos (no hay con qué proyectar su fin). */
  private finEstimadoDeTicket(ticket: Ticket): number | null {
    if (ticket.fechaFin) return new Date(ticket.fechaFin).getTime();
    if (ticket.tiempoEstimadoMin && ticket.tiempoEstimadoMin > 0) {
      return this.inicioDeTicket(ticket) + (ticket.tiempoEstimadoMin / 1440) * this.MS_POR_DIA;
    }
    return null;
  }

  protected readonly resumenPorProyecto = computed<ResumenProyecto[]>(() => {
    const tickets = this.tickets();
    return this.proyectos().map((proyecto) => {
      const deEsteProyecto = tickets.filter(
        (t) => Number(t.proyectoId) === Number(proyecto.id) && t.activo !== false,
      );
      const pendientes = deEsteProyecto.filter((t) => !this.estaResuelto(t));
      const resueltos = deEsteProyecto.filter((t) => this.estaResuelto(t));
      const vencidos = pendientes.filter((t) => this.claseSla(t) === 'sla-expired');
      const porVencer = pendientes.filter((t) => this.claseSla(t) === 'sla-warning');
      const criticos = pendientes.filter(
        (t) => this.prioridades().find((p) => Number(p.id) === Number(t.ticketPrioridadId))?.critica === true,
      );

      const horasEstimadas = deEsteProyecto.reduce((s, t) => s + (t.tiempoEstimadoMin || 0), 0) / 60;
      const idsTicketsProyecto = new Set(deEsteProyecto.map((t) => Number(t.id)));
      const horasReales =
        this.actividades()
          .filter((a) => idsTicketsProyecto.has(Number(a.ticketId)))
          .reduce((s, a) => s + a.tiempoMin, 0) / 60;
      const desviacionPct =
        horasEstimadas > 0 ? Math.round(((horasReales - horasEstimadas) / horasEstimadas) * 100) : null;

      let fechaCierreEstimada: string | null = null;
      if (pendientes.length) {
        let maxMs: number | null = null;
        for (const t of pendientes) {
          const fin = this.finEstimadoDeTicket(t);
          if (fin !== null && (maxMs === null || fin > maxMs)) maxMs = fin;
        }
        fechaCierreEstimada = maxMs !== null ? new Date(maxMs).toLocaleDateString('es-MX') : null;
      }

      let estadoSalud: EstadoSalud;
      if (deEsteProyecto.length === 0) estadoSalud = 'sin-datos';
      else if (vencidos.length > 0 || criticos.length > 0) estadoSalud = 'critico';
      else if (porVencer.length > 0) estadoSalud = 'atencion';
      else estadoSalud = 'ok';

      return {
        proyecto,
        pendientes: pendientes.length,
        resueltos: resueltos.length,
        vencidos: vencidos.length,
        porVencer: porVencer.length,
        criticos: criticos.length,
        estadoSalud,
        horasEstimadas: Math.round(horasEstimadas * 10) / 10,
        horasReales: Math.round(horasReales * 10) / 10,
        desviacionPct,
        fechaCierreEstimada,
      };
    });
  });

  protected readonly totalVencidos = computed(() => this.resumenPorProyecto().reduce((s, r) => s + r.vencidos, 0));
  protected readonly totalPorVencer = computed(() => this.resumenPorProyecto().reduce((s, r) => s + r.porVencer, 0));
  protected readonly totalCriticos = computed(() => this.resumenPorProyecto().reduce((s, r) => s + r.criticos, 0));
  protected readonly proyectosEnRiesgo = computed(
    () => this.resumenPorProyecto().filter((r) => r.estadoSalud === 'critico').length,
  );

  exportarSaludCsv(): void {
    const filas = this.resumenPorProyecto().map((r) => ({
      clave: r.proyecto.clave,
      nombre: r.proyecto.nombre,
      pendientes: r.pendientes,
      resueltos: r.resueltos,
      vencidos: r.vencidos,
      porVencer: r.porVencer,
      criticos: r.criticos,
      horasEstimadas: r.horasEstimadas,
      horasReales: r.horasReales,
      desviacionPct: r.desviacionPct ?? '',
      cierreEstimado: r.fechaCierreEstimada ?? '',
    }));
    exportarCsv(
      'salud-proyectos.csv',
      [
        { clave: 'clave', etiqueta: 'Clave' },
        { clave: 'nombre', etiqueta: 'Nombre' },
        { clave: 'pendientes', etiqueta: 'Pendientes' },
        { clave: 'resueltos', etiqueta: 'Resueltos' },
        { clave: 'vencidos', etiqueta: 'Vencidos' },
        { clave: 'criticos', etiqueta: 'Críticos' },
        { clave: 'porVencer', etiqueta: 'Por vencer' },
        { clave: 'horasEstimadas', etiqueta: 'Horas estimadas' },
        { clave: 'horasReales', etiqueta: 'Horas reales' },
        { clave: 'desviacionPct', etiqueta: 'Desviación %' },
        { clave: 'cierreEstimado', etiqueta: 'Cierre estimado' },
      ],
      filas,
    );
  }

  // ---- Carga de trabajo por persona (global: tickets pendientes en TODOS los proyectos) ----
  protected readonly cargaPorUsuario = computed<CargaUsuario[]>(() => {
    const pendientesTodos = this.tickets().filter((t) => t.activo !== false && !this.estaResuelto(t));
    const porUsuario = new Map<number, { pendientes: number; vencidos: number }>();
    for (const t of pendientesTodos) {
      const id = Number(t.asignadoUsuarioId) || 0;
      const actual = porUsuario.get(id) ?? { pendientes: 0, vencidos: 0 };
      actual.pendientes++;
      if (this.claseSla(t) === 'sla-expired') actual.vencidos++;
      porUsuario.set(id, actual);
    }
    const filas = [...porUsuario.entries()].map(([id, datos]) => {
      const nombre = this.nombreUsuario(id || null);
      return { id, nombre, color: colorAvatar(nombre), pendientes: datos.pendientes, vencidos: datos.vencidos };
    });
    return filas.sort((a, b) => b.pendientes - a.pendientes);
  });

  protected readonly maxCargaUsuario = computed(() => Math.max(1, ...this.cargaPorUsuario().map((f) => f.pendientes)));

  // ---- Cuellos de botella: tiempo promedio por columna, de UN proyecto a la vez ----
  // (las columnas de un proyecto no son comparables con las de otro, aunque compartan
  // nombre — cada TableroColumna es propia de su Proyecto — así que este bloque sí
  // necesita un selector, a diferencia de los de arriba).
  protected readonly tiempoPorColumna = computed<TiempoColumna[]>(() => {
    const proyectoId = this.proyectoDetalleId();
    if (!proyectoId) return [];
    const columnasProyecto = this.columnas()
      .filter((c) => Number(c.proyectoId) === proyectoId)
      .sort((a, b) => a.orden - b.orden);
    const ticketsProyecto = this.tickets().filter((t) => Number(t.proyectoId) === proyectoId);
    const idsTicketsProyecto = new Set(ticketsProyecto.map((t) => Number(t.id)));
    const ticketsResueltosIds = new Set(
      ticketsProyecto.filter((t) => this.estaResuelto(t)).map((t) => Number(t.id)),
    );

    const porTicket = new Map<number, TicketHistorialEstado[]>();
    for (const h of this.historial()) {
      if (!idsTicketsProyecto.has(Number(h.ticketId))) continue;
      const arr = porTicket.get(Number(h.ticketId)) ?? [];
      arr.push(h);
      porTicket.set(Number(h.ticketId), arr);
    }

    const acumPorColumna = new Map<number, { totalDias: number; muestras: number }>();
    const ahora = Date.now();
    for (const [ticketId, entradas] of porTicket) {
      const ordenadas = [...entradas].sort((a, b) => (a.fechaCreacion ?? '').localeCompare(b.fechaCreacion ?? ''));
      for (let i = 0; i < ordenadas.length; i++) {
        const entrada = ordenadas[i];
        if (!entrada.fechaCreacion) continue;
        const inicioMs = new Date(entrada.fechaCreacion).getTime();
        const siguiente = ordenadas[i + 1];

        let finMs: number | null;
        if (siguiente?.fechaCreacion) {
          // Tramo cerrado: se movió de esta columna a otra — dato exacto, sin importar
          // si el ticket sigue activo o ya se resolvió.
          finMs = new Date(siguiente.fechaCreacion).getTime();
        } else if (!ticketsResueltosIds.has(ticketId)) {
          // Es el tramo más reciente y el ticket sigue sin resolverse: sigue "corriendo"
          // hasta ahora mismo.
          finMs = ahora;
        } else {
          // Es el tramo más reciente pero el ticket YA se resolvió: no se cuenta — es la
          // columna final (p.ej. "Terminado"), y cuánto lleva ahí no es un cuello de
          // botella, solo cuánto hace que se cerró.
          finMs = null;
        }
        if (finMs === null) continue;

        const dias = Math.max(0, (finMs - inicioMs) / this.MS_POR_DIA);
        const columnaId = Number(entrada.tableroColumnaNuevaId);
        const actual = acumPorColumna.get(columnaId) ?? { totalDias: 0, muestras: 0 };
        actual.totalDias += dias;
        actual.muestras++;
        acumPorColumna.set(columnaId, actual);
      }
    }

    // Tramo inicial (de Ticket.fechaCreacion al primer TicketHistorialEstado, o hasta ahora
    // si el ticket nunca se ha movido) — el bucle de arriba solo recorre TicketHistorialEstado
    // y por eso nunca contaba el tiempo que un ticket pasa en su columna DE ARRANQUE antes de
    // que alguien lo mueva por primera vez (p.ej. cuánto se queda "olvidado" en Backlog/Nuevo),
    // justo el dato que este reporte de cuellos de botella debería mostrar (mismo tramo inicial
    // que reconstruye segmentosDeTicket() en reportes-ejecutivos.component.ts).
    for (const ticket of ticketsProyecto) {
      if (!ticket.fechaCreacion) continue;
      const ticketId = Number(ticket.id);
      const entradas = porTicket.get(ticketId);
      const primera = entradas?.length
        ? [...entradas].sort((a, b) => (a.fechaCreacion ?? '').localeCompare(b.fechaCreacion ?? ''))[0]
        : undefined;
      const columnaInicial = primera
        ? Number(primera.tableroColumnaAnteriorId ?? primera.tableroColumnaNuevaId)
        : Number(ticket.tableroColumnaId);
      const inicioMs = new Date(ticket.fechaCreacion).getTime();

      let finMs: number | null;
      if (primera?.fechaCreacion) {
        // Tramo cerrado: se movió de la columna inicial a otra — dato exacto.
        finMs = new Date(primera.fechaCreacion).getTime();
      } else if (!ticketsResueltosIds.has(ticketId)) {
        // Nunca se ha movido y sigue sin resolverse: sigue "corriendo" hasta ahora mismo.
        finMs = ahora;
      } else {
        // Nunca se ha movido pero ya se resolvió: la columna inicial es también la final,
        // no se cuenta (mismo criterio que arriba).
        finMs = null;
      }
      if (finMs === null) continue;

      const dias = Math.max(0, (finMs - inicioMs) / this.MS_POR_DIA);
      const actual = acumPorColumna.get(columnaInicial) ?? { totalDias: 0, muestras: 0 };
      actual.totalDias += dias;
      actual.muestras++;
      acumPorColumna.set(columnaInicial, actual);
    }

    return columnasProyecto
      .map((c) => {
        const acum = acumPorColumna.get(Number(c.id));
        return {
          id: Number(c.id),
          nombre: c.nombre,
          promedioDias: acum ? Math.round((acum.totalDias / acum.muestras) * 10) / 10 : 0,
          muestras: acum?.muestras ?? 0,
        };
      })
      .filter((c) => c.muestras > 0)
      .sort((a, b) => b.promedioDias - a.promedioDias);
  });

  protected readonly maxTiempoColumna = computed(
    () => Math.max(1, ...this.tiempoPorColumna().map((f) => f.promedioDias)),
  );
}

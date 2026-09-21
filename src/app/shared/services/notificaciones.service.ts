import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { DataClientService } from '../../core/services/data-client.service';
import { Ticket } from '../../features/proyectos/kanban/ticket.model';
import { TicketPrioridad, TicketPrioridadNotificar } from '../../features/proyectos/ticket-prioridades/ticket-prioridad.model';
import { TableroColumna } from '../../features/proyectos/tableros/tablero-columna.model';

const ENTIDAD = 'Notificacion';

/**
 * Notificación real, persistida (ya no la lista fija/hardcodeada que traía
 * ShellComponent). Mismo espíritu que ConfiguracionApariencia: hoy vive en
 * IndexedDB sin backend, pero con un contrato pensado para que encaje el
 * día que se conecte PlataformaSaurix — con una salvedad importante: **esta
 * entidad todavía NO existe en 01_Tablas_Saurix.sql/02_SPs_Saurix.sql**
 * (ver esquema-tablas-saurix.md, sección "Pendiente": "El prototipo tiene
 * un sistema de notificaciones... NO se modeló como tabla... queda
 * pendiente si se decide llevarlo a BD"). Falta agregar la tabla+SPs del
 * lado de Saurix SQL/PlataformaSaurix antes de poder cambiar esto de
 * IndexedDB a la API real.
 */
export interface Notificacion {
  id: number;
  usuarioId: number;
  titulo: string;
  /** Ruta interna (Angular Router) a la que navegar al hacer click, p.ej.
   *  '/proyectos/tablero?ticket=123'. Sin link, la notificación es solo informativa. */
  link?: string;
  leida: boolean;
  fechaCreacion?: string;
}

/**
 * Fuente única de notificaciones reales de la app: SLA por vencer/vencido
 * (revisarSlaTickets(), abajo — llamado periódicamente desde ShellComponent),
 * menciones en comentarios, cambio de estado (avisa a quien reportó/sigue el
 * ticket) y asignación de tickets (estos tres, ver kanban.component.ts) llaman a
 * `notificar()` desde donde ocurre el evento; ShellComponent solo consume
 * `notificaciones()`/`totalNoLeidas()` para pintar la campanita.
 */
@Injectable({ providedIn: 'root' })
export class NotificacionesService {
  private readonly data = inject(DataClientService);
  private readonly auth = inject(AuthService);

  readonly notificaciones = signal<Notificacion[]>([]);
  readonly hayNoLeidas = computed(() => this.notificaciones().some((n) => !n.leida));
  readonly totalNoLeidas = computed(() => this.notificaciones().filter((n) => !n.leida).length);

  private usuarioIdCargado: number | null = null;

  /** Llamar al entrar al shell (login fresco o sesión restaurada) — mismo patrón
   *  que ConfiguracionAparienciaService.cargarParaUsuarioActual(). */
  async cargarParaUsuarioActual(): Promise<void> {
    const usuarioId = this.auth.usuarioActual()?.id;
    if (!usuarioId) {
      this.usuarioIdCargado = null;
      this.notificaciones.set([]);
      return;
    }
    if (this.usuarioIdCargado === usuarioId) return;
    this.usuarioIdCargado = usuarioId;
    await this.recargar(usuarioId);
  }

  private async recargar(usuarioId: number): Promise<void> {
    try {
      const registros = await firstValueFrom(this.data.list<Notificacion>(ENTIDAD, { usuarioId }));
      this.notificaciones.set(
        [...registros].sort((a, b) => (b.fechaCreacion ?? '').localeCompare(a.fechaCreacion ?? '')),
      );
    } catch {
      /* Sin datos disponibles todavía; se deja la lista como estaba. */
    }
  }

  /**
   * Crea una notificación para `usuarioId`. Nunca lanza: quien dispara un evento
   * (asignar un ticket, mencionar a alguien, vencer un SLA) no debe fallar su
   * propia operación si esto no se pudo guardar.
   */
  notificar(usuarioId: number | null | undefined, titulo: string, link?: string): void {
    if (!usuarioId) return;
    this.data.alta<Notificacion>(ENTIDAD, { usuarioId, titulo, link, leida: false }).subscribe({
      next: (registro) => {
        if (usuarioId === this.auth.usuarioActual()?.id) {
          this.notificaciones.update((items) => [registro, ...items]);
        }
      },
      error: (error) => console.warn('No se pudo guardar la notificación:', error),
    });
  }

  marcarLeida(id: number): void {
    const item = this.notificaciones().find((n) => n.id === id);
    if (!item || item.leida) return;
    this.notificaciones.update((items) => items.map((n) => (n.id === id ? { ...n, leida: true } : n)));
    this.data.modificacion<Notificacion>(ENTIDAD, { ...item, leida: true }).subscribe({
      error: (error) => console.warn('No se pudo marcar la notificación como leída:', error),
    });
  }

  marcarTodasLeidas(): void {
    const pendientes = this.notificaciones().filter((n) => !n.leida);
    if (!pendientes.length) return;
    this.notificaciones.update((items) => items.map((n) => ({ ...n, leida: true })));
    for (const n of pendientes) {
      this.data
        .modificacion<Notificacion>(ENTIDAD, { ...n, leida: true })
        .subscribe({ error: (error) => console.warn('No se pudo marcar la notificación como leída:', error) });
    }
  }

  /** Última columna (por orden) del tablero de cada proyecto — mismo criterio de
   *  "resuelto" que Mi Dashboard/Resumen ejecutivo/Kanban (llegar ahí = resuelto). */
  private ultimaColumnaPorProyecto(columnas: TableroColumna[]): Map<number, number> {
    const porProyecto = new Map<number, TableroColumna[]>();
    for (const c of columnas) {
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
  }

  /**
   * Revisión periódica de SLA — cierra el hueco que dejaba el comentario de arriba:
   * hasta ahora NINGÚN ticket avisaba por SLA, pese a que el catálogo de Prioridades
   * ya captura vigenciaHoras/avisoHoras y una lista "avisar también a"
   * (TicketPrioridadNotificar) que nunca se consultaba. Se llama desde ShellComponent
   * (al entrar a la app y luego cada pocos minutos), así no depende de tener abierta
   * ninguna pantalla de Proyectos en particular.
   *
   * Para no mandar el mismo aviso una y otra vez, cada ticket recuerda en
   * Ticket.slaAvisoNivel el nivel ('warning'/'expired') para el que ya se avisó;
   * solo se vuelve a avisar si el nivel escala (de nada a warning, o de warning a
   * expired). Best-effort: cualquier error aquí se traga, nunca debe tumbar el login.
   */
  async revisarSlaTickets(): Promise<void> {
    try {
      const [tickets, prioridades, avisosExtra, columnas] = await Promise.all([
        firstValueFrom(this.data.list<Ticket>('Ticket')),
        firstValueFrom(this.data.list<TicketPrioridad>('TicketPrioridad')),
        firstValueFrom(this.data.list<TicketPrioridadNotificar>('TicketPrioridadNotificar')),
        firstValueFrom(this.data.list<TableroColumna>('TableroColumna')),
      ]);
      const ultimaColumna = this.ultimaColumnaPorProyecto(columnas);
      const ahora = Date.now();

      for (const ticket of tickets) {
        if (ticket.activo === false) continue;
        if (ultimaColumna.get(Number(ticket.proyectoId)) === Number(ticket.tableroColumnaId)) continue; // ya resuelto

        const prioridad = prioridades.find((p) => Number(p.id) === Number(ticket.ticketPrioridadId));
        if (!prioridad?.vigenciaHoras || !ticket.fechaCreacion) continue;

        const creado = new Date(ticket.fechaCreacion).getTime();
        const deadline = creado + prioridad.vigenciaHoras * 3600000;
        const warnAt = deadline - (prioridad.avisoHoras || 0) * 3600000;

        let nivel: 'warning' | 'expired' | null = null;
        if (ahora >= deadline) nivel = 'expired';
        else if (ahora >= warnAt) nivel = 'warning';
        if (!nivel || ticket.slaAvisoNivel === nivel) continue;

        const destinatarios = new Set<number>();
        if (ticket.asignadoUsuarioId) destinatarios.add(Number(ticket.asignadoUsuarioId));
        for (const extra of avisosExtra) {
          if (Number(extra.ticketPrioridadId) === Number(prioridad.id)) destinatarios.add(Number(extra.usuarioId));
        }

        const titulo =
          nivel === 'expired'
            ? `🔥 SLA vencido: #${ticket.numeroTicket} — ${ticket.titulo}`
            : `⏰ SLA por vencer: #${ticket.numeroTicket} — ${ticket.titulo}`;
        const link = `/proyectos/tablero?ticket=${ticket.id}`;
        for (const usuarioId of destinatarios) {
          this.notificar(usuarioId, titulo, link);
        }

        this.data.modificacion<Ticket>('Ticket', { ...ticket, slaAvisoNivel: nivel }).subscribe({
          error: (error) => console.warn('No se pudo marcar el aviso de SLA como enviado:', error),
        });
      }
    } catch (error) {
      console.warn('No se pudo revisar el SLA de los tickets:', error);
    }
  }
}

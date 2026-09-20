import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { DataClientService } from '../../core/services/data-client.service';

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
 * Fuente única de notificaciones reales de la app: SLA (ver kanban), menciones
 * en comentarios (ver kanban) y asignación de tickets (ver kanban) llaman a
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
}

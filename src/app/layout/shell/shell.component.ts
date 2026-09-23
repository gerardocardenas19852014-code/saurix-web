import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { DataClientService } from '../../core/services/data-client.service';
import { MiPerfilComponent } from '../../shared/components/mi-perfil/mi-perfil.component';
import { ToastComponent } from '../../shared/components/toast/toast.component';
import { ConfiguracionAparienciaService } from '../../shared/services/configuracion-apariencia.service';
import { NotificacionesService } from '../../shared/services/notificaciones.service';

interface AiMensaje {
  rol: 'user' | 'bot' | 'pending';
  texto: string;
}

interface DocumentoBuscable {
  id: number;
  titulo?: string;
  contenido?: string;
}

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ToastComponent, MiPerfilComponent, DatePipe],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShellComponent implements OnDestroy {
  private readonly data = inject(DataClientService);
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly configuracionApariencia = inject(ConfiguracionAparienciaService);
  protected readonly notificacionesService = inject(NotificacionesService);

  /** Revisión periódica de SLA (ver NotificacionesService.revisarSlaTickets) — cada
   *  5 minutos mientras la sesión siga abierta, para no depender de tener abierta
   *  ninguna pantalla de Proyectos en particular. */
  private static readonly INTERVALO_REVISION_SLA_MS = 5 * 60 * 1000;
  private intervaloRevisionSla?: ReturnType<typeof setInterval>;

  constructor() {
    // Trae y aplica Tema/Asistente IA/Tamaño de página guardados en la
    // "base de datos" del usuario actual cada vez que se entra al shell
    // (login fresco o sesión restaurada) — no solo lo que había en
    // localStorage de este navegador.
    void this.configuracionApariencia.cargarParaUsuarioActual();
    void this.notificacionesService.cargarParaUsuarioActual();
    void this.notificacionesService.revisarSlaTickets();
    this.intervaloRevisionSla = setInterval(
      () => void this.notificacionesService.revisarSlaTickets(),
      ShellComponent.INTERVALO_REVISION_SLA_MS,
    );
  }

  ngOnDestroy(): void {
    if (this.intervaloRevisionSla) clearInterval(this.intervaloRevisionSla);
  }

  // ── Menú lateral: cada módulo muestra solo su propia sección, nunca la
  // de otro módulo (p.ej. estando en Catálogos no debe verse "Seguridad"). ──
  private readonly urlActual = toSignal(
    this.router.events.pipe(
      filter((evento): evento is NavigationEnd => evento instanceof NavigationEnd),
      map((evento) => evento.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /** El Tablero Kanban (y su vista Lista), Mi Dashboard, Proyectos, Reportes
   *  de horas, Gantt, Resumen ejecutivo y Backlog se ahogan en el ancho de
   *  lectura de 980px que usan el resto de pantallas — con varias columnas o
   *  tablas anchas, ese límite obliga a hacer scroll horizontal sin
   *  necesidad, así que a todas se les da todo el ancho disponible, igual
   *  que a Ticket (ver .content-wide). Backlog se agregó a pedido del
   *  usuario, para que ocupe el mismo ancho que Reportes de horas. */
  private static readonly RUTAS_ANCHO_COMPLETO = [
    '/proyectos/tablero',
    '/proyectos/dashboard',
    '/proyectos/proyectos',
    '/proyectos/reportes-horas',
    '/proyectos/gantt',
    '/proyectos/resumen-ejecutivo',
    '/proyectos/backlog',
    '/proyectos/gestor-estados',
  ];
  protected readonly contenidoAncho = computed(() =>
    ShellComponent.RUTAS_ANCHO_COMPLETO.some((ruta) => this.urlActual().startsWith(ruta)),
  );

  /** El menú de "Gestión de Proyectos" ya tiene 9 enlaces — se agrupan como en su página
   *  "Inicio" (ver proyectos-landing.component.ts: grupos "Proyectos" y "Reportes", mismo
   *  orden) y cada grupo se puede colapsar. Por defecto todos empiezan expandidos; no se
   *  persiste entre sesiones (se reinicia al recargar, igual que sprintsColapsados en Backlog). */
  protected readonly gruposProyectosColapsados = signal<Set<string>>(new Set());

  grupoProyectosAbierto(titulo: string): boolean {
    return !this.gruposProyectosColapsados().has(titulo);
  }

  toggleGrupoProyectos(titulo: string): void {
    this.gruposProyectosColapsados.update((set) => {
      const nuevo = new Set(set);
      if (nuevo.has(titulo)) {
        nuevo.delete(titulo);
      } else {
        nuevo.add(titulo);
      }
      return nuevo;
    });
  }

  protected readonly moduloActivo = computed<
    'seguridad' | 'catalogos' | 'wikidocs' | 'presupuesto' | 'proyectos' | 'panel-control' | null
  >(() => {
    const url = this.urlActual();
    if (url.startsWith('/seguridad')) return 'seguridad';
    if (url.startsWith('/catalogos')) return 'catalogos';
    if (url.startsWith('/wikidocs')) return 'wikidocs';
    if (url.startsWith('/presupuesto')) return 'presupuesto';
    if (url.startsWith('/proyectos')) return 'proyectos';
    if (url.startsWith('/panel-control')) return 'panel-control';
    return null;
  });

  salir(): void {
    this.auth.cerrarSesion();
    this.router.navigateByUrl('/login');
  }

  // ── Notificaciones ────────────────────────────────────────────────
  // Ya no es una lista fija en memoria: NotificacionesService persiste en
  // IndexedDB y la alimentan eventos reales (SLA, menciones, asignación de
  // ticket — ver kanban.component.ts).
  protected readonly notifPanelAbierto = signal(false);
  protected readonly notificaciones = this.notificacionesService.notificaciones;
  protected readonly hayNoLeidas = this.notificacionesService.hayNoLeidas;
  protected readonly totalNoLeidas = this.notificacionesService.totalNoLeidas;

  toggleNotifPanel(): void {
    this.notifPanelAbierto.update((v) => !v);
  }

  /** Marca como leída y, si trae un link, navega ahí (p.ej. abre el ticket directo). */
  abrirNotificacion(n: { id: number; leida: boolean; link?: string }): void {
    this.notificacionesService.marcarLeida(n.id);
    this.notifPanelAbierto.set(false);
    if (n.link) this.router.navigateByUrl(n.link);
  }

  marcarTodasLeidas(): void {
    this.notificacionesService.marcarTodasLeidas();
  }

  // ── Asistente de IA (chat flotante) ──────────────────────────────
  protected readonly aiAbierto = signal(false);
  protected readonly aiMensajes = signal<AiMensaje[]>([]);
  protected readonly aiPregunta = signal('');
  protected readonly aiOcupado = signal(false);

  toggleAiChat(): void {
    this.aiAbierto.update((v) => !v);
  }

  enviarPreguntaAi(): void {
    const pregunta = this.aiPregunta().trim();
    if (!pregunta || this.aiOcupado()) return;

    this.aiMensajes.update((m) => [...m, { rol: 'user', texto: pregunta }, { rol: 'pending', texto: '' }]);
    this.aiPregunta.set('');
    this.aiOcupado.set(true);

    this.data.list<DocumentoBuscable>('Documento').subscribe({
      next: (documentos) => {
        const respuesta = this.buscarRespuesta(pregunta, documentos);
        this.aiMensajes.update((m) => [...m.slice(0, -1), { rol: 'bot', texto: respuesta }]);
        this.aiOcupado.set(false);
      },
      error: () => {
        this.aiMensajes.update((m) => [
          ...m.slice(0, -1),
          { rol: 'bot', texto: 'No pude buscar en la documentación en este momento.' },
        ]);
        this.aiOcupado.set(false);
      },
    });
  }

  private buscarRespuesta(pregunta: string, documentos: DocumentoBuscable[]): string {
    const palabras = pregunta
      .toLowerCase()
      .split(/\s+/)
      .filter((p) => p.length > 3);

    const coincidencias = documentos.filter((d) =>
      palabras.some(
        (p) => d.titulo?.toLowerCase().includes(p) || d.contenido?.toLowerCase().includes(p),
      ),
    );

    if (palabras.length === 0) {
      return 'Cuéntame un poco más para poder buscar en WikiDocs.';
    }
    if (coincidencias.length === 0) {
      return 'No encontré nada relacionado en WikiDocs todavía. Prueba con otras palabras, o crea un documento sobre este tema.';
    }
    const lista = coincidencias
      .slice(0, 3)
      .map((d) => `• ${d.titulo ?? 'Documento sin título'}`)
      .join('\n');
    return `Encontré esto en WikiDocs:\n${lista}`;
  }
}

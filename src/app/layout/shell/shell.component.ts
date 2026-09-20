import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { DataClientService } from '../../core/services/data-client.service';
import { MiPerfilComponent } from '../../shared/components/mi-perfil/mi-perfil.component';
import { ToastComponent } from '../../shared/components/toast/toast.component';
import { ConfiguracionAparienciaService } from '../../shared/services/configuracion-apariencia.service';

interface NotifItem {
  id: number;
  titulo: string;
  meta: string;
  leida: boolean;
}

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
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ToastComponent, MiPerfilComponent],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShellComponent {
  private readonly data = inject(DataClientService);
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly configuracionApariencia = inject(ConfiguracionAparienciaService);

  constructor() {
    // Trae y aplica Tema/Asistente IA/Tamaño de página guardados en la
    // "base de datos" del usuario actual cada vez que se entra al shell
    // (login fresco o sesión restaurada) — no solo lo que había en
    // localStorage de este navegador.
    void this.configuracionApariencia.cargarParaUsuarioActual();
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

  protected readonly moduloActivo = computed<
    'seguridad' | 'catalogos' | 'wikidocs' | 'presupuesto' | 'proyectos' | null
  >(() => {
    const url = this.urlActual();
    if (url.startsWith('/seguridad')) return 'seguridad';
    if (url.startsWith('/catalogos')) return 'catalogos';
    if (url.startsWith('/wikidocs')) return 'wikidocs';
    if (url.startsWith('/presupuesto')) return 'presupuesto';
    if (url.startsWith('/proyectos')) return 'proyectos';
    return null;
  });

  salir(): void {
    this.auth.cerrarSesion();
    this.router.navigateByUrl('/login');
  }

  // ── Notificaciones ────────────────────────────────────────────────
  protected readonly notifPanelAbierto = signal(false);
  protected readonly notificaciones = signal<NotifItem[]>([
    { id: 1, titulo: 'Bienvenido a Saurix', meta: 'Sistema · ahora', leida: false },
  ]);
  protected readonly hayNoLeidas = computed(() => this.notificaciones().some((n) => !n.leida));
  protected readonly totalNoLeidas = computed(() => this.notificaciones().filter((n) => !n.leida).length);

  toggleNotifPanel(): void {
    this.notifPanelAbierto.update((v) => !v);
  }

  marcarLeida(id: number): void {
    this.notificaciones.update((items) => items.map((n) => (n.id === id ? { ...n, leida: true } : n)));
  }

  marcarTodasLeidas(): void {
    this.notificaciones.update((items) => items.map((n) => ({ ...n, leida: true })));
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

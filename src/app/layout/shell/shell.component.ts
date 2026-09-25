import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, HostListener, OnDestroy, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { ComandoPaletaComponent } from '../../shared/components/comando-paleta/comando-paleta.component';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';
import { DESTINOS } from '../../shared/utils/navegacion-destinos.util';
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
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    ToastComponent,
    MiPerfilComponent,
    DatePipe,
    ComandoPaletaComponent,
    ConfirmDialogComponent,
  ],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShellComponent implements OnDestroy {
  /** Cierra el modal/diálogo abierto con Escape, igual que ya hace el clic
   *  afuera de la caja (.modal-overlay) en cada pantalla — a pedido del
   *  usuario. Un solo listener aquí, en vez de tocar los 30+ archivos que
   *  traen su propio ".modal-overlay": se busca el overlay visible y se le
   *  dispara un click de verdad, así cada pantalla sigue decidiendo con su
   *  propio (click) si eso la cierra o no (algunos modales de Kanban, por
   *  ejemplo, deliberadamente NO cierran con clic afuera para no perder un
   *  formulario largo a medias — con Escape pasa exactamente lo mismo, sin
   *  tener que duplicar esa regla aquí). Si hay más de un overlay en el DOM
   *  (poco común), se usa el último — el más reciente en abrirse. */
  @HostListener('document:keydown.escape')
  protected cerrarModalConEscape(): void {
    const overlays = document.querySelectorAll<HTMLElement>('.modal-overlay');
    overlays[overlays.length - 1]?.click();
  }

  // ── Aviso de cambios sin guardar al cerrar un modal ──────────────────
  // Cubre los dos caminos que YA cierran cualquier modal de forma
  // centralizada (clic afuera de la caja y Escape, ver
  // cerrarModalConEscape arriba: Escape termina disparando un .click()
  // real sobre el overlay, así que interceptar el clic alcanza para los
  // dos casos con un solo mecanismo). NO cubre un botón "Cancelar" o "✕"
  // propio de cada pantalla que cierre el modal sin pasar por el overlay
  // — son 30+ archivos con su propio marcado, y detectarlos todos de forma
  // genérica es mucho más frágil; se dejó fuera de alcance a propósito.
  //
  // "Sucio" se decide comparando, campo por campo, el valor que tenía un
  // input/textarea/select AL MOMENTO DE ABRIRSE el modal (capturado por el
  // MutationObserver de abajo apenas aparece el overlay en el DOM) contra
  // su valor actual. Los campos se identifican por referencia de elemento
  // (WeakMap), nunca por nombre/posición: un campo que aparece después
  // (p.ej. al cambiar de pestaña dentro de un modal con tabs, como el de
  // Ticket en Kanban) simplemente no tiene valor inicial registrado y se
  // ignora — así un cambio de pestaña nunca se confunde con una edición
  // real, aunque eso también signifique que una edición hecha en una
  // pestaña que ya no está montada puede pasar desapercibida (se prefirió
  // no molestar de más antes que interrumpir de más).
  private readonly valoresInicialesPorCampo = new WeakMap<Element, string>();
  private readonly overlaysConSnapshot = new WeakSet<Element>();
  private readonly cerrandoSinAviso = new WeakSet<Element>();
  private observadorModales?: MutationObserver;
  private overlayPendienteDeCierre: HTMLElement | null = null;
  protected readonly avisoCierreVisible = signal(false);

  private registrarSnapshotSiEsOverlay(nodo: Node): void {
    if (!(nodo instanceof HTMLElement)) return;
    const overlays = nodo.classList.contains('modal-overlay')
      ? [nodo]
      : Array.from(nodo.querySelectorAll<HTMLElement>('.modal-overlay'));
    for (const overlay of overlays) {
      if (this.overlaysConSnapshot.has(overlay)) continue;
      this.overlaysConSnapshot.add(overlay);
      this.camposDe(overlay).forEach((campo) =>
        this.valoresInicialesPorCampo.set(campo, this.valorDeCampo(campo)),
      );
    }
  }

  private camposDe(raiz: Element): (HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)[] {
    return Array.from(raiz.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      'input, textarea, select',
    ));
  }

  private valorDeCampo(campo: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string {
    if (campo instanceof HTMLInputElement && (campo.type === 'checkbox' || campo.type === 'radio')) {
      return String(campo.checked);
    }
    return campo.value;
  }

  private hayFormularioSucio(overlay: HTMLElement): boolean {
    for (const campo of this.camposDe(overlay)) {
      const inicial = this.valoresInicialesPorCampo.get(campo);
      if (inicial === undefined) continue;
      if (this.valorDeCampo(campo) !== inicial) return true;
    }
    return false;
  }

  private readonly interceptarCierreDeModal = (evento: MouseEvent): void => {
    const objetivo = evento.target;
    if (!(objetivo instanceof HTMLElement) || !objetivo.classList.contains('modal-overlay')) return;
    if (this.cerrandoSinAviso.delete(objetivo)) return;
    if (!this.hayFormularioSucio(objetivo)) return;

    evento.preventDefault();
    evento.stopPropagation();
    this.overlayPendienteDeCierre = objetivo;
    this.avisoCierreVisible.set(true);
  };

  protected confirmarCierrePendiente(): void {
    const overlay = this.overlayPendienteDeCierre;
    this.avisoCierreVisible.set(false);
    this.overlayPendienteDeCierre = null;
    if (!overlay) return;
    this.cerrandoSinAviso.add(overlay);
    overlay.click();
  }

  protected cancelarCierrePendiente(): void {
    this.avisoCierreVisible.set(false);
    this.overlayPendienteDeCierre = null;
  }

  /** Atajo "/" para saltar directo al buscador de texto de la pantalla
   *  activa (Ctrl/Cmd+K queda reservado para la futura paleta de comandos,
   *  tarea aparte). Todas las pantallas con un buscador principal usan
   *  <input type="search"> — es la convención ya existente en toda la app
   *  (Movimientos, Kanban, Dashboard, Backlog, catálogos vía
   *  CatalogoSimpleComponent, Usuarios, WikiDocs, etc.) — así que no hace
   *  falta tocar cada pantalla una por una: se busca el primer
   *  input[type="search"] visible, priorizando uno que no esté dentro de
   *  un modal abierto. Si el foco ya está en otro campo de texto (el
   *  usuario está escribiendo), no se interfiere. */
  @HostListener('document:keydown', ['$event'])
  protected enfocarBuscadorConBarra(evento: KeyboardEvent): void {
    if (evento.key !== '/' || evento.ctrlKey || evento.metaKey || evento.altKey) return;

    const activo = document.activeElement;
    const escribiendo =
      activo instanceof HTMLElement &&
      (activo.tagName === 'INPUT' ||
        activo.tagName === 'TEXTAREA' ||
        activo.tagName === 'SELECT' ||
        activo.isContentEditable);
    if (escribiendo) return;

    const buscadores = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="search"]'),
    ).filter((input) => input.offsetParent !== null);
    if (buscadores.length === 0) return;

    const objetivo = buscadores.find((input) => !input.closest('.modal-overlay')) ?? buscadores[0];

    evento.preventDefault();
    objetivo.focus();
    objetivo.select();
  }

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
    this.revisarNotificacionesPeriodicas();
    this.intervaloRevisionSla = setInterval(
      () => this.revisarNotificacionesPeriodicas(),
      ShellComponent.INTERVALO_REVISION_SLA_MS,
    );
    this.mediaQuerySidebarAngosta.addEventListener('change', this.onCambioSidebarAngosta);

    // Aviso de cambios sin guardar (ver comentario largo junto a
    // hayFormularioSucio más abajo): hay que escuchar el clic en fase de
    // CAPTURA (tercer argumento `true`) para poder interceptarlo antes de
    // que llegue al propio (click) del overlay que ya cierra cada modal.
    document.addEventListener('click', this.interceptarCierreDeModal, true);
    this.observadorModales = new MutationObserver((mutaciones) => {
      for (const mutacion of mutaciones) {
        mutacion.addedNodes.forEach((nodo) => this.registrarSnapshotSiEsOverlay(nodo));
      }
    });
    this.observadorModales.observe(document.body, { childList: true, subtree: true });
  }

  /** SLA de tickets + alertas de tarjeta (uso ≥90%, recordatorio de pago) — mismo
   *  intervalo, así ninguna pantalla en particular necesita estar abierta. */
  private revisarNotificacionesPeriodicas(): void {
    void this.notificacionesService.revisarSlaTickets();
    void this.notificacionesService.revisarAlertasTarjetas();
  }

  ngOnDestroy(): void {
    if (this.intervaloRevisionSla) clearInterval(this.intervaloRevisionSla);
    this.mediaQuerySidebarAngosta.removeEventListener('change', this.onCambioSidebarAngosta);
    document.removeEventListener('click', this.interceptarCierreDeModal, true);
    this.observadorModales?.disconnect();
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
    '/proyectos/balanceo',
    '/proyectos/reportes-ejecutivos',
  ];
  protected readonly contenidoAncho = computed(() =>
    ShellComponent.RUTAS_ANCHO_COMPLETO.some((ruta) => this.urlActual().startsWith(ruta)),
  );

  /** Breadcrumb genérico "de vuelta al Inicio del módulo", derivado de la
   *  misma lista de destinos que ya usa la paleta de comandos (Ctrl/Cmd+K)
   *  — nada que mantener por separado. Solo se muestra en una pantalla
   *  "anidada" (cualquiera que no sea el Inicio del módulo): en el propio
   *  Inicio mostrar "Presupuesto Personal › Inicio" no aporta nada, ya que
   *  ese Inicio ES la raíz. */
  protected readonly migajaActual = computed(() => {
    const url = this.urlActual();
    const destino = DESTINOS.find((d) => d.ruta === url);
    if (!destino || destino.label === 'Inicio') return null;
    const inicioModulo = DESTINOS.find((d) => d.grupo === destino.grupo && d.label === 'Inicio');
    return { ...destino, rutaInicioModulo: inicioModulo?.ruta ?? null };
  });

  /** Menús laterales con muchos enlaces (Gestión de Proyectos, Catálogos,
   *  Presupuesto Personal) agrupan sus enlaces en secciones colapsables,
   *  igual que "Inicio" de Gestión de Proyectos ya lo hacía (grupos
   *  "Procesos", "Configuración" y "Reportes"). La clave es `modulo:titulo`
   *  para que un mismo nombre de grupo en dos módulos (p.ej. "Reportes" en
   *  Proyectos y en Presupuesto) no comparta estado. Por defecto empiezan
   *  CERRADOS (pedido explícito del usuario); no se persiste entre sesiones
   *  (se reinicia al recargar, igual que sprintsExpandidos en Backlog). */
  protected readonly gruposColapsados = signal<Set<string>>(
    new Set([
      'proyectos:Procesos',
      'proyectos:Configuracion',
      'proyectos:Reportes',
      'presupuesto:Movimientos',
      'presupuesto:Metas y límites',
      'presupuesto:Reportes',
      'presupuesto:Catálogos',
    ]),
  );

  /** Mismo punto de corte que el @media de src/styles.scss que oculta
   *  .sidebar-group-toggle (la barra lateral pasa a ser una barra superior
   *  horizontal). Si un grupo arranca cerrado (ver gruposColapsados) y su
   *  único botón para abrirlo desaparece por CSS en ese ancho, sus enlaces
   *  quedan inalcanzables para siempre en pantallas angostas — por eso
   *  grupoAbierto() ignora el colapso y muestra todo expandido ahí abajo. */
  private static readonly BREAKPOINT_SIDEBAR_ANGOSTA = '(max-width: 860px)';
  private readonly mediaQuerySidebarAngosta = window.matchMedia(
    ShellComponent.BREAKPOINT_SIDEBAR_ANGOSTA,
  );
  protected readonly sidebarAngosta = signal(this.mediaQuerySidebarAngosta.matches);
  private readonly onCambioSidebarAngosta = (evento: MediaQueryListEvent): void => {
    this.sidebarAngosta.set(evento.matches);
  };

  grupoAbierto(modulo: string, titulo: string): boolean {
    if (this.sidebarAngosta()) return true;
    return !this.gruposColapsados().has(`${modulo}:${titulo}`);
  }

  toggleGrupo(modulo: string, titulo: string): void {
    this.gruposColapsados.update((set) => {
      const nuevo = new Set(set);
      const clave = `${modulo}:${titulo}`;
      if (nuevo.has(clave)) {
        nuevo.delete(clave);
      } else {
        nuevo.add(clave);
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

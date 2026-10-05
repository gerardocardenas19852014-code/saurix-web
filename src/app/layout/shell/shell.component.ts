import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, HostListener, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, forkJoin, map } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { ComandoPaletaComponent } from '../../shared/components/comando-paleta/comando-paleta.component';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';
import { DESTINOS } from '../../shared/utils/navegacion-destinos.util';
import { DataClientService } from '../../core/services/data-client.service';
import { MiPerfilComponent } from '../../shared/components/mi-perfil/mi-perfil.component';
import { ToastComponent } from '../../shared/components/toast/toast.component';
import { ConfiguracionAparienciaService } from '../../shared/services/configuracion-apariencia.service';
import { NotificacionesService } from '../../shared/services/notificaciones.service';
import { Ticket } from '../../features/proyectos/kanban/ticket.model';
import { MovimientoPresupuesto } from '../../features/presupuesto/movimientos/movimiento.model';
import { MiembroFamilia } from '../../features/familia/miembro-familia.model';
import { TableroColumna } from '../../features/proyectos/tableros/tablero-columna.model';
import { CuentaPresupuesto } from '../../features/presupuesto/cuenta-presupuesto/cuenta-presupuesto.model';
import { CategoriaPresupuesto } from '../../features/presupuesto/categoria-presupuesto/categoria-presupuesto.model';
import { DeudaPresupuesto } from '../../features/presupuesto/deudas/deuda.model';

/** Un resultado de búsqueda del asistente, clicable: navega directo a esa
 *  pantalla con el registro ya abierto (mismo patrón de deep link que
 *  Kanban ya usaba con ?ticket=, extendido ahora a Movimientos/Documentos/
 *  Miembros — ver cada *.component.ts). Sin queryParams, el enlace solo
 *  lleva a la pantalla del catálogo (caso de Cuentas/Categorías). */
interface AiEnlace {
  texto: string;
  ruta: string;
  queryParams?: Record<string, number | string>;
}

interface AiSeccion {
  titulo: string;
  enlaces: AiEnlace[];
}

interface AiMensaje {
  rol: 'user' | 'bot' | 'pending';
  texto: string;
  /** Presente solo en resultados de búsqueda con coincidencias (ver buscarRespuesta). */
  secciones?: AiSeccion[];
}

interface DocumentoBuscable {
  id: number;
  titulo?: string;
  contenido?: string;
  activo?: boolean;
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
  /** Gatea el botón flotante del Asistente IA (ver ai-fab/ai-panel en la plantilla):
   *  si está apagado en Apariencia, el asistente no se muestra en ningún módulo. */
  protected readonly asistenteIaActivo = this.configuracionApariencia.asistenteIaActivo;
  protected readonly notificacionesService = inject(NotificacionesService);

  /** Revisión periódica de SLA (ver NotificacionesService.revisarSlaTickets) — cada
   *  5 minutos mientras la sesión siga abierta, para no depender de tener abierta
   *  ninguna pantalla de Proyectos en particular. */
  private static readonly INTERVALO_REVISION_SLA_MS = 5 * 60 * 1000;
  private intervaloRevisionSla?: ReturnType<typeof setInterval>;

  constructor() {
    // Restaura la posición del botón del asistente si el usuario ya lo
    // había arrastrado antes en este navegador (ver aiFabPos arriba).
    this.cargarPosicionAiGuardada();

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
    effect(() => {
      this.urlActual();
      this.menuMovilAbierto.set(false);
    });
    effect(() => {
      if (!this.asistenteIaActivo() && this.aiAbierto()) {
        this.aiAbierto.set(false);
      }
    });

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
   *  usuario, para que ocupe el mismo ancho que Reportes de horas. Tipos de
   *  Ticket, Prioridades y Módulos se agregaron también a pedido del
   *  usuario — sus tablas (hasta 8 columnas en Prioridades) se veían igual
   *  de apretadas en 980px. */
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
    '/proyectos/tipos-ticket',
    '/proyectos/prioridades',
    '/proyectos/modulos',
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
      'familia:Catálogos',
      'wikidocs:Catálogos',
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

  /** Menú lateral completo, escondido detrás de un botón "☰" en pantallas
   *  angostas (ver .sidebar-menu-toggle en styles.scss): antes, en celular,
   *  TODOS los enlaces de un módulo (hasta 13 en Presupuesto) quedaban
   *  siempre visibles y empujaban el contenido real fuera de la pantalla —
   *  había que hacer scroll por todo el menú antes de ver nada. Arranca
   *  cerrado y se cierra solo al navegar (abajo), para no taparle la
   *  pantalla completa al usuario después de elegir una opción. En
   *  escritorio (sidebarAngosta() === false) esta bandera no tiene efecto:
   *  el menú siempre se ve, como antes. */
  protected readonly menuMovilAbierto = signal(false);

  toggleMenuMovil(): void {
    this.menuMovilAbierto.update((v) => !v);
  }

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
    'seguridad' | 'wikidocs' | 'presupuesto' | 'proyectos' | 'panel-control' | 'familia' | null
  >(() => {
    const url = this.urlActual();
    if (url.startsWith('/seguridad')) return 'seguridad';
    if (url.startsWith('/wikidocs')) return 'wikidocs';
    if (url.startsWith('/presupuesto')) return 'presupuesto';
    if (url.startsWith('/proyectos')) return 'proyectos';
    if (url.startsWith('/panel-control')) return 'panel-control';
    if (url.startsWith('/familia')) return 'familia';
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

  /** Posición del botón flotante (en px, viewport). null = sin arrastrar
   *  todavía: usa la posición fija de siempre (esquina inferior derecha,
   *  definida en styles.scss). Se guarda en localStorage de este navegador
   *  (es solo una conveniencia visual de este dispositivo, no un dato de
   *  negocio) para que no "se le olvide" dónde la dejó el usuario. */
  private static readonly CLAVE_POSICION_AI = 'saurix.ai.fab.pos';
  private static readonly AI_FAB_PX = 54;
  private static readonly AI_MARGEN_PX = 8;
  protected readonly aiFabPos = signal<{ left: number; top: number } | null>(null);

  /** Dónde debe abrir el panel del chat dada la posición actual del botón:
   *  se recalcula sola (es un computed) cada vez que aiFabPos cambia, y
   *  "voltea" hacia el lado con espacio (arriba/abajo, izquierda/derecha)
   *  para que el panel nunca quede cortado fuera de la pantalla. */
  protected readonly aiPanelPos = computed(() => {
    const fab = this.aiFabPos();
    if (!fab) return null;

    const gap = 12;
    const anchoPanel = Math.min(360, window.innerWidth - 32);
    const altoPanel = Math.min(480, window.innerHeight - 32);

    const espacioAbajo = window.innerHeight - (fab.top + ShellComponent.AI_FAB_PX);
    const top =
      espacioAbajo >= altoPanel + gap
        ? fab.top + ShellComponent.AI_FAB_PX + gap // cabe abajo del botón
        : fab.top - gap - altoPanel; // no cabe: se abre hacia arriba

    let left = fab.left + ShellComponent.AI_FAB_PX - anchoPanel; // alinea el borde derecho del panel con el del botón
    left = Math.min(Math.max(left, ShellComponent.AI_MARGEN_PX), window.innerWidth - anchoPanel - ShellComponent.AI_MARGEN_PX);
    const topClamp = Math.min(
      Math.max(top, ShellComponent.AI_MARGEN_PX),
      window.innerHeight - altoPanel - ShellComponent.AI_MARGEN_PX,
    );

    return { left, top: topClamp };
  });

  private arrastrandoAi = false;
  private aiSeArrastro = false;
  private arrastreAiInicio = { x: 0, y: 0, left: 0, top: 0 };

  private cargarPosicionAiGuardada(): void {
    try {
      const guardada = localStorage.getItem(ShellComponent.CLAVE_POSICION_AI);
      if (!guardada) return;
      const pos = JSON.parse(guardada) as { left: number; top: number };
      if (typeof pos?.left === 'number' && typeof pos?.top === 'number') {
        this.aiFabPos.set(this.clampPosicionAi(pos.left, pos.top));
      }
    } catch {
      // Posición guardada corrupta o localStorage no disponible: se usa la posición por defecto.
    }
  }

  /** Limita una posición propuesta para que el botón (54x54) quede siempre
   *  completo dentro de la ventana actual, con un pequeño margen. */
  private clampPosicionAi(left: number, top: number): { left: number; top: number } {
    const maxLeft = window.innerWidth - ShellComponent.AI_FAB_PX - ShellComponent.AI_MARGEN_PX;
    const maxTop = window.innerHeight - ShellComponent.AI_FAB_PX - ShellComponent.AI_MARGEN_PX;
    return {
      left: Math.min(Math.max(left, ShellComponent.AI_MARGEN_PX), Math.max(maxLeft, ShellComponent.AI_MARGEN_PX)),
      top: Math.min(Math.max(top, ShellComponent.AI_MARGEN_PX), Math.max(maxTop, ShellComponent.AI_MARGEN_PX)),
    };
  }

  /** Mantener presionado el botón y arrastrar lo mueve a cualquier parte de
   *  la pantalla (para sacarlo de encima de algo que tape); un clic normal
   *  (sin moverse) lo sigue abriendo/cerrando como siempre — ver
   *  aiSeArrastro en toggleAiChat(). */
  protected iniciarArrastreAi(evento: PointerEvent): void {
    const boton = evento.currentTarget as HTMLElement;
    const rect = boton.getBoundingClientRect();
    this.arrastrandoAi = true;
    this.aiSeArrastro = false;
    this.arrastreAiInicio = { x: evento.clientX, y: evento.clientY, left: rect.left, top: rect.top };
  }

  @HostListener('document:pointermove', ['$event'])
  protected onArrastreAiMover(evento: PointerEvent): void {
    if (!this.arrastrandoAi) return;
    const dx = evento.clientX - this.arrastreAiInicio.x;
    const dy = evento.clientY - this.arrastreAiInicio.y;
    if (!this.aiSeArrastro && Math.hypot(dx, dy) < 4) return; // umbral: todavía podría ser un clic
    this.aiSeArrastro = true;
    this.aiFabPos.set(this.clampPosicionAi(this.arrastreAiInicio.left + dx, this.arrastreAiInicio.top + dy));
  }

  @HostListener('document:pointerup')
  protected onArrastreAiSoltar(): void {
    if (!this.arrastrandoAi) return;
    this.arrastrandoAi = false;
    const pos = this.aiFabPos();
    if (this.aiSeArrastro && pos) {
      try {
        localStorage.setItem(ShellComponent.CLAVE_POSICION_AI, JSON.stringify(pos));
      } catch {
        // localStorage puede fallar (modo privado, cuota llena, etc.) — no es crítico, solo no se recuerda la posición.
      }
    }
  }

  @HostListener('window:resize')
  protected onResizeReclampAi(): void {
    const pos = this.aiFabPos();
    if (pos) this.aiFabPos.set(this.clampPosicionAi(pos.left, pos.top));
  }

  toggleAiChat(): void {
    if (this.aiSeArrastro) {
      // El clic que sigue a un arrastre no debe abrir/cerrar el panel.
      this.aiSeArrastro = false;
      return;
    }
    const seVaAAbrir = !this.aiAbierto();
    this.aiAbierto.update((v) => !v);
    if (seVaAAbrir && this.aiMensajes().length === 0) {
      this.mostrarAvisoProactivoAi();
    }
  }

  /** Al abrir el chat por primera vez (todavía sin mensajes), adelanta sin
   *  que se pregunte nada lo mismo que ya avisa la campanita 🔔 (SLA de
   *  tickets por vencer, alertas de tarjeta — ver NotificacionesService):
   *  reutiliza esas notificaciones ya calculadas, no vuelve a calcular nada. */
  private mostrarAvisoProactivoAi(): void {
    const pendientes = this.notificacionesService.notificaciones().filter((n) => !n.leida);
    if (pendientes.length === 0) return;
    const lista = pendientes
      .slice(0, 3)
      .map((n) => ({ texto: n.titulo, ruta: n.link } as { texto: string; ruta?: string }));
    const extra = pendientes.length > 3 ? ` y ${pendientes.length - 3} más (revisa la campanita 🔔)` : '';
    this.aiMensajes.update((m) => [
      ...m,
      {
        rol: 'bot',
        texto: `Antes de que preguntes algo, esto tienes pendiente${extra}:`,
        secciones: [
          {
            titulo: '🔔 Pendientes',
            enlaces: lista.map((l) => this.enlaceDesdeRutaCompleta(l.texto, l.ruta)),
          },
        ],
      },
    ]);
  }

  /** Notificacion.link viene como string completo tipo '/proyectos/tablero?ticket=123'
   *  (ver NotificacionesService) — se separa en ruta+queryParams para usarlo
   *  como [routerLink]/[queryParams], igual que el resto de enlaces del asistente. */
  private enlaceDesdeRutaCompleta(texto: string, rutaCompleta?: string): AiEnlace {
    if (!rutaCompleta) return { texto, ruta: '' };
    const [ruta, query] = rutaCompleta.split('?');
    const queryParams: Record<string, string> = {};
    if (query) {
      for (const par of query.split('&')) {
        const [clave, valor] = par.split('=');
        if (clave) queryParams[decodeURIComponent(clave)] = decodeURIComponent(valor ?? '');
      }
    }
    return { texto, ruta, queryParams: query ? queryParams : undefined };
  }

  enviarPreguntaAi(): void {
    const pregunta = this.aiPregunta().trim();
    if (!pregunta || this.aiOcupado()) return;

    this.aiMensajes.update((m) => [...m, { rol: 'user', texto: pregunta }, { rol: 'pending', texto: '' }]);
    this.aiPregunta.set('');
    this.aiOcupado.set(true);

    // Busca/calcula en paralelo sobre las fuentes con las que hoy puede ayudar
    // el asistente: documentación (WikiDocs), tickets+columnas (Gestión de
    // Proyectos), movimientos+cuentas+categorías+deudas (Presupuesto Personal)
    // y directorio (Familia). Sigue sin ser un modelo de lenguaje real: primero
    // intenta reconocer una pregunta de cálculo (calcularRespuestaAi) y, si no
    // reconoce ninguna, cae a la búsqueda por palabra clave de siempre.
    forkJoin({
      documentos: this.data.list<DocumentoBuscable>('Documento'),
      tickets: this.data.list<Ticket>('Ticket'),
      columnas: this.data.list<TableroColumna>('TableroColumna'),
      movimientos: this.data.list<MovimientoPresupuesto>('MovimientoPresupuesto'),
      cuentas: this.data.list<CuentaPresupuesto>('CuentaPresupuesto'),
      categorias: this.data.list<CategoriaPresupuesto>('CategoriaPresupuesto'),
      deudas: this.data.list<DeudaPresupuesto>('DeudaPresupuesto'),
      miembros: this.data.list<MiembroFamilia>('MiembroFamilia'),
    }).subscribe({
      next: (fuentes) => {
        const calculo = this.calcularRespuestaAi(pregunta, fuentes);
        const respuesta = calculo ?? this.buscarRespuesta(pregunta, fuentes);
        this.aiMensajes.update((m) => [
          ...m.slice(0, -1),
          { rol: 'bot', texto: respuesta.texto, secciones: respuesta.secciones },
        ]);
        this.aiOcupado.set(false);
      },
      error: () => {
        this.aiMensajes.update((m) => [
          ...m.slice(0, -1),
          { rol: 'bot', texto: 'No pude buscar en el sistema en este momento.' },
        ]);
        this.aiOcupado.set(false);
      },
    });
  }

  /** Reconoce un pequeño número de preguntas de cálculo (no es un modelo de
   *  lenguaje: son patrones fijos) y devuelve la respuesta ya calculada sobre
   *  datos reales; null si la pregunta no encaja en ninguno, para que
   *  enviarPreguntaAi() caiga a la búsqueda por palabra clave normal. Todas
   *  requieren una palabra interrogativa ("cuant...") para no dispararse con
   *  una búsqueda de texto normal que simplemente contenga "gasto"/"deuda". */
  private calcularRespuestaAi(
    pregunta: string,
    fuentes: {
      tickets: Ticket[];
      columnas: TableroColumna[];
      movimientos: MovimientoPresupuesto[];
      deudas: DeudaPresupuesto[];
    },
  ): { texto: string; secciones?: AiSeccion[] } | null {
    const normalizar = (valor: string | null | undefined): string =>
      (valor ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase();
    const p = normalizar(pregunta);
    const esInterrogativa = /\bcuant|\bcual\b|\bque tanto/.test(p);
    if (!esInterrogativa) return null;

    const mesActual = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
    const movimientosDelMes = fuentes.movimientos.filter(
      (m) => (m.activo ?? true) && !m.proyectado && m.fecha?.startsWith(mesActual),
    );
    const sumaPorTipo = (contiene: string): number =>
      movimientosDelMes
        .filter((m) => normalizar(m.tipo).includes(contiene))
        .reduce((total, m) => total + m.monto, 0);
    const moneda = (valor: number): string =>
      valor.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

    if (/gast/.test(p)) {
      const total = sumaPorTipo('gasto');
      return { texto: `Llevas ${moneda(total)} en gastos este mes (${movimientosDelMes.filter((m) => normalizar(m.tipo).includes('gasto')).length} movimientos).` };
    }
    if (/ingres/.test(p)) {
      const total = sumaPorTipo('ingreso');
      return { texto: `Llevas ${moneda(total)} en ingresos este mes.` };
    }
    if (/saldo|balance/.test(p)) {
      const balance = sumaPorTipo('ingreso') - sumaPorTipo('gasto');
      return { texto: `Tu balance de este mes (ingresos − gastos) es ${moneda(balance)}.` };
    }
    if (/ticket/.test(p) && /abiert|pendient|hay/.test(p)) {
      const ultimaColumnaPorProyecto = new Map<number, number>();
      const porProyecto = new Map<number, TableroColumna[]>();
      for (const c of fuentes.columnas) {
        const arr = porProyecto.get(Number(c.proyectoId)) ?? [];
        arr.push(c);
        porProyecto.set(Number(c.proyectoId), arr);
      }
      for (const [proyectoId, cols] of porProyecto) {
        const ultima = [...cols].sort((a, b) => a.orden - b.orden).at(-1);
        if (ultima) ultimaColumnaPorProyecto.set(proyectoId, Number(ultima.id));
      }
      const abiertos = fuentes.tickets.filter(
        (t) => t.activo && ultimaColumnaPorProyecto.get(Number(t.proyectoId)) !== Number(t.tableroColumnaId),
      );
      return { texto: `Tienes ${abiertos.length} ticket${abiertos.length === 1 ? '' : 's'} abierto${abiertos.length === 1 ? '' : 's'} (sin contar los que ya llegaron a la última columna del tablero).` };
    }
    if (/deb|deuda/.test(p)) {
      const activas = fuentes.deudas.filter((d) => d.activo && d.saldoActual > 0);
      const total = activas.reduce((suma, d) => suma + d.saldoActual, 0);
      if (activas.length === 0) return { texto: 'No tienes deudas con saldo pendiente registradas.' };
      return { texto: `Debes ${moneda(total)} en total, en ${activas.length} deuda${activas.length === 1 ? '' : 's'} pendiente${activas.length === 1 ? '' : 's'}.` };
    }

    return null;
  }

  private buscarRespuesta(
    pregunta: string,
    fuentes: {
      documentos: DocumentoBuscable[];
      tickets: Ticket[];
      movimientos: MovimientoPresupuesto[];
      cuentas: CuentaPresupuesto[];
      categorias: CategoriaPresupuesto[];
      miembros: MiembroFamilia[];
    },
  ): { texto: string; secciones?: AiSeccion[] } {
    // Insensible a acentos (busca "sotano" y encuentra "sótano", y viceversa)
    // y por coincidencia parcial: "Indri" encuentra "InDriver" porque se
    // revisa con includes(), no con igualdad exacta de palabra completa.
    const normalizar = (valor: string | null | undefined): string =>
      (valor ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase();

    const palabras = normalizar(pregunta)
      .split(/\s+/)
      .filter((p) => p.length > 3);

    if (palabras.length === 0) {
      return { texto: 'Cuéntame un poco más para poder buscar en el sistema.' };
    }

    // Cuenta cuántas palabras de la pregunta coinciden (no solo si coincide
    // alguna) — sirve para ordenar los resultados por relevancia antes de
    // quedarnos solo con los 3 primeros de cada sección.
    const puntuar = (...valores: (string | null | undefined)[]): number =>
      palabras.filter((p) => valores.some((v) => normalizar(v).includes(p))).length;

    const estaActivo = (activo?: boolean): boolean => activo !== false;

    function top3<T>(registros: T[], puntuarRegistro: (r: T) => number): T[] {
      return registros
        .map((r) => ({ r, puntos: puntuarRegistro(r) }))
        .filter((x) => x.puntos > 0)
        .sort((a, b) => b.puntos - a.puntos)
        .slice(0, 3)
        .map((x) => x.r);
    }

    const documentosEncontrados = top3(
      fuentes.documentos.filter((d) => estaActivo(d.activo)),
      (d) => puntuar(d.titulo, d.contenido),
    );
    const ticketsEncontrados = top3(
      fuentes.tickets.filter((t) => estaActivo(t.activo)),
      (t) => puntuar(t.titulo, t.descripcion, t.numeroTicket),
    );
    const movimientosEncontrados = top3(
      fuentes.movimientos.filter((m) => estaActivo(m.activo)),
      (m) => puntuar(m.descripcion),
    );
    const cuentasEncontradas = top3(
      fuentes.cuentas.filter((c) => estaActivo(c.activo)),
      (c) => puntuar(c.nombre),
    );
    const categoriasEncontradas = top3(
      fuentes.categorias.filter((c) => estaActivo(c.activo)),
      (c) => puntuar(c.nombre),
    );
    const miembrosEncontrados = top3(
      fuentes.miembros.filter((m) => estaActivo(m.activo)),
      (m) => puntuar(m.nombre, m.apellidoPaterno, m.apellidoMaterno),
    );

    const secciones: AiSeccion[] = [];
    if (documentosEncontrados.length > 0) {
      secciones.push({
        titulo: '📚 WikiDocs',
        enlaces: documentosEncontrados.map((d) => ({
          texto: d.titulo ?? 'Documento sin título',
          ruta: '/wikidocs/documentos',
          queryParams: { documento: d.id },
        })),
      });
    }
    if (ticketsEncontrados.length > 0) {
      secciones.push({
        titulo: '🎫 Proyectos',
        enlaces: ticketsEncontrados.map((t) => ({
          texto: `${t.numeroTicket} — ${t.titulo}`,
          ruta: '/proyectos/tablero',
          queryParams: { ticket: t.id },
        })),
      });
    }
    if (movimientosEncontrados.length > 0) {
      secciones.push({
        titulo: '💰 Presupuesto — movimientos',
        enlaces: movimientosEncontrados.map((m) => ({
          texto: `${m.descripcion} (${m.monto.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })})`,
          ruta: '/presupuesto/movimientos',
          queryParams: { movimiento: m.id },
        })),
      });
    }
    if (cuentasEncontradas.length > 0) {
      secciones.push({
        titulo: '💳 Presupuesto — cuentas',
        enlaces: cuentasEncontradas.map((c) => ({ texto: c.nombre, ruta: '/presupuesto/cuentas-presupuesto' })),
      });
    }
    if (categoriasEncontradas.length > 0) {
      secciones.push({
        titulo: '🏷️ Presupuesto — categorías',
        enlaces: categoriasEncontradas.map((c) => ({ texto: c.nombre, ruta: '/presupuesto/categorias-presupuesto' })),
      });
    }
    if (miembrosEncontrados.length > 0) {
      secciones.push({
        titulo: '👪 Familia',
        enlaces: miembrosEncontrados.map((m) => ({
          texto: [m.nombre, m.apellidoPaterno, m.apellidoMaterno].filter(Boolean).join(' '),
          ruta: '/familia/miembros',
          queryParams: { miembro: m.id },
        })),
      });
    }

    if (secciones.length === 0) {
      return {
        texto:
          'No encontré nada relacionado en WikiDocs, Proyectos, Presupuesto (movimientos/cuentas/categorías) ni Familia. Prueba con otras palabras.',
      };
    }
    return { texto: 'Encontré esto:', secciones };
  }
}

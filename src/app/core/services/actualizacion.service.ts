import { Injectable, inject, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';

/**
 * Detección de nuevas versiones publicadas de Saurix (auditoría nov-2026,
 * ver claude/saurix-cache-actualizacion-automatica-2026-11.md).
 *
 * CAUSA REAL del síntoma reportado ("hay que hacer Ctrl+Shift+R para ver
 * lo último"): la app YA tenía un Service Worker de Angular instalado y
 * registrado (`provideServiceWorker('ngsw-worker.js', ...)` en
 * app.config.ts, con `ngsw-config.json` ya configurado) — pero NADA en el
 * código escuchaba `SwUpdate.versionUpdates`. El Service Worker SÍ
 * descargaba la versión nueva en segundo plano en cada despliegue, pero
 * seguía sirviendo la versión activa (la vieja) indefinidamente porque
 * nunca se le pedía activar la nueva — un Ctrl+Shift+R "funciona" porque
 * fuerza al navegador a saltarse el Service Worker para esa recarga, no
 * porque el Service Worker haya hecho algo distinto. Este servicio es la
 * pieza que faltaba: escucha cuándo una versión nueva ya está lista,
 * avisa, y solo actualiza cuando el usuario lo pide.
 *
 * NO se construyó ningún mecanismo de versión propio (hash en query string,
 * archivo version.json consultado a mano, meta-tag comparado a mano,
 * etc.) — el manifiesto `ngsw.json` que ya genera `ng build` (hash de cada
 * archivo del build) es exactamente ese mecanismo ligero de versión, ya
 * disponible, y `SwUpdate` ya sabe compararlo contra lo que corre en el
 * navegador. Reutilizarlo es el pedido explícito del mandato ("reutilizar
 * un mecanismo ligero... evitar consultas constantes") en vez de
 * duplicarlo con una solución a medida.
 *
 * SIN POLLING EXCESIVO: una sola revisión periódica (cada 30 min, ver
 * INTERVALO_REVISION_MS) centralizada aquí — nunca un temporizador por
 * componente — más una revisión barata cuando la pestaña vuelve a estar
 * visible (cubre el caso común "dejé la pestaña abierta horas/días y
 * ahora regreso" sin esperar hasta 30 min). `checkForUpdate()` es una
 * sola petición HTTP a `ngsw.json` (unos cuantos KB), no una descarga del
 * build completo.
 *
 * MÚLTIPLES PESTAÑAS: no hace falta ninguna coordinación propia (p.ej.
 * BroadcastChannel forzando que todas las pestañas recarguen juntas) — el
 * propio Service Worker de Angular ya evita activar una versión nueva de
 * golpe en pestañas que siguen usando la vieja; cada pestaña decide sola,
 * vía este mismo servicio, cuándo activar y recargar. Construir una
 * sincronización propia habría ido CONTRA el pedido de "no recargar
 * automáticamente" (forzaría recargar pestañas donde el usuario sigue
 * capturando información).
 */
@Injectable({ providedIn: 'root' })
export class ActualizacionService {
  private readonly swUpdate = inject(SwUpdate);

  /** Cada cuánto se revisa si hay una versión nueva mientras la pestaña
   *  sigue abierta y visible. 30 min: suficiente para notar un despliegue
   *  en la misma sesión de trabajo sin generar tráfico de sobra — Saurix
   *  no se despliega varias veces por hora. */
  private static readonly INTERVALO_REVISION_MS = 30 * 60 * 1000;

  /** true en cuanto hay una versión nueva ya DESCARGADA y lista para
   *  activarse (evento VERSION_READY) — la UI (app-actualizacion-disponible)
   *  solo necesita leer esta señal. */
  readonly actualizacionDisponible = signal(false);

  private iniciado = false;
  private actualizando = false;

  /** Se llama una sola vez desde el componente raíz siempre montado
   *  (app-actualizacion-disponible, igual que app-indicador-ambiente) —
   *  por eso no hace falta ningún guardia especial contra múltiples
   *  temporizadores: con un solo punto de montaje a nivel de toda la app,
   *  esto corre una sola vez por sesión de navegador de por sí. El guardia
   *  `iniciado` es solo un cinturón de seguridad adicional. */
  iniciar(): void {
    if (this.iniciado) return;
    this.iniciado = true;

    // Deshabilitado en `ng serve` y en navegadores sin soporte de Service
    // Worker (SwUpdate.isEnabled ya contempla ambos casos) — no hay nada
    // que revisar ni ningún temporizador que montar ahí.
    if (!this.swUpdate.isEnabled) return;

    this.swUpdate.versionUpdates.subscribe((evento) => {
      if (evento.type === 'VERSION_READY') {
        console.info(
          `[Saurix] Nueva versión descargada y lista (hash ${evento.latestVersion.hash.slice(0, 8)}…).`,
        );
        this.actualizacionDisponible.set(true);
      }
    });

    // Estado del que no hay vuelta atrás (p.ej. el navegador purgó la
    // caché del Service Worker a medio camino) — aquí sí hace falta
    // recargar sin preguntar, es la única salida real; Angular mismo lo
    // documenta así para este evento específico.
    this.swUpdate.unrecoverable.subscribe((evento) => {
      console.error('[Saurix] Estado del Service Worker irrecuperable, recargando:', evento.reason);
      document.location.reload();
    });

    // Revisión inicial (una sola vez) + cada INTERVALO_REVISION_MS mientras
    // la pestaña siga abierta, más una revisión extra, barata, cuando el
    // usuario vuelve a esta pestaña después de tenerla en segundo plano.
    // (Saurix usa detección de cambios "zoneless" — provideZonelessChangeDetection()
    // en app.config.ts — así que no existe ninguna zona de la que "salir"
    // aquí: estos timers ya corren fuera del ciclo de detección de cambios
    // por diseño, y actualizar la signal de abajo con .set() ya notifica
    // por sí sola a quien la lea en una plantilla, sin necesitar NgZone.)
    void this.swUpdate.checkForUpdate().catch(() => {});
    setInterval(() => {
      void this.swUpdate.checkForUpdate().catch(() => {});
    }, ActualizacionService.INTERVALO_REVISION_MS);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void this.swUpdate.checkForUpdate().catch(() => {});
      }
    });
  }

  /** Activa la versión ya descargada y recarga — SOLO cuando el usuario lo
   *  pide (botón "Actualizar ahora"), nunca sola. El orden importa:
   *  activateUpdate() primero (hace que el Service Worker empiece a servir
   *  la versión nueva) y DESPUÉS reload() — al revés, la recarga volvería
   *  a traer el index.html de la versión vieja (la misma causa raíz que
   *  este cambio corrige), porque el Service Worker solo cambia de versión
   *  activa cuando se le pide explícitamente. */
  async actualizarAhora(): Promise<void> {
    if (this.actualizando) return;
    const continuar = window.confirm(
      'Hay una nueva versión de Saurix disponible.\n\nSi tienes cambios sin guardar en algún formulario, se perderán. ¿Actualizar ahora?',
    );
    if (!continuar) return;

    this.actualizando = true;
    try {
      await this.swUpdate.activateUpdate();
    } catch (error) {
      console.error('[Saurix] No se pudo activar la nueva versión:', error);
      this.actualizando = false;
      return;
    }
    document.location.reload();
  }

  /** Oculta el aviso sin actualizar (botón "✕") — la versión nueva sigue
   *  descargada y lista; el usuario puede actualizar más tarde desde
   *  cualquier recarga manual normal, o si vuelve a aparecer el aviso en
   *  la siguiente revisión periódica. No se guarda en ningún lado (ni
   *  localStorage ni backend): es solo para no insistir en la misma
   *  sesión de pestaña. */
  descartarAviso(): void {
    this.actualizacionDisponible.set(false);
  }
}

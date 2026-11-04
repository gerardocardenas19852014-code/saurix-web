import { Injectable } from '@angular/core';

/** Cuántos milisegundos como máximo puede durar el hueco entre dos teclas
 *  consecutivas para que todavía se considere parte de una ráfaga de
 *  lector de código de barras (USB/Bluetooth, funcionan como teclado).
 *  Un tecleo humano real -- incluso rápido -- casi nunca sostiene huecos
 *  por debajo de este renglón en adelante; un lector sí, siempre. */
const UMBRAL_RAFAGA_MS = 60;
/** Mínimo de caracteres para que un Enter dispare alDetectar() -- evita
 *  que un Enter suelto (sin nada tecleado antes, o solo 1-2 teclas
 *  sueltas) agregue algo por una entrada parcial o accidental. */
const MIN_LARGO_CODIGO = 3;

export interface OpcionesEscaneoGlobal {
  /** Se evalúa en CADA tecla -- true = esta pantalla puede procesar un
   *  escaneo global ahora mismo. Cada pantalla decide su propia regla
   *  (p.ej. "ningún modal bloqueante abierto" en Cobro, "paso Captura" en
   *  Movimiento masivo) sin que este servicio necesite saber nada de
   *  modales ni pasos. */
  habilitado: () => boolean;
  /** Se llama UNA vez por código ya detectado como escaneo real (ráfaga
   *  rápida + Enter) -- nunca se llama dos veces en paralelo para la
   *  misma pantalla: ver la cola más abajo. Puede ser async (buscar el
   *  producto, agregarlo) -- el servicio espera a que termine antes de
   *  procesar el siguiente código en cola. */
  alDetectar: (codigo: string) => void | Promise<void>;
}

/**
 * Detector de escaneo con lector de código de barras USB/Bluetooth SIN
 * necesitar que ningún campo de texto tenga el foco — Cambios 3 y 4 del
 * prompt maestro "SAURIX — Ventas→Cobro" (2026-11). Un lector por teclado
 * no necesita ninguna librería ni permiso: "teclea" cada carácter del
 * código y, casi siempre, Enter al final, mucho más rápido que cualquier
 * tecleo humano realista — ESA velocidad es la única señal que este
 * servicio usa para distinguir un escaneo real de alguien escribiendo a
 * mano (nunca intenta detectar "qué dispositivo es", imposible desde el
 * navegador).
 *
 * Un único servicio compartido (regla general #8: no duplicar lógica
 * entre pantallas) — hoy lo usan CobroComponent y MovimientoMasivoComponent,
 * cada uno con su propia regla de "¿puedo escuchar ahora?" (ver
 * OpcionesEscaneoGlobal.habilitado) y su propio "qué hacer con el código"
 * (ver alDetectar) — la detección de ráfaga y la cola de procesamiento
 * son el ÚNICO código que vive aquí.
 *
 * Seguridad (ver Cambio 3 del prompt, sección "Seguridad y confiabilidad"):
 * - Si el foco está en CUALQUIER campo editable (input/textarea/select/
 *   contenteditable) este servicio NO HACE NADA -- ni intercepta, ni
 *   bloquea, ni agrega al buffer. Deja que ese campo siga funcionando
 *   exactamente como hoy: tecleo manual normal, o el propio <input> de
 *   app-escaneo-codigo si YA tiene el foco (ese input ya resuelve el
 *   escaneo por su cuenta, vía su propio (keyup.enter) -- no hay que
 *   duplicar nada ahí). La detección GLOBAL solo entra en juego cuando el
 *   foco NO está en ningún campo editable (p.ej. nada tiene foco, o lo
 *   tiene un botón) -- que es justo el caso nuevo que pide el prompt: "no
 *   será necesario seleccionar el campo de código".
 * - habilitado() se vuelve a evaluar en cada tecla -- si una pantalla abre
 *   un modal o cambia de paso, la detección global se apaga sola en la
 *   siguiente tecla, sin que la pantalla tenga que desactivar/reactivar
 *   el listener a mano.
 * - Cada pantalla llama activar() una vez (p.ej. en ngOnInit) y guarda la
 *   función de limpieza que regresa, para llamarla en ngOnDestroy -- así
 *   nunca queda un listener colgado al navegar fuera, y nunca se duplica
 *   si se vuelve a entrar a la pantalla.
 *
 * Cola de procesamiento (ver Cambio 3, sección "Escaneos rápidos"): si el
 * cajero escanea varios productos muy rápido, cada código detectado entra
 * a una cola FIFO por pantalla y se procesa de UNO EN UNO, esperando a que
 * alDetectar() termine antes de empezar el siguiente -- nunca en paralelo.
 * Esto es lo que evita tanto condiciones de carrera (dos escaneos del
 * MISMO producto incrementando la cantidad a la vez perderían un
 * incremento si corrieran en paralelo) como perder códigos mientras hay
 * una consulta pendiente (se encolan, nunca se descartan) y mantiene el
 * orden en que se escanearon.
 */
@Injectable({ providedIn: 'root' })
export class EscaneoGlobalService {
  activar(opciones: OpcionesEscaneoGlobal): () => void {
    let buffer = '';
    let ultimoTecleo = 0;
    const cola: string[] = [];
    let procesando = false;

    const procesarCola = async (): Promise<void> => {
      if (procesando) return;
      procesando = true;
      try {
        while (cola.length > 0) {
          const codigo = cola.shift()!;
          try {
            await opciones.alDetectar(codigo);
          } catch {
            // Cada pantalla ya avisa sus propios errores (producto no
            // encontrado, etc. -- ver sus propios try/catch/toast). Este
            // catch solo evita que un error en un código deje atascada
            // la cola para los que siguen detrás.
          }
        }
      } finally {
        procesando = false;
      }
    };

    const handler = (evento: KeyboardEvent): void => {
      if (!opciones.habilitado()) return;

      const foco = document.activeElement;
      const enCampoEditable =
        foco instanceof HTMLElement &&
        (foco.tagName === 'INPUT' || foco.tagName === 'TEXTAREA' || foco.tagName === 'SELECT' || foco.isContentEditable);
      if (enCampoEditable) return; // deja ese campo funcionando exactamente como hoy -- ver comentario de la clase

      const ahora = performance.now();
      const hueco = ahora - ultimoTecleo;
      ultimoTecleo = ahora;

      if (evento.key === 'Enter') {
        const codigo = buffer;
        buffer = '';
        if (codigo.length >= MIN_LARGO_CODIGO && hueco <= UMBRAL_RAFAGA_MS) {
          cola.push(codigo);
          void procesarCola();
        }
        return;
      }

      // Solo caracteres imprimibles de una posición (letras, números,
      // símbolos) -- ignora Shift, Ctrl, flechas, Tab, F1-F12, etc., que
      // KeyboardEvent.key reporta con nombres de más de un carácter.
      if (evento.key.length !== 1) return;

      if (hueco > UMBRAL_RAFAGA_MS) buffer = ''; // hueco lento -> no es una ráfaga de lector, se reinicia
      buffer += evento.key;
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }
}

import { ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild, inject, signal } from '@angular/core';
import { BrowserMultiFormatReader } from '@zxing/browser';
import type { IScannerControls } from '@zxing/browser';
import { ToastService } from '../../services/toast.service';

/**
 * Entrada de código de barras reutilizable para cualquier pantalla que
 * necesite "buscar por código" — Productos, Movimientos entre bodegas,
 * Conteo físico, Órdenes de compra. Soporta los DOS tipos de lector que
 * se pidieron:
 *
 *  - USB/Bluetooth (pistola): funcionan como teclado — al escanear
 *    "teclean" el código y Enter solos en el <input> de abajo, sin que el
 *    usuario haga nada más que dejarlo enfocado. No necesita ninguna
 *    librería ni permiso especial: ya funciona con cualquier <input> de
 *    texto normal, por eso también sirve para teclear el código a mano.
 *  - Cámara (celular/laptop): botón 📷 que abre un visor con la cámara del
 *    dispositivo y decodifica en vivo con @zxing/browser (ZXing) — al
 *    reconocer un código (de barras o QR), lo emite y cierra el visor solo.
 *
 * En ambos casos el resultado sale por el mismo evento (codigoEscaneado),
 * así cada pantalla que use este componente no necesita saber cuál de los
 * dos métodos se usó — solo reacciona al código ya leído.
 */
@Component({
  selector: 'app-escaneo-codigo',
  standalone: true,
  imports: [],
  templateUrl: './escaneo-codigo.component.html',
  styleUrl: './escaneo-codigo.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EscaneoCodigoComponent implements OnDestroy {
  @Input() placeholder = 'Escanea o captura el código…';
  /** Se limpia el input después de cada escaneo/captura por default — en
   *  pantallas donde conviene dejarlo (p. ej. para ver qué se acaba de
   *  escanear) se puede desactivar. */
  @Input() limpiarDespues = true;
  @Output() readonly codigoEscaneado = new EventEmitter<string>();

  private readonly toast = inject(ToastService);

  @ViewChild('video') private videoRef?: ElementRef<HTMLVideoElement>;

  protected readonly texto = signal('');
  protected readonly camaraAbierta = signal(false);
  protected readonly iniciandoCamara = signal(false);

  private lector: BrowserMultiFormatReader | null = null;
  private controles: IScannerControls | null = null;

  /** Dispara tanto al presionar Enter (pistola USB/Bluetooth o captura a
   *  mano) como al perder foco con algo escrito, para no depender de que el
   *  lector sí envíe Enter (algunos modelos se pueden configurar sin él). */
  confirmarTexto(): void {
    const valor = this.texto().trim();
    if (!valor) return;
    this.codigoEscaneado.emit(valor);
    if (this.limpiarDespues) this.texto.set('');
  }

  /** Abre el visor de cámara y empieza a decodificar frame por frame. El
   *  <video> vive dentro de un @if (camaraAbierta()), así que todavía no
   *  existe en el DOM en el mismo instante en que se activa la señal —
   *  se espera un frame (requestAnimationFrame) a que Angular lo pinte
   *  antes de intentar tomar su referencia; es el patrón estándar para
   *  este caso, no una señal de que algo esté mal. */
  async abrirCamara(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.toast.error('Este navegador no permite usar la cámara aquí.');
      return;
    }
    this.camaraAbierta.set(true);
    this.iniciandoCamara.set(true);
    await new Promise<void>((resolver) => requestAnimationFrame(() => resolver()));

    const videoEl = this.videoRef?.nativeElement;
    if (!videoEl) {
      this.toast.error('No se pudo preparar la cámara.');
      this.camaraAbierta.set(false);
      this.iniciandoCamara.set(false);
      return;
    }

    try {
      this.lector = new BrowserMultiFormatReader();
      this.controles = await this.lector.decodeFromVideoDevice(undefined, videoEl, (resultado) => {
        if (resultado) {
          this.codigoEscaneado.emit(resultado.getText());
          this.cerrarCamara();
        }
        // El callback también se dispara (con resultado undefined) en cada
        // frame donde todavía no se reconoce nada — es el comportamiento
        // normal de ZXing mientras se sigue apuntando al código, no un error.
      });
    } catch {
      this.toast.error('No se pudo acceder a la cámara. Revisa los permisos del navegador.');
      this.camaraAbierta.set(false);
    } finally {
      this.iniciandoCamara.set(false);
    }
  }

  cerrarCamara(): void {
    this.controles?.stop();
    this.controles = null;
    this.lector = null;
    this.camaraAbierta.set(false);
  }

  ngOnDestroy(): void {
    this.cerrarCamara();
  }
}

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { IndexedDbEngineService } from '../../../core/services/indexeddb-engine.service';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';

/** Forma del archivo .json que genera/lee esta pantalla. */
interface RespaldoSaurix {
  app: 'Saurix';
  version: 1;
  exportadoEn: string;
  stores: Record<string, unknown[]>;
}

function esRespaldoValido(valor: unknown): valor is RespaldoSaurix {
  return (
    !!valor &&
    typeof valor === 'object' &&
    (valor as Record<string, unknown>)['app'] === 'Saurix' &&
    typeof (valor as Record<string, unknown>)['stores'] === 'object'
  );
}

/**
 * Respaldo y restauración de la base local (IndexedDB): mientras no exista
 * PlataformaSaurix conectado de verdad, todo lo que se captura en esta app
 * vive únicamente en el navegador de este dispositivo — nada se sincroniza
 * solo entre computadoras. Esta pantalla es la manera de mover esos datos:
 * "Descargar respaldo" guarda un .json con todo, y "Restaurar" lo vuelve a
 * cargar en cualquier otro dispositivo/navegador.
 */
@Component({
  selector: 'app-respaldo',
  standalone: true,
  imports: [ConfirmDialogComponent],
  templateUrl: './respaldo.component.html',
  styleUrl: './respaldo.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RespaldoComponent {
  private readonly engine = inject(IndexedDbEngineService);
  protected readonly toast = inject(ToastService);

  protected readonly generandoRespaldo = signal(false);
  protected readonly restaurando = signal(false);

  /** Respaldo ya leído y validado del archivo elegido, esperando confirmación
   *  del usuario antes de sobreescribir todo lo que hay en este dispositivo. */
  protected readonly respaldoPendiente = signal<RespaldoSaurix | null>(null);
  protected readonly nombreArchivoPendiente = signal('');

  async descargarRespaldo(): Promise<void> {
    this.generandoRespaldo.set(true);
    try {
      const stores = await this.engine.exportarTodo();
      const respaldo: RespaldoSaurix = {
        app: 'Saurix',
        version: 1,
        exportadoEn: new Date().toISOString(),
        stores,
      };

      const fecha = new Date().toISOString().slice(0, 10);
      const contenido = JSON.stringify(respaldo, null, 2);
      const blob = new Blob([contenido], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `saurix-respaldo-${fecha}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      const totalRegistros = Object.values(stores).reduce((acc, filas) => acc + filas.length, 0);
      this.toast.exito(`Respaldo descargado (${totalRegistros} registros en total).`);
    } catch {
      this.toast.error('No se pudo generar el respaldo. Intenta de nuevo.');
    } finally {
      this.generandoRespaldo.set(false);
    }
  }

  /** Lee y valida el archivo elegido, pero NO restaura todavía — se pide
   *  confirmación explícita (ver app-confirm-dialog) porque es destructivo:
   *  reemplaza todo lo que ya hay guardado en este dispositivo. */
  async archivoSeleccionado(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = ''; // permite volver a elegir el mismo archivo si se cancela después

    if (!archivo) return;

    try {
      const texto = await archivo.text();
      const datos: unknown = JSON.parse(texto);
      if (!esRespaldoValido(datos)) {
        this.toast.error('Ese archivo no es un respaldo de Saurix válido.');
        return;
      }
      this.nombreArchivoPendiente.set(archivo.name);
      this.respaldoPendiente.set(datos);
    } catch {
      this.toast.error('No se pudo leer el archivo. ¿Seguro que es el .json del respaldo?');
    }
  }

  cancelarRestauracion(): void {
    this.respaldoPendiente.set(null);
    this.toast.info('Restauración cancelada.');
  }

  async confirmarRestauracion(): Promise<void> {
    const respaldo = this.respaldoPendiente();
    if (!respaldo) return;

    this.restaurando.set(true);
    try {
      await this.engine.restaurarTodo(respaldo.stores);
      this.toast.exito('Restauración completada. Recargando…');
      // Todo lo cacheado en memoria por cada pantalla (signals ya cargados
      // antes de restaurar) quedaría desactualizado — una recarga completa
      // es la forma más simple y segura de que todo vuelva a leer la base
      // ya restaurada, sin tener que tocar cada componente de la app.
      setTimeout(() => window.location.reload(), 1200);
    } catch {
      this.toast.error('No se pudo restaurar el respaldo. Intenta de nuevo.');
      this.restaurando.set(false);
    }
  }

  totalRegistros(respaldo: RespaldoSaurix | null): number {
    if (!respaldo) return 0;
    return Object.values(respaldo.stores).reduce((acc, filas) => acc + filas.length, 0);
  }
}

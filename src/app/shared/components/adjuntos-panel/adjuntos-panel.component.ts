import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { DataClientService } from '../../../core/services/data-client.service';
import { ToastService } from '../../services/toast.service';
import { ConfirmDialogComponent } from '../confirm-dialog/confirm-dialog.component';
import { AdjuntoGenerico } from './adjunto.model';

/**
 * Panel genérico de adjuntos (comprobantes) — reutilizado por Movimientos y
 * por Fijos y Proyección (MovimientoPresupuestoAdjunto /
 * MovimientoRecurrentePresupuestoAdjunto en el esquema). Cada archivo se
 * guarda completo como data URL (base64) en su propia entidad de
 * IndexedDB; pensado para comprobantes chicos (tickets, capturas), no para
 * archivos grandes.
 */
@Component({
  selector: 'app-adjuntos-panel',
  standalone: true,
  imports: [ConfirmDialogComponent],
  templateUrl: './adjuntos-panel.component.html',
  styleUrl: './adjuntos-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdjuntosPanelComponent {
  private readonly data = inject(DataClientService);
  private readonly toast = inject(ToastService);

  /** Nombre de la entidad de adjuntos, p.ej. 'MovimientoPresupuestoAdjunto'. */
  readonly entidad = input.required<string>();
  /** Nombre del campo FK hacia el padre, p.ej. 'movimientoPresupuestoId'. */
  readonly campoPadre = input.required<string>();
  /** Id del registro padre (movimiento o recurrente) al que pertenecen los adjuntos. */
  readonly padreId = input.required<number>();
  /** true = pide/muestra un comentario opcional por adjunto (p.ej. TicketAdjunto.Comentario).
   *  Por defecto false, para no cambiar el comportamiento de los usos existentes. */
  readonly soportaComentario = input<boolean>(false);
  /** Texto del encabezado del panel — por defecto 'Comprobantes' (Presupuesto);
   *  otros usos (p.ej. WikiDocs) pasan 'Adjuntos'. */
  readonly etiqueta = input<string>('Comprobantes');

  protected readonly adjuntos = signal<AdjuntoGenerico[]>([]);
  protected readonly cargando = signal(false);
  protected readonly subiendo = signal(false);
  protected readonly aEliminar = signal<AdjuntoGenerico | null>(null);
  protected readonly comentarioNuevo = signal('');

  constructor() {
    effect(() => {
      const id = this.padreId();
      if (id) this.cargar(id);
    });
  }

  private cargar(padreId: number): void {
    this.cargando.set(true);
    this.data
      .list<AdjuntoGenerico>(this.entidad(), { [this.campoPadre()]: padreId })
      .subscribe({
        next: (registros) => {
          this.adjuntos.set(registros);
          this.cargando.set(false);
        },
        error: () => this.cargando.set(false),
      });
  }

  onArchivoSeleccionado(evento: Event): void {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.[0];
    if (!archivo) return;

    if (archivo.size > 4 * 1024 * 1024) {
      this.toast.advertencia('El archivo no puede pesar más de 4 MB.');
      input.value = '';
      return;
    }

    this.subiendo.set(true);
    const lector = new FileReader();
    lector.onload = () => {
      const contenido = lector.result as string;
      const dto: Partial<AdjuntoGenerico> = {
        nombreArchivo: archivo.name,
        tipoContenido: archivo.type || 'application/octet-stream',
        contenido,
        [this.campoPadre()]: this.padreId(),
      };
      if (this.soportaComentario()) {
        dto.comentario = this.comentarioNuevo().trim() || null;
      }
      this.data.alta<AdjuntoGenerico>(this.entidad(), dto).subscribe({
        next: () => {
          this.toast.exito('Adjunto agregado.');
          this.subiendo.set(false);
          this.comentarioNuevo.set('');
          input.value = '';
          this.cargar(this.padreId());
        },
        error: () => this.subiendo.set(false),
      });
    };
    lector.onerror = () => {
      this.toast.error('No se pudo leer el archivo.');
      this.subiendo.set(false);
    };
    lector.readAsDataURL(archivo);
  }

  pedirEliminar(adjunto: AdjuntoGenerico): void {
    this.aEliminar.set(adjunto);
  }

  confirmarEliminar(): void {
    const adjunto = this.aEliminar();
    if (!adjunto) return;
    this.data.baja(this.entidad(), adjunto.id).subscribe({
      next: () => {
        this.toast.exito('Adjunto eliminado.');
        this.aEliminar.set(null);
        this.cargar(this.padreId());
      },
    });
  }
}

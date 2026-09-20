/**
 * Forma genérica de un "adjunto" (comprobante) — usada tanto por
 * MovimientoPresupuestoAdjunto como por MovimientoRecurrentePresupuestoAdjunto.
 * El campo FK hacia el padre (p.ej. `movimientoPresupuestoId`) es dinámico,
 * por eso no aparece explícito aquí — ver AdjuntosPanelComponent.
 */
export interface AdjuntoGenerico {
  id: number;
  nombreArchivo: string;
  tipoContenido: string;
  /** El archivo completo, codificado como data URL (base64) — suficiente para
   *  comprobantes chicos (tickets, capturas); no pensado para archivos grandes. */
  contenido: string;
  /** Comentario/leyenda opcional del adjunto (p.ej. TicketAdjunto.Comentario).
   *  Solo se pide/muestra cuando el panel se usa con [soportaComentario]="true". */
  comentario?: string | null;
  fechaCreacion?: string;
  [campoFk: string]: unknown;
}

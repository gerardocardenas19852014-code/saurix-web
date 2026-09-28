/**
 * Un documento capturado para un miembro de familia (INE, acta de
 * nacimiento, pasaporte, póliza de seguro, etc. — ver catálogo ValorLista
 * grupo 'DocumentoFamiliaTipo'). El archivo en sí NO se guarda aquí: se
 * adjunta con <app-adjuntos-panel entidad="DocumentoFamiliaAdjunto"
 * campoPadre="documentoFamiliaId">, mismo patrón que Movimientos/Tickets.
 */
export interface DocumentoFamilia {
  id: number;
  miembroFamiliaId: number;
  /** Clave de ValorLista grupo 'DocumentoFamiliaTipo'. */
  tipoDocumentoClave: string;
  /** Opcional — 'YYYY-MM-DD', o '' si el documento no vence (p.ej. un acta de nacimiento). */
  fechaVencimiento: string;
  notas: string;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

export type EstadoVencimientoDocumento = 'sin-vencimiento' | 'vigente' | 'por-vencer' | 'vencido';

/** Días de antelación para marcar un documento como "por vencer" (mismo
 *  horizonte que usa Calendario de pagos para avisar de fijos/deudas). */
export const DIAS_AVISO_VENCIMIENTO = 30;

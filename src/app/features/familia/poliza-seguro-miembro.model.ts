import { EstadoVencimientoDocumento } from './documento-familia.model';

/**
 * Póliza de seguro de un miembro de familia (vida, gastos médicos, auto,
 * etc.) — a diferencia de los campos simples `aseguradora`/`numeroPoliza`
 * de MiembroFamilia (pensados solo para la tarjeta de emergencia, un dato
 * por persona), esta entidad permite varias pólizas por miembro con
 * vigencia y aviso de vencimiento, mismo patrón que DocumentoFamilia.
 */
export interface PolizaSeguroMiembro {
  id: number;
  miembroFamiliaId: number;
  /** Texto libre entre un set fijo de opciones comunes (ver TIPOS_POLIZA en
   *  miembros.component.ts) — no se justificó un catálogo ValorLista aparte
   *  para una lista tan corta y poco cambiante, a diferencia de Tipo de
   *  documento (que sí tiene su propia pantalla). */
  tipo: string;
  aseguradora: string;
  numeroPoliza: string;
  /** 'YYYY-MM-DD', o '' si no se capturó. */
  fechaVigenciaInicio: string;
  /** 'YYYY-MM-DD', o '' si la póliza no vence. */
  fechaVigenciaFin: string;
  notas: string;
  activo: boolean;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

/** Reusa el mismo tipo de estado que DocumentoFamilia — ver familia.util.ts → estadoVencimiento(). */
export type EstadoVencimientoPoliza = EstadoVencimientoDocumento;

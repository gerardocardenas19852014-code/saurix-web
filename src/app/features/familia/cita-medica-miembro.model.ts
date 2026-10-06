/**
 * Cita médica (pasada o futura) de un miembro de familia. `completada`
 * distingue una cita ya atendida de una próxima.
 */
export interface CitaMedicaMiembro {
  id: number;
  miembroFamiliaId: number;
  motivo: string;
  especialidad: string;
  /** 'YYYY-MM-DD'. */
  fecha: string;
  lugar: string;
  notas: string;
  completada: boolean;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

/**
 * Una vacuna aplicada a un miembro de familia — historial de vacunación,
 * mismo criterio que DocumentoFamilia (lista propia por miembro, sin
 * archivo adjunto: aquí no aplica, es solo un registro de fecha/dosis).
 */
export interface VacunaMiembro {
  id: number;
  miembroFamiliaId: number;
  nombre: string;
  /** 'YYYY-MM-DD'. */
  fechaAplicacion: string;
  /** Texto libre, p.ej. "1a dosis", "Refuerzo", "Única". */
  dosis: string;
  notas: string;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

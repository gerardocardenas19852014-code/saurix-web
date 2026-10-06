export type FrecuenciaTareaHogar = 'unica' | 'diaria' | 'semanal' | 'mensual';

export interface TareaHogar {
  id: number;
  titulo: string;
  /** Id de MiembroFamilia responsable, o null/0 = sin asignar a alguien en particular. */
  miembroFamiliaId?: number | null;
  frecuencia: FrecuenciaTareaHogar;
  completada: boolean;
  /** 'YYYY-MM-DD', o '' si no tiene fecha límite. */
  fechaLimite: string;
  notas: string;
  activo: boolean;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

export const ETIQUETA_FRECUENCIA_TAREA: Record<FrecuenciaTareaHogar, string> = {
  unica: 'Única vez',
  diaria: 'Diaria',
  semanal: 'Semanal',
  mensual: 'Mensual',
};

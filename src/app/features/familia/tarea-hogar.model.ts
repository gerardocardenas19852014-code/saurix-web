export type FrecuenciaTareaHogar = 'unica' | 'diaria' | 'semanal' | 'mensual';

export interface TareaHogar {
  id: number;
  titulo: string;
  /** Id de MiembroFamilia responsable, o null/0 = sin asignar a alguien en particular. */
  miembroFamiliaId?: number | null;
  frecuencia: FrecuenciaTareaHogar;
  /** Para frecuencia 'unica': si ya se hizo (permanente). Para una
   *  recurrente se usa solo como bandera histórica ("alguna vez se hizo");
   *  el estado real de "¿hecha ESTE ciclo?" se calcula a partir de
   *  ultimaVezCompletada (ver estaHechaEsteCiclo en tareas-hogar.component.ts),
   *  mismo criterio que "Ciclo actual" en Presupuesto → Fijos y Proyección. */
  completada: boolean;
  /** 'YYYY-MM-DD' de la última vez que se marcó hecha — en una tarea
   *  recurrente, si esa fecha ya no cae en el ciclo actual (hoy/esta
   *  semana/este mes, según frecuencia), la tarea vuelve a verse pendiente
   *  sola, sin que nadie tenga que "reiniciarla" a mano. null/'' = nunca se
   *  ha marcado hecha. */
  ultimaVezCompletada: string | null;
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

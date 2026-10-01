export type ActividadTipo = 'Llamada' | 'Reunión' | 'Tarea' | 'Nota';
export const ACTIVIDAD_TIPOS: ActividadTipo[] = ['Llamada', 'Reunión', 'Tarea', 'Nota'];

/** A qué registro del CRM pertenece la actividad — mismo criterio que
 *  `app-adjuntos-panel` (campoPadre/padreId) pero con el tipo del padre
 *  explícito, porque aquí una misma actividad puede colgar de distintas
 *  entidades (Lead, Oportunidad, Cliente, Caso), no solo una. */
export type ActividadRelacionadoTipo = 'Lead' | 'Oportunidad' | 'Cliente' | 'Caso';

export interface ActividadCrm {
  id: number;
  relacionadoTipo: ActividadRelacionadoTipo;
  relacionadoId: number;
  tipo: ActividadTipo;
  titulo: string;
  descripcion: string | null;
  /** Fecha programada/realizada (yyyy-mm-dd) — no un timestamp de auditoría. */
  fecha: string;
  completada: boolean;
  fechaCreacion?: string;
}

export type CasoPrioridad = 'Baja' | 'Media' | 'Alta' | 'Urgente';
export const CASO_PRIORIDADES: CasoPrioridad[] = ['Baja', 'Media', 'Alta', 'Urgente'];

export type CasoEstado = 'Nuevo' | 'En progreso' | 'Esperando cliente' | 'Resuelto' | 'Cerrado';
export const CASO_ESTADOS: CasoEstado[] = ['Nuevo', 'En progreso', 'Esperando cliente', 'Resuelto', 'Cerrado'];

/** Estados que cuentan como "abierto" — usados para el contador rápido de la lista. */
export const CASO_ESTADOS_ABIERTOS: CasoEstado[] = ['Nuevo', 'En progreso', 'Esperando cliente'];

export interface Caso {
  id: number;
  clienteId: number | null;
  asunto: string;
  descripcion: string | null;
  prioridad: CasoPrioridad;
  estado: CasoEstado;
  /** Se completa sola al pasar a Resuelto/Cerrado (ver guardar()) — no es editable a mano. */
  fechaCierre: string | null;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

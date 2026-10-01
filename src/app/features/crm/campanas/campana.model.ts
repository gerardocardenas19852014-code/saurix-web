export type CampanaTipo = 'Email' | 'Evento' | 'Redes sociales' | 'Otro';
export const CAMPANA_TIPOS: CampanaTipo[] = ['Email', 'Evento', 'Redes sociales', 'Otro'];

export type CampanaEstado = 'Planificada' | 'Activa' | 'Finalizada';
export const CAMPANA_ESTADOS: CampanaEstado[] = ['Planificada', 'Activa', 'Finalizada'];

export interface Campana {
  id: number;
  nombre: string;
  tipo: CampanaTipo;
  estado: CampanaEstado;
  fechaInicio: string | null;
  fechaFin: string | null;
  descripcion: string | null;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

/** Tabla puente Campaña↔Lead (muchos a muchos) — un lead puede venir de
 *  (o haberse tocado en) más de una campaña a la vez, igual que cualquier
 *  CRM real. Sin campos propios además de las dos llaves: la fecha de
 *  asociación la da `fechaCreacion` del motor de datos. */
export interface CampanaLead {
  id: number;
  campanaId: number;
  leadId: number;
  fechaCreacion?: string;
}

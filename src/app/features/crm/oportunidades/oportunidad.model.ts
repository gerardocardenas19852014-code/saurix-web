export type OportunidadEtapa =
  | 'Prospección'
  | 'Calificación'
  | 'Propuesta'
  | 'Negociación'
  | 'Ganada'
  | 'Perdida';

export const OPORTUNIDAD_ETAPAS: OportunidadEtapa[] = [
  'Prospección',
  'Calificación',
  'Propuesta',
  'Negociación',
  'Ganada',
  'Perdida',
];

/** Etapas en las que la oportunidad sigue "viva" — se usan para separar el total
 *  del pipeline abierto (p.ej. en un resumen) de lo ya cerrado (Ganada/Perdida). */
export const OPORTUNIDAD_ETAPAS_ABIERTAS: OportunidadEtapa[] = [
  'Prospección',
  'Calificación',
  'Propuesta',
  'Negociación',
];

export interface Oportunidad {
  id: number;
  nombre: string;
  /** Opcional — una oportunidad puede nacer de un prospecto que aún no es un
   *  Cliente formal (Comercio.Cliente); se deja sin dueño hasta que se decida. */
  clienteId: number | null;
  valorEstimado: number | null;
  etapa: OportunidadEtapa;
  fechaCierreEstimada: string | null;
  /** Solo aplica (y se exige) cuando `etapa === 'Perdida'`. */
  motivoPerdidaId: number | null;
  notas: string | null;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

export interface MotivoPerdida {
  id: number;
  nombre: string;
  activo: boolean;
}

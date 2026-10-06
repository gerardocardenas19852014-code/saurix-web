/**
 * Columna configurable del tablero de Trámites familiares (ver
 * tramites-familiares.component.ts) — equivalente simplificado a
 * TableroColumna de Proyectos (ver proyectos/tableros/tablero-columna.model.ts):
 * aquí solo se necesita nombre + orden, sin flujo/campos configurables ni
 * diagrama, porque un trámite no tiene los más de 10 campos de un Ticket.
 * Se siembra sola con 3 columnas de fábrica (Pendiente/En proceso/
 * Terminado) la primera vez que se abre la pantalla — ver
 * SEMILLA_TRAMITE_ESTADOS más abajo y sembrarTramiteEstados() en el
 * componente.
 */
export interface TramiteEstado {
  id: number;
  nombre: string;
  orden: number;
  activo: boolean;
}

export const SEMILLA_TRAMITE_ESTADOS: Omit<TramiteEstado, 'id'>[] = [
  { nombre: 'Pendiente', orden: 1, activo: true },
  { nombre: 'En proceso', orden: 2, activo: true },
  { nombre: 'Terminado', orden: 3, activo: true },
];

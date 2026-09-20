export interface Proyecto {
  id: number;
  nombre: string;
  /** Clave corta (ej. 'SAU') usada como prefijo del folio de Ticket. */
  clave: string;
  codigoHex: string;
  activo: boolean;
}

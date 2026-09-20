export interface TicketPrioridad {
  id: number;
  nombre: string;
  clave: string;
  codigoHex: string;
  /** SLA: horas de vigencia antes de considerarse vencido. */
  vigenciaHoras: number;
  /** Horas antes del vencimiento en que se debe avisar. */
  avisoHoras: number;
  activo: boolean;
}

/** Usuarios extra a avisar (además del asignado) cuando el SLA de esta prioridad está por vencer. */
export interface TicketPrioridadNotificar {
  id: number;
  ticketPrioridadId: number;
  usuarioId: number;
}

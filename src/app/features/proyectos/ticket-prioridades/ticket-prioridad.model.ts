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
  /** Marca esta prioridad como "crítica" (p.ej. "DETIENE OPERACION"): los tickets con
   *  esta prioridad se resaltan en Mi Dashboard (tarjeta "🚨 Críticos" + fila en rojo),
   *  sin importar su estado de SLA. */
  critica?: boolean;
}

/** Usuarios extra a avisar (además del asignado) cuando el SLA de esta prioridad está por vencer. */
export interface TicketPrioridadNotificar {
  id: number;
  ticketPrioridadId: number;
  usuarioId: number;
}

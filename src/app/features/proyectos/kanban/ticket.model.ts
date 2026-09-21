export interface Ticket {
  id: number;
  proyectoId: number;
  tableroColumnaId: number;
  ticketTipoId: number;
  ticketPrioridadId: number;
  /** Módulo/área del sistema al que pertenece el ticket — opcional (ver TicketModulo). */
  ticketModuloId: number | null;
  asignadoUsuarioId: number | null;
  reportadoPorUsuarioId: number;
  /** Folio consecutivo tipo 'SAU-0001', armado en la app con Proyecto.Clave (igual que Cotizacion.Folio). */
  numeroTicket: string;
  folioInterno: string | null;
  titulo: string;
  /** blob_text: no viene en GetList, solo se carga con GetById. */
  descripcion?: string | null;
  planeado: boolean;
  tiempoEstimadoMin: number | null;
  fechaFinAnalisis: string | null;
  fechaFinDesarrollo: string | null;
  fechaFinCliente: string | null;
  /** Fecha de inicio/fin planeadas para el diagrama de Gantt — opcionales; si no
   *  se capturan, el Gantt usa fechaCreacion (inicio) y tiempoEstimadoMin (duración),
   *  igual que antes de que existieran estos dos campos. */
  fechaInicio: string | null;
  fechaFin: string | null;
  /** blob_text: no viene en GetList, solo se carga con GetById. */
  solucion?: string | null;
  activo: boolean;
  /** Auditoría: la agrega IndexedDbDataClientService.alta() automáticamente. Se usa para calcular el SLA (vigencia de la prioridad) desde la creación del ticket. */
  fechaCreacion?: string;
  fechaModificacion?: string;
  /** Marca interna de NotificacionesService.revisarSlaTickets(): el nivel de SLA
   *  ('warning'/'expired') para el que YA se avisó a asignado + "avisar también a"
   *  de la Prioridad — evita mandar el mismo aviso una y otra vez en cada revisión
   *  periódica. No se edita desde ningún formulario. */
  slaAvisoNivel?: 'warning' | 'expired' | null;
}

export interface UsuarioOpcion {
  id: number;
  nombreCompleto: string;
}

export interface TicketComentario {
  id: number;
  ticketId: number;
  texto: string;
  creadoPor: number | null;
  fechaCreacion?: string;
}

export interface TicketActividad {
  id: number;
  ticketId: number;
  texto: string;
  tiempoMin: number;
  creadoPor: number | null;
  fechaCreacion?: string;
}

export interface TicketEtiqueta {
  id: number;
  ticketId: number;
  texto: string;
}

/** Comprobantes/adjuntos del ticket (con Comentario opcional) — se muestran vía
 *  AdjuntosPanelComponent con [soportaComentario]="true". */
export interface TicketAdjunto {
  id: number;
  ticketId: number;
  nombreArchivo: string;
  tipoContenido: string;
  contenido: string;
  comentario?: string | null;
  fechaCreacion?: string;
}

/** Log de cambios de columna/estado — se genera automáticamente al mover un
 *  ticket (ver KanbanComponent.moverTicketAColumna); de solo lectura en la UI. */
export interface TicketHistorialEstado {
  id: number;
  ticketId: number;
  tableroColumnaAnteriorId: number | null;
  tableroColumnaNuevaId: number;
  usuarioId: number | null;
  fechaCreacion?: string;
}

/** Auto-referencia a Ticket — pestaña "Asociados" (tickets relacionados/dependientes). */
export interface TicketDependencia {
  id: number;
  ticketId: number;
  ticketRelacionadoId: number;
}

/** Usuarios que siguen el ticket, para recibir avisos aunque no estén asignados. */
export interface TicketSeguidor {
  id: number;
  ticketId: number;
  usuarioId: number;
}

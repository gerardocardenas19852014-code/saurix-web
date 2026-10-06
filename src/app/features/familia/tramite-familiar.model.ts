export interface TramiteFamiliar {
  id: number;
  titulo: string;
  /** Id de MiembroFamilia, o null/0 = trámite de toda la familia, no de alguien en particular. */
  miembroFamiliaId?: number | null;
  /** Id de TramiteEstado — la columna donde vive la tarjeta en el tablero. */
  tramiteEstadoId: number;
  /** 'YYYY-MM-DD', o '' si no tiene fecha límite. */
  fechaLimite: string;
  notas: string;
  activo: boolean;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

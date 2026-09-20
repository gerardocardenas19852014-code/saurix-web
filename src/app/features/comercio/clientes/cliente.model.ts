export interface Cliente {
  id: number;
  nombre: string;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  /** Informativo únicamente — la baja en IndexedDB borra el registro (no hay archivado suave). */
  activo: boolean;
}

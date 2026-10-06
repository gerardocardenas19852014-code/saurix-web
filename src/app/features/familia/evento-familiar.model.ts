/**
 * Evento manual del Calendario familiar (aniversario, reunión, vacaciones,
 * etc.) — el calendario también muestra eventos calculados (cumpleaños,
 * documentos/pólizas por vencer, citas médicas) que NO viven en esta
 * tabla; esta entidad es solo para lo que no se deriva de otro dato ya
 * capturado. Ver familia.util.ts → eventosFamiliares().
 */
export interface EventoFamiliar {
  id: number;
  /** Opcional: a quién pertenece el evento, o null/0 si es de toda la familia. */
  miembroFamiliaId?: number | null;
  titulo: string;
  /** 'YYYY-MM-DD'. */
  fecha: string;
  notas: string;
  activo: boolean;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

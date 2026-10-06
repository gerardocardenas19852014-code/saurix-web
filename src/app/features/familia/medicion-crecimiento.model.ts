export interface MedicionCrecimiento {
  id: number;
  miembroFamiliaId: number;
  /** 'YYYY-MM-DD' — fecha en que se tomó la medición (no siempre es hoy). */
  fecha: string;
  pesoKg?: number | null;
  estaturaCm?: number | null;
  notas: string;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

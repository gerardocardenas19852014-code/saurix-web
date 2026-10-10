/**
 * Familiar "de referencia": alguien que pertenece al árbol genealógico pero
 * que NO tiene (ni necesita) una ficha completa en Miembros — típicamente
 * un pariente ya fallecido, o uno externo del que solo interesa dejar
 * constancia en el árbol (abuelos, bisabuelos, tíos lejanos, etc.).
 *
 * A propósito es más simple que MiembroFamilia: no lleva documentos, salud,
 * pólizas ni tarjeta de emergencia — solo lo mínimo para mostrarlo en el
 * árbol colgado de un miembro real. No se intenta encadenar un
 * ParienteReferencia con otro (sin padreId/madreId propios): si hiciera
 * falta mostrar una generación más arriba, se agrega otro registro
 * colgado del mismo miembro, con su propio texto de parentesco
 * (p.ej. "Bisabuelo paterno").
 */
export interface ParienteReferencia {
  id: number;
  /** De qué MiembroFamilia es pariente (obligatorio: siempre cuelga de alguien real). */
  miembroFamiliaId: number;
  nombre: string;
  /** Texto libre, p.ej. "Abuelo paterno", "Tío", "Bisabuela" — no usa el
   *  catálogo Parentesco (ese es relativo a un MiembroFamilia hijo/cónyuge
   *  concreto; aquí la relación es más variada y no necesita darse de alta
   *  antes de usarse, mismo criterio que las etiquetas de Proyectos). */
  parentesco: string;
  /** 'YYYY-MM-DD', opcional. */
  fechaNacimiento: string;
  fallecido: boolean;
  /** 'YYYY-MM-DD', opcional — solo tiene sentido si fallecido = true. */
  fechaFallecimiento: string;
  notas: string;
  activo: boolean;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

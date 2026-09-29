/**
 * Plantilla reutilizable de contenido para dar de alta un Documento nuevo
 * ya con una estructura de partida (secciones/encabezados fijos), en vez
 * de empezar siempre en blanco — pensado para tipos de documento que se
 * repiten (una receta, un manual con el mismo formato, etc.).
 */
export interface PlantillaDocumento {
  id: number;
  nombre: string;
  /** HTML del editor visual — mismo formato que Documento.contenido. */
  contenido: string;
  activo: boolean;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

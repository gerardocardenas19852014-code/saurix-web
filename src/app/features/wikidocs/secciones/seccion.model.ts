/**
 * Coincide 1:1 con SeccionDTO/SeccionDisplayObject reales de
 * PlataformaSaurix: {SeccionId, CategoriaId, Nombre} — sin Clave ni
 * EtiquetaCorta (esos campos no existen en el backend real, se habían
 * inventado antes de confirmar el DTO).
 */
export interface Seccion {
  id: number;
  nombre: string;
  categoriaId: number;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

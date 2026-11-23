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
  /** Mandato "WikiDocs: estandarización y organización del menú" (Fase B,
   *  nov-2026) — la columna ya existía en la base de datos (default true)
   *  pero el frontend nunca la exponía; se activa aquí siguiendo el mismo
   *  patrón que CategoriaProducto/Bodega/TipoSistema/Categoria
   *  (SAURIX-CAT-001 v1.1). */
  activo: boolean;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

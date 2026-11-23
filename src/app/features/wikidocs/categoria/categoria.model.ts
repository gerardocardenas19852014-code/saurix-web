/**
 * Coincide 1:1 con CategoriaDTO/CategoriaDisplayObject reales de
 * PlataformaSaurix: Categoria SOLO referencia a TipoSistema (no tiene
 * SeccionId propio — es Sección la que referencia a Categoria, no al revés).
 */
export interface Categoria {
  id: number;
  nombre: string;
  tipoSistemaId: number;
  /** Mandato "WikiDocs: estandarización y organización del menú" (Fase B,
   *  nov-2026) — la columna ya existía en la base de datos (default true)
   *  pero el frontend nunca la exponía; se activa aquí siguiendo el mismo
   *  patrón que CategoriaProducto/Bodega/TipoSistema (SAURIX-CAT-001 v1.1). */
  activo: boolean;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

export interface TipoSistema {
  id: number;
  nombre: string;
  /** Mandato "WikiDocs: estandarización y organización del menú" (Fase B,
   *  nov-2026) — la columna ya existía en la base de datos (default true)
   *  pero el frontend nunca la exponía; se activa aquí siguiendo el mismo
   *  patrón que CategoriaProducto/Bodega (SAURIX-CAT-001 v1.1). */
  activo: boolean;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

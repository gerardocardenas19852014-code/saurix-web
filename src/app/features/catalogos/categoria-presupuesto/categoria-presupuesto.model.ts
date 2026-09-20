/**
 * Catálogo compartido (Presupuesto Personal). Admite subcategorías a 2
 * niveles como máximo (una raíz y sus hijas directas — una hija no puede
 * volver a ser padre); esa regla la aplica la app, no hay jerarquía
 * arbitraria como en la geografía.
 */
export interface CategoriaPresupuesto {
  id: number;
  nombre: string;
  categoriaPresupuestoPadreId: number | null;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

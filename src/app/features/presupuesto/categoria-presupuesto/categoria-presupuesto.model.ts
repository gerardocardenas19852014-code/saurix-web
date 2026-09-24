/** Ahora viene del catálogo "Listas de valores" (Catálogos → Tipo de
 *  movimiento), grupo MovimientoPresupuestoTipo — mismo catálogo que usa
 *  MovimientoPresupuesto.tipo/MovimientoRecurrentePresupuesto.tipo. */
export type TipoCategoriaPresupuesto = string;

/**
 * Catálogo compartido (Presupuesto Personal). Admite subcategorías a 2
 * niveles como máximo (una raíz y sus hijas directas — una hija no puede
 * volver a ser padre); esa regla la aplica la app, no hay jerarquía
 * arbitraria como en la geografía. Una subcategoría siempre hereda el Tipo
 * de su padre (no puede tener uno distinto).
 *
 * `tipo` es `null` solo en categorías creadas ANTES de este campo — la app
 * las trata como válidas para Ingreso y Gasto hasta que alguien les
 * capture un Tipo desde este catálogo.
 */
export interface CategoriaPresupuesto {
  id: number;
  nombre: string;
  tipo: TipoCategoriaPresupuesto | null;
  categoriaPresupuestoPadreId: number | null;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

/**
 * Producto o servicio. Mismo criterio que se usaba en el módulo Comercio
 * (ya eliminado del sistema — ver historial de git, no revivido aquí):
 * `existencia` en NULL significa que es un SERVICIO (sin inventario que
 * controlar); con un número significa que es un producto físico con esa
 * existencia. No hay un campo "tipo" separado — el propio valor de
 * `existencia` ya distingue los dos casos.
 *
 * `costo` (para valorizar el stock) y `unidadMedidaId` son campos nuevos
 * que ese módulo anterior no tenía — se agregan desde el inicio porque
 * "Monitorea el valor del stock" (stock × costo) es parte del alcance de
 * Inventario, aunque la pantalla de valorización en sí se construya en una
 * siguiente etapa.
 */
export interface Producto {
  id: number;
  nombre: string;
  /** Código/SKU libre, opcional — no se valida unicidad en esta etapa. */
  codigo: string | null;
  categoriaProductoId: number;
  unidadMedidaId: number;
  descripcion: string | null;
  costo: number;
  precioUnitario: number;
  /** NULL = servicio (sin inventario); con número = producto físico con esa existencia. */
  existencia: number | null;
  /** Nivel mínimo deseado de existencia, para que Valor de stock pueda
   *  avisar cuáles productos ya están por debajo (ver valor-stock.component.ts).
   *  NULL = sin mínimo definido (no participa en la alerta). Solo tiene
   *  sentido para productos físicos (existencia !== null); se ignora en
   *  servicios. */
  nivelMinimo: number | null;
  /** Proveedor preferido para reabastecer este producto — NULL = sin asignar
   *  (ver proveedor.model.ts). Útil para Sugerencia de reposición, que
   *  muestra a quién comprarle cuando el producto está por debajo de su
   *  nivelMinimo. No aplica a servicios en la práctica, pero no se restringe
   *  a nivel de tipo porque algún servicio podría igual tener un proveedor
   *  habitual (p.ej. quien lo subcontrata). */
  proveedorId: number | null;
  activo: boolean;
}

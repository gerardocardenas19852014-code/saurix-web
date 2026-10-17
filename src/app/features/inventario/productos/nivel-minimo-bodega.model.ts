/**
 * Nivel mínimo deseado de un producto FÍSICO en UNA bodega concreta — a
 * diferencia de Producto.nivelMinimo (un solo valor global, ver
 * producto.model.ts), esto permite que el mismo producto tenga un mínimo
 * distinto en cada bodega (p.ej. 50 en la bodega principal, 5 en una
 * sucursal chica).
 *
 * Mientras un producto no tenga NINGÚN registro aquí, se sigue usando su
 * Producto.nivelMinimo "heredado" contra la existencia TOTAL (todas las
 * bodegas sumadas) — mismo patrón "heredado" que ExistenciaBodega con
 * Producto.existencia y ProductoProveedor con Producto.proveedorId. Ver
 * alertasStockBajo() en producto.util.ts, la ÚNICA función que debe leerse
 * para decidir si un producto (o una bodega suya) está en stock bajo.
 */
export interface NivelMinimoBodega {
  id: number;
  productoId: number;
  bodegaId: number;
  nivelMinimo: number;
}

/**
 * Existencia real de un Producto FÍSICO en una Bodega concreta — la fuente
 * de la verdad de "cuánto hay de qué, en dónde" (ver
 * movimiento-inventario.model.ts para el historial de cómo llegó ahí).
 *
 * Mientras un producto no tenga ningún registro aquí, se sigue usando su
 * Producto.existencia "heredado" como si fuera una sola bodega todavía sin
 * asignar — ver existenciaTotal() en producto.util.ts, la ÚNICA función que
 * debe leerse para MOSTRAR la existencia de un producto en cualquier
 * pantalla (nunca leer producto.existencia directo), para que Productos,
 * Valor de stock y Movimientos entre bodegas siempre coincidan.
 */
export interface ExistenciaBodega {
  id: number;
  productoId: number;
  bodegaId: number;
  existencia: number;
  /** Ubicación física dentro de la bodega (pasillo/anaquel/nivel, texto
   *  libre) — opcional, puramente informativa para agilizar el surtido o
   *  el conteo físico. NULL = sin ubicación capturada. Se edita inline
   *  desde la pestaña "Existencia por bodega" de Movimientos entre
   *  bodegas (ver movimientos-bodega.component.ts). */
  ubicacion: string | null;
}

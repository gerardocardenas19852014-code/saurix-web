/**
 * Registro de UN lote de un producto con control de caducidad (ver
 * Producto.manejaLotes — opt-in, solo para productos que lo necesitan).
 *
 * A propósito es un registro INFORMATIVO, no la fuente de la verdad de
 * existencia: `cantidad` aquí es lo que el usuario capturó a mano al dar
 * de alta/editar el lote (p.ej. "40 piezas del lote L-2026-10"), pero
 * ExistenciaBodega (ver ese modelo) sigue siendo quien de verdad lleva la
 * cuenta de cuánto hay — ambos se capturan por separado y PUEDEN
 * desalinearse si no se mantienen juntos. Se diseñó así a propósito para
 * no tener que rediseñar movimiento-inventario.service.ts/registrar()
 * (que no sabe nada de lotes) ni todas las pantallas que ya lo usan
 * (Movimientos entre bodegas, Órdenes de compra, Conteo físico) — ver el
 * backlog de mejoras de Inventario: si más adelante se necesita que la
 * existencia real se calcule SUMANDO lotes (control de inventario por
 * lote de verdad, tipo FIFO/FEFO), es un rediseño más grande que se
 * decidiría aparte.
 */
export interface LoteProducto {
  id: number;
  productoId: number;
  /** Opcional — en qué bodega está este lote, si se quiere precisar. */
  bodegaId: number | null;
  /** Número/clave de lote, texto libre. */
  lote: string;
  /** 'YYYY-MM-DD' — NULL = sin fecha de caducidad capturada (igual se
   *  puede usar el registro solo para llevar el número de lote). */
  fechaCaducidad: string | null;
  /** Cantidad informativa de este lote (ver el comentario de arriba) —
   *  NULL = no se capturó. */
  cantidad: number | null;
  notas: string | null;
  activo: boolean;
}

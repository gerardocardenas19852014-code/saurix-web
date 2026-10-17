/**
 * Devolución de uno o más renglones de una Venta ya cobrada — a diferencia
 * de Cancelar (ver VentaService.cancelar(), que anula TODA la venta), una
 * Devolución es parcial: solo los renglones/cantidades que el cliente
 * regresa, y la Venta original se queda "Completada" tal cual (ver
 * venta.model.ts → Venta.estado). Solo aplica a una venta que SIGUE
 * Completada — una ya Cancelada no se puede devolver encima porque su
 * existencia ya se repuso por completo al cancelarla.
 */
export interface Devolucion {
  id: number;
  folio: string;
  ventaId: number;
  fecha: string;
  usuarioId: number;
  motivo: string | null;
  /** Suma de DevolucionItem.subtotal — lo que se reembolsó en total. */
  totalReembolsado: number;
  activo: boolean;
}

/**
 * Un renglón devuelto — liga a un VentaItem concreto (ventaItemId) para
 * poder calcular cuánto de ESE renglón ya se devolvió antes (ver
 * DevolucionService.cantidadDisponibleParaDevolver()) y no dejar devolver
 * más de lo que se vendió. `productoId`/`bodegaId` se copian del
 * VentaItem original para reponer la existencia correcta (ver
 * DevolucionService.registrar() → MovimientoInventarioService).
 */
export interface DevolucionItem {
  id: number;
  devolucionId: number;
  ventaItemId: number;
  productoId: number | null;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  /** cantidad × precioUnitario — mismo criterio que VentaItem.subtotal,
   *  pero SIN descontoPct (se devuelve el precio neto que de verdad pagó
   *  ese renglón: VentaItem.subtotal / VentaItem.cantidad). */
  subtotal: number;
  bodegaId: number | null;
  activo: boolean;
}

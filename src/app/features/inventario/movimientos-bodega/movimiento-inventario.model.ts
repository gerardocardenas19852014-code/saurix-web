/**
 * Historial (bitácora) de movimientos de inventario entre bodegas — registro
 * de auditoría de cada cambio a ExistenciaBodega (ver ese modelo). Tres
 * tipos, distinguidos por si traen bodega de origen y/o destino:
 * - Entrada (bodegaOrigenId = null, bodegaDestinoId con valor): mercancía
 *   nueva, o la asignación inicial de la existencia "heredada" de un
 *   producto que aún no tenía ninguna bodega (ver
 *   movimientos-bodega.component.ts → asignarABodega()).
 * - Traspaso (ambas con valor): mueve cantidad de una bodega a otra — resta
 *   de origen, suma a destino.
 * - Salida/Ajuste (bodegaOrigenId con valor, bodegaDestinoId = null): resta
 *   de una bodega sin que vaya a ninguna otra — mermas, daños, correcciones
 *   de conteo.
 * Traspaso y Salida validan que origen tenga suficiente existencia antes de
 * guardar (ver guardar()), para no dejar una bodega en números negativos.
 */
export interface MovimientoInventario {
  id: number;
  productoId: number;
  bodegaOrigenId: number | null;
  bodegaDestinoId: number | null;
  cantidad: number;
  /** ISO 8601 (new Date().toISOString()) — fecha y hora del movimiento. */
  fecha: string;
  nota: string | null;
  /** Orden de compra que generó esta Entrada, cuando vino de una recepción
   *  (ver orden-compra.service.ts → recibir()) — null en cualquier otro
   *  movimiento (manual, traspaso, salida/ajuste, conteo físico). */
  ordenCompraId?: number | null;
  /** Costo unitario al que entró esta mercancía — solo se captura en
   *  entradas que vienen de recibir una Orden de compra (ver
   *  OrdenCompraItem.costoUnitario); se guarda aquí también para no
   *  depender de que la orden siga existiendo al consultar el historial. */
  costoUnitario?: number | null;
  /** true mientras un Traspaso está "en tránsito": ya se restó de
   *  bodegaOrigenId, pero TODAVÍA NO se suma a bodegaDestinoId — ver
   *  MovimientoInventarioService.enviarEnTransito()/confirmarRecepcionTransito().
   *  undefined/false en cualquier otro movimiento, y también en un
   *  Traspaso normal (el que no se marcó "en tránsito" al capturarlo, que
   *  sigue sumando al destino de inmediato como siempre — registrar() no
   *  cambió en nada). */
  enTransito?: boolean;
  /** ISO 8601 — cuándo se confirmó la recepción de un Traspaso en
   *  tránsito (ver enTransito). null/undefined mientras sigue pendiente,
   *  o si nunca fue un traspaso en tránsito. */
  fechaRecepcion?: string | null;
}

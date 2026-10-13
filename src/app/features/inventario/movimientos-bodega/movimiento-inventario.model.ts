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
}

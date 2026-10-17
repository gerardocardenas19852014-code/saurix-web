/**
 * Encabezado de UNA sesión de conteo físico ya guardada — lo que antes se
 * perdía (ver guardarCuadre() en conteo-fisico.component.ts): antes de esto,
 * un cuadre sin diferencias no dejaba ningún rastro, y uno CON diferencias
 * solo se veía indirectamente como ajustes sueltos en el historial de
 * Movimientos entre bodegas, sin nada que diga "esto fue UN conteo, hecho
 * tal día, por tal persona, en tal bodega, con tantos productos revisados".
 *
 * El detalle completo (TODOS los productos contados, no solo los que
 * tuvieron diferencia) vive en ConteoFisicoDetalle — ver ese modelo.
 */
export interface ConteoFisico {
  id: number;
  bodegaId: number;
  usuarioId: number;
  /** ISO datetime — a diferencia de MovimientoInventario.fecha (solo
   *  fecha, sin hora), aquí sí importa la hora: puede haber más de un
   *  conteo de la misma bodega el mismo día. */
  fecha: string;
  totalProductos: number;
  totalDiferencias: number;
  notas: string | null;
}

/**
 * Una línea de una sesión de conteo (ver ConteoFisico): el producto, lo que
 * decía el sistema y lo que de verdad se contó — se guarda SIEMPRE, aunque
 * `diferencia` sea 0, para que el historial muestre el conteo completo, no
 * solo las discrepancias (eso es justo lo que antes faltaba).
 */
export interface ConteoFisicoDetalle {
  id: number;
  conteoFisicoId: number;
  productoId: number;
  sistema: number;
  contado: number;
  /** contado - sistema, ya calculada y guardada (no se recalcula al leer el
   *  historial) — mismo criterio que MovimientoInventario, que tampoco
   *  recalcula nada al mostrar su historial. */
  diferencia: number;
}

/**
 * Línea de una Orden de compra (ver orden-compra.model.ts). `cantidadRecibida`
 * es un acumulado que solo mueve orden-compra.service.ts → recibir(): nunca
 * se edita a mano desde el formulario de la orden, para que siempre refleje
 * de verdad lo que ya entró a MovimientoInventario (ver ese servicio).
 *
 * `unidadId`/`factorConversion`: snapshot de en qué unidad se capturó ESTA
 * línea — ver Producto.unidadCompraId/factorConversionCompra y
 * factorConversionUnidad() en producto.util.ts. Se guarda congelado al
 * momento de crear la línea (no se recalcula si después cambia el factor
 * del producto), para que una orden ya guardada no cambie de cantidad al
 * recibir solo porque alguien editó el producto. `unidadId` null =
 * unidad base del producto (factor 1) — es el valor para TODAS las líneas
 * creadas antes de que existiera esta característica, así que no hace
 * falta backfill. `cantidad`/`costoUnitario`/`cantidadRecibida` siempre
 * quedan expresados en esta misma unidad (la de la línea); la conversión a
 * unidad base solo ocurre al recibir (ver recibir()), nunca aquí.
 */
export interface OrdenCompraItem {
  id: number;
  ordenCompraId: number;
  productoId: number;
  cantidad: number;
  costoUnitario: number;
  cantidadRecibida: number;
  unidadId: number | null;
  factorConversion: number;
}

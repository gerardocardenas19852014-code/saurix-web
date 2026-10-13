/**
 * Precio de un Producto dentro de una Lista de precios concreta (un
 * registro del catálogo "Tipo de lista de precio", p.ej. "Mayoreo" o
 * "Distribuidor" — ver tipo-lista-precio.model.ts). Si un producto NO
 * tiene registro aquí para una lista dada, esa lista simplemente no le
 * define un precio especial: se sigue usando su Producto.precioUnitario
 * base en su lugar (ver lista-precio-detalle.component.ts).
 */
export interface PrecioLista {
  id: number;
  tipoListaPrecioId: number;
  productoId: number;
  precio: number;
}

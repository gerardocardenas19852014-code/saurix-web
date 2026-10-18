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
  /** Nivel MÁXIMO deseado de existencia (lo opuesto a nivelMinimo) — para
   *  avisar cuando hay demasiado capital inmovilizado en un producto, no
   *  solo cuando falta. NULL = sin máximo definido (no participa en la
   *  alerta de sobre-stock). Igual que nivelMinimo, es un valor GLOBAL
   *  (no por bodega — a diferencia de NivelMinimoBodega, no se justificó
   *  todavía un "NivelMaximoBodega" propio, ya que sobre-stock es una
   *  alerta de bajo uso que no necesita tanta granularidad). Solo aplica a
   *  productos físicos; se ignora en servicios. */
  nivelMaximo: number | null;
  /** Proveedor preferido para reabastecer este producto — NULL = sin asignar
   *  (ver proveedor.model.ts). Útil para Sugerencia de reposición, que
   *  muestra a quién comprarle cuando el producto está por debajo de su
   *  nivelMinimo. No aplica a servicios en la práctica, pero no se restringe
   *  a nivel de tipo porque algún servicio podría igual tener un proveedor
   *  habitual (p.ej. quien lo subcontrata). */
  proveedorId: number | null;
  /** Unidad "de compra" alterna, distinta de unidadMedidaId (la unidad BASE
   *  en la que se lleva la existencia) — p.ej. existencia en Pieza pero se
   *  compra en Caja. NULL = no tiene unidad de compra alterna (se compra en
   *  la misma unidad base, como hasta ahora). Ver factorConversionCompra. */
  unidadCompraId: number | null;
  /** Opt-in: true si este producto se controla por lotes con fecha de
   *  caducidad (ver lote-producto.model.ts) — pensado para perecederos.
   *  Por default false: la gran mayoría de productos NO necesita esto, y
   *  activarlo no cambia nada del flujo normal de existencia/movimientos
   *  (LoteProducto es un registro informativo aparte, no reemplaza a
   *  ExistenciaBodega — ver el comentario completo en ese modelo). Solo
   *  aplica a productos físicos; se ignora en servicios. */
  manejaLotes: boolean;
  /** Cuántas unidadMedidaId (base) equivale CADA unidadCompraId — p.ej. 12
   *  si "Caja" trae 12 "Pieza". NULL junto con unidadCompraId = null (sin
   *  unidad de compra alterna). Ver factorConversionUnidad() en
   *  producto.util.ts, que es donde de verdad se usa este factor. */
  factorConversionCompra: number | null;
  /** Foto del producto en base64 (data URL), ya redimensionada/comprimida en
   *  el navegador antes de guardarse — mismo patrón que Miembro.foto (ver
   *  miembro-familia.model.ts). Opcional: sin foto se muestra un placeholder
   *  en el formulario. */
  foto?: string;
  /** Lo marca la empresa para resaltarlo en la sección "⭐ Destacados" del
   *  catálogo público (/tienda/:clave) — no afecta nada del inventario en
   *  sí, es puramente de presentación. Default false. */
  destacado: boolean;
  activo: boolean;
}

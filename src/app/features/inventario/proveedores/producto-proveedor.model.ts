/**
 * Proveedor de un Producto, con su propio precio de compra y tiempo de
 * entrega — reemplaza la idea de "un solo proveedor por producto" que
 * tenía `Producto.proveedorId` (ese campo se conserva, ver producto.model.ts,
 * como proveedor "heredado" mientras el producto no tenga ningún registro
 * aquí todavía — mismo criterio exacto que ExistenciaBodega vs
 * Producto.existencia, ver existenciaTotal() en producto.util.ts).
 *
 * `preferido` marca cuál de los proveedores de un producto es el que se usa
 * por default en Sugerencia de reposición y al generar una Orden de compra
 * (ver orden-compra.model.ts) — solo puede haber uno preferido por producto
 * a la vez; eso lo aplica la pantalla (ver proveedor-productos.component.ts
 * → marcarPreferido()), no hay constraint de base de datos para ello
 * (mismo criterio que el límite de 2 niveles de CategoriaPresupuesto,
 * documentado en esquema-tablas-saurix.md).
 */
export interface ProductoProveedor {
  id: number;
  productoId: number;
  proveedorId: number;
  precioCompra: number;
  /** Días estimados de entrega desde que se hace el pedido — opcional. */
  tiempoEntregaDias: number | null;
  preferido: boolean;
  activo: boolean;
}

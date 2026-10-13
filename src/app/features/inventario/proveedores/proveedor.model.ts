/**
 * Catálogo de proveedores — a quién comprarle cada producto. Mismo patrón
 * exacto que Bodega (ver bodega.model.ts): solo catálogo (alta/edición) por
 * ahora, sin órdenes de compra todavía — eso queda para una siguiente etapa
 * si se decide construirlo (ver Producto.proveedorId, que relaciona cada
 * producto con uno de estos).
 */
export interface Proveedor {
  id: number;
  nombre: string;
  /** Persona de contacto, opcional — no es el nombre del proveedor en sí. */
  contacto: string | null;
  telefono: string | null;
  correo: string | null;
  activo: boolean;
}

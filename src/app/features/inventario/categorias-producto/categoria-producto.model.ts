/** Catálogo de categorías de producto/servicio — mismo patrón que TicketTipo
 *  de Gestión de Proyectos (ver ticket-tipo.model.ts): catálogo propio del
 *  módulo, no una "Lista de valores" genérica, porque alimenta el combo de
 *  Producto (ver producto.model.ts). */
export interface CategoriaProducto {
  id: number;
  nombre: string;
  clave: string;
  descripcion: string | null;
  activo: boolean;
}

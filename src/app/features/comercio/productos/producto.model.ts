export interface Producto {
  id: number;
  categoriaProductoId: number;
  nombre: string;
  descripcion: string | null;
  precioUnitario: number;
  /** NULL = servicio (sin inventario); con número = producto físico. */
  existencia: number | null;
  activo: boolean;
}

export interface CategoriaProductoOpcion {
  id: number;
  nombre: string;
}

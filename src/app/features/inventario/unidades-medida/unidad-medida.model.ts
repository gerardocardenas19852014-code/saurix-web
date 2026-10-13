/** Catálogo de unidades de medida (Pieza, Kilogramo, Litro, Caja, Hora, …)
 *  — alimenta el combo de Producto (ver producto.model.ts). */
export interface UnidadMedida {
  id: number;
  nombre: string;
  clave: string;
  activo: boolean;
}

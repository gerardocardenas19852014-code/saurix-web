/**
 * Catálogo de bodegas/almacenes físicos (alta/edición). Operar el
 * inventario POR bodega (existencias separadas, traspasos, entradas,
 * salidas/ajustes y conteo físico) ya está construido — ver
 * ExistenciaBodega (existencia-bodega.model.ts), MovimientosBodegaComponent
 * y ConteoFisicoComponent. Producto.existencia solo se sigue usando como
 * respaldo "heredado" mientras un producto no tenga todavía ninguna bodega
 * asignada (ver existenciaTotal() en producto.util.ts).
 */
export interface Bodega {
  id: number;
  nombre: string;
  clave: string;
  direccion: string | null;
  activo: boolean;
}

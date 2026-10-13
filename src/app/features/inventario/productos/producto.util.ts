import { Producto } from './producto.model';
import { ExistenciaBodega } from '../movimientos-bodega/existencia-bodega.model';

/** Mismo formato que wallet.util.ts (Presupuesto Personal) — se repite aquí
 *  en vez de importar entre módulos para no acoplar Inventario a Presupuesto
 *  por un helper de 3 líneas. */
export function formatMoneda(valor: number): string {
  const signo = valor < 0 ? '-$' : '$';
  return signo + Math.abs(valor).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Existencia real de un producto: suma de sus registros en ExistenciaBodega
 * si ya tiene al menos uno, o su Producto.existencia "heredado" si todavía
 * no se le asignó ninguna bodega (ver existencia-bodega.model.ts). ÚNICA
 * función que debe leerse para MOSTRAR la existencia de un producto en
 * cualquier pantalla — nunca leer producto.existencia directo, para que
 * Productos, Valor de stock y Movimientos entre bodegas siempre coincidan.
 */
export function existenciaTotal(producto: Producto, existenciasBodega: ExistenciaBodega[]): number {
  const propias = existenciasBodega.filter((e) => e.productoId === producto.id);
  if (propias.length === 0) return producto.existencia ?? 0;
  return propias.reduce((acc, e) => acc + e.existencia, 0);
}

/** true si el producto ya tiene al menos un registro en ExistenciaBodega —
 *  a partir de ahí su existencia se maneja desde Movimientos entre bodegas,
 *  no editando directo el campo "Existencia inicial" de Productos (ver
 *  productos.component.ts → editar()). */
export function tieneBodegaAsignada(productoId: number, existenciasBodega: ExistenciaBodega[]): boolean {
  return existenciasBodega.some((e) => e.productoId === productoId);
}

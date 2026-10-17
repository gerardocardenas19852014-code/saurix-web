import { Producto } from './producto.model';
import { ExistenciaBodega } from '../movimientos-bodega/existencia-bodega.model';
import { NivelMinimoBodega } from './nivel-minimo-bodega.model';

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

/**
 * Costo promedio ponderado tras recibir una entrada nueva — usado al recibir
 * una Orden de compra (ver orden-compra.service.ts → recibir()), para que
 * Producto.costo (y por lo tanto "Valor de stock") refleje el costo real de
 * mezclar la existencia que ya había con la que acaba de entrar, en vez de
 * quedarse con un costo fijo editado a mano una sola vez.
 *
 * Fórmula estándar: (existencia_antes × costo_antes + cantidad_nueva ×
 * costo_nuevo) / (existencia_antes + cantidad_nueva). Si no había existencia
 * previa (producto nuevo o en cero), el costo nuevo simplemente reemplaza al
 * anterior — evita dividir entre cero y es el resultado correcto de todas
 * formas (la "mezcla" de 0 unidades con N unidades es, de por sí, el costo
 * de esas N).
 */
export function costoPromedioPonderado(
  existenciaAntes: number,
  costoAntes: number,
  cantidadNueva: number,
  costoNuevo: number,
): number {
  const existenciaDespues = existenciaAntes + cantidadNueva;
  if (existenciaDespues <= 0) return costoNuevo;
  return (existenciaAntes * costoAntes + cantidadNueva * costoNuevo) / existenciaDespues;
}

/** Una alerta de stock bajo ya resuelta: en qué bodega (o `null` si es la
 *  evaluación global "heredada", ver abajo), con qué existencia y contra
 *  qué mínimo. */
export interface AlertaStockBajo {
  bodegaId: number | null;
  existencia: number;
  nivelMinimo: number;
}

/**
 * Único punto para decidir si un producto está en stock bajo — y en cuál(es)
 * bodega(s) concretas, si ya tiene NivelMinimoBodega propios (ver
 * nivel-minimo-bodega.model.ts): ahí se evalúa bodega por bodega, cada una
 * contra su propio mínimo. Si el producto todavía no tiene ningún
 * NivelMinimoBodega, se cae al criterio "heredado" de siempre: existencia
 * TOTAL contra Producto.nivelMinimo, como una sola alerta con bodegaId null.
 * Los servicios (existencia === null) nunca generan alerta.
 *
 * Devuelve un arreglo (puede tener más de una alerta si varias bodegas del
 * mismo producto están bajas a la vez) en vez de un booleano, para que cada
 * consumidor (Valor de stock, Sugerencia de reposición, notificaciones
 * persistentes) decida cómo mostrarlas sin repetir esta lógica.
 */
export function alertasStockBajo(
  producto: Producto,
  existenciasBodega: ExistenciaBodega[],
  nivelesMinimoBodega: NivelMinimoBodega[],
): AlertaStockBajo[] {
  if (producto.existencia === null) return []; // servicio: sin inventario que monitorear

  const propios = nivelesMinimoBodega.filter((n) => n.productoId === producto.id);
  if (propios.length === 0) {
    // typeof === 'number' (no !== null): ver mismo comentario en valor-stock.component.ts.
    if (typeof producto.nivelMinimo !== 'number') return [];
    const existencia = existenciaTotal(producto, existenciasBodega);
    return existencia < producto.nivelMinimo ? [{ bodegaId: null, existencia, nivelMinimo: producto.nivelMinimo }] : [];
  }

  return propios
    .map((n) => ({
      bodegaId: n.bodegaId,
      existencia: existenciasBodega.find((e) => e.productoId === producto.id && e.bodegaId === n.bodegaId)?.existencia ?? 0,
      nivelMinimo: n.nivelMinimo,
    }))
    .filter((a) => a.existencia < a.nivelMinimo);
}

/**
 * Factor para convertir una cantidad capturada en `unidadId` a la unidad
 * BASE del producto (Producto.unidadMedidaId, la que de verdad lleva la
 * existencia) — usado por Órdenes de compra para poder capturar una línea
 * en la unidad de compra alterna del producto (p.ej. "Caja") sin que
 * ExistenciaBodega/Producto.costo terminen en esa unidad en vez de la base
 * (ver orden-compra.service.ts → recibir(), que es quien de verdad aplica
 * este factor al convertir cantidad/costo antes de registrar el movimiento).
 *
 * `unidadId` es la unidad elegida para la línea: null o igual a
 * unidadMedidaId = unidad base (factor 1, el caso de siempre). Si coincide
 * con unidadCompraId Y el producto de verdad tiene un factor definido, se
 * usa ese; cualquier otro caso (producto sin unidad de compra alterna,
 * unidadId no coincide con ninguna de las dos) también cae a 1 — más seguro
 * quedarse con la unidad base que inventar un factor.
 */
export function factorConversionUnidad(producto: Producto, unidadId: number | null): number {
  if (unidadId !== null && unidadId === producto.unidadCompraId && producto.factorConversionCompra) {
    return producto.factorConversionCompra;
  }
  return 1;
}

/**
 * Lo opuesto a alertasStockBajo(): true si el producto tiene nivelMaximo
 * definido y la existencia TOTAL (ver existenciaTotal()) ya lo superó —
 * señal de que hay más capital inmovilizado en ese producto del que se
 * quiere tener. A diferencia de alertasStockBajo(), no tiene variante por
 * bodega todavía (ver el comentario en Producto.nivelMaximo) — se evalúa
 * siempre contra la existencia total, nunca bodega por bodega.
 */
export function haySobreStock(producto: Producto, existenciasBodega: ExistenciaBodega[]): boolean {
  if (producto.existencia === null) return false; // servicio
  if (typeof producto.nivelMaximo !== 'number') return false;
  return existenciaTotal(producto, existenciasBodega) > producto.nivelMaximo;
}

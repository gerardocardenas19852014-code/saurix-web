export type EstadoVenta = 'Completada' | 'Cancelada';
export type MetodoPago = 'Efectivo' | 'Tarjeta' | 'Transferencia' | 'Crédito';

export const METODOS_PAGO: MetodoPago[] = ['Efectivo', 'Tarjeta', 'Transferencia', 'Crédito'];

/** Métodos de pago que SÍ representan dinero ya cobrado (ver
 *  TurnoCajaService.resumen()) — 'Crédito' se excluye a propósito: ese
 *  monto queda pendiente de cobrar (ver CuentaPorCobrar) hasta que el
 *  cliente abone, así que no debe contarse como vendido-y-cobrado. */
export const METODOS_PAGO_COBRADOS: MetodoPago[] = ['Efectivo', 'Tarjeta', 'Transferencia'];

/** Un abono a una cuenta por cobrar no puede ser, a su vez, "a crédito" —
 *  este tipo excluye esa opción en el formulario de abono. */
export type MetodoPagoCobrado = Exclude<MetodoPago, 'Crédito'>;

/**
 * Una venta ya cobrada — folio autogenerado 'VTA-0001' (ver
 * folioSugeridoVenta() en venta.service.ts), siempre ligada a un turno de
 * caja (turnoCajaId) y a un cliente (clienteId — el genérico "Público en
 * General" para venta simple/sin cliente real, ver cliente.service.ts).
 *
 * subtotal/descuento/total son el acumulado de VentaItem (ver ese modelo),
 * guardados aparte para no tener que sumar los renglones cada vez que se
 * lista el historial de ventas.
 */
export interface Venta {
  id: number;
  folio: string;
  fecha: string;
  turnoCajaId: number;
  clienteId: number;
  vendedorUsuarioId: number;
  subtotal: number;
  descuento: number;
  total: number;
  estado: EstadoVenta;
  notas: string | null;
  activo: boolean;
}

/**
 * Un renglón de la venta. `productoId: null` = "Venta simple" (ver pedido
 * del usuario: "venta simple es una venta sin necesidad [de] capturar
 * producto") — en ese caso `descripcion` es el texto libre que capturó el
 * cajero y no se mueve existencia (bodegaId también queda null). Con
 * `productoId` sí se descuenta existencia de `bodegaId` vía
 * MovimientoInventarioService (ver venta.service.ts → registrar()).
 */
export interface VentaItem {
  id: number;
  ventaId: number;
  productoId: number | null;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  descuentoPct: number;
  /** cantidad × precioUnitario × (1 − descuentoPct/100). */
  subtotal: number;
  bodegaId: number | null;
  activo: boolean;
}

/**
 * Un pago aplicado a la venta — puede haber varios (pago mixto, p.ej. mitad
 * Efectivo/mitad Tarjeta). `monto` es SIEMPRE la parte neta de la venta que
 * cubre ese pago (nunca lo que el cliente entregó) — así la suma de
 * VentaPago.monto de una venta siempre es igual a Venta.total, sin importar
 * cuánto efectivo entregó el cliente ni cuánto cambio se le dio.
 * montoRecibido/cambio son solo informativos, para el ticket y el arqueo de
 * caja, y solo tienen sentido en Efectivo (null en Tarjeta/Transferencia).
 */
export interface VentaPago {
  id: number;
  ventaId: number;
  metodoPago: MetodoPago;
  monto: number;
  montoRecibido: number | null;
  cambio: number | null;
  activo: boolean;
}

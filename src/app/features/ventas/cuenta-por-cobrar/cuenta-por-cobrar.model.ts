import { MetodoPagoCobrado } from '../venta/venta.model';

export type EstadoCuentaPorCobrar = 'Pendiente' | 'Pagada' | 'Cancelada';

/**
 * Lo que un cliente debe por haber comprado "a crédito"/"fiado" — se crea
 * automáticamente cuando una Venta incluye un VentaPago con
 * metodoPago: 'Crédito' (ver VentaService.registrar()). montoOriginal
 * nunca cambia; saldoPendiente baja con cada AbonoCuentaPorCobrar hasta
 * llegar a 0 (estado pasa a 'Pagada' solo). 'Cancelada' es cuando la venta
 * completa se cancela ANTES de tener ningún abono (ver
 * VentaService.cancelar() — si ya hay abonos, no se puede cancelar la
 * venta, para no dejar dinero ya cobrado sin explicación).
 */
export interface CuentaPorCobrar {
  id: number;
  ventaId: number;
  clienteId: number;
  fecha: string;
  montoOriginal: number;
  saldoPendiente: number;
  estado: EstadoCuentaPorCobrar;
  activo: boolean;
}

/** Un pago parcial o total contra una CuentaPorCobrar — turnoCajaId es el
 *  turno ABIERTO al momento de abonar (no el de la venta original), para
 *  que ese efectivo/tarjeta/transferencia entre al arqueo del turno en
 *  curso (ver TurnoCajaService.resumen()). */
export interface AbonoCuentaPorCobrar {
  id: number;
  cuentaPorCobrarId: number;
  fecha: string;
  monto: number;
  metodoPago: MetodoPagoCobrado;
  turnoCajaId: number;
  usuarioId: number;
  notas: string | null;
  activo: boolean;
}

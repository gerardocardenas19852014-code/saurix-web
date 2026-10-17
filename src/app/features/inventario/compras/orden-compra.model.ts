/**
 * Orden de compra — encabezado. Folio autogenerado 'OC-0001' en el
 * frontend, mismo patrón que Ticket.numeroTicket (ver folioSugerido() en
 * kanban.component.ts) y que Cotizacion.folio del antiguo módulo Comercio
 * (ver esquema-tablas-saurix.md, 2026-09-18) — aquí es global, no por
 * proveedor, porque es un solo folio consecutivo para toda la empresa.
 *
 * `bodegaDestinoId` es la bodega a la que entra la mercancía al recibirse
 * (ver OrdenCompraItem y orden-compra.service.ts → recibir()); todas las
 * líneas de una misma orden entran a la misma bodega — si algún día hace
 * falta recibir una orden repartida entre varias bodegas, se movería ese
 * campo a la línea, pero no hay necesidad de esa complejidad todavía.
 *
 * `estado` se recalcula solo, nunca se edita a mano salvo 'cancelada':
 * 'pendiente' (nada recibido), 'recibida_parcial' (algo pero no todo),
 * 'recibida_completa' (cantidadRecibida === cantidad en todas las líneas).
 */
export type EstadoOrdenCompra = 'pendiente' | 'recibida_parcial' | 'recibida_completa' | 'cancelada';

export interface OrdenCompra {
  id: number;
  folio: string;
  proveedorId: number;
  bodegaDestinoId: number;
  estado: EstadoOrdenCompra;
  /** ISO 8601 (new Date().toISOString()), fecha de alta de la orden. */
  fecha: string;
  /** Fecha estimada de entrega — opcional, informativa. */
  fechaEntregaEstimada: string | null;
  notas: string | null;
  activo: boolean;
}

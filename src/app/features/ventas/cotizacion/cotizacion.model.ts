export type EstadoCotizacion = 'Vigente' | 'Convertida' | 'Cancelada';

/**
 * Una cotización — MISMA forma que Venta (ver venta.model.ts) pero SIN
 * turnoCajaId ni efecto en inventario/caja: generarla no descuenta
 * existencia ni mueve dinero, es solo una propuesta de precio para el
 * cliente. Se convierte en una Venta real (ver CotizacionService.convertirAVenta())
 * cuando el cliente acepta — ahí sí se descuenta existencia y se cobra,
 * usando el mismo VentaService que usa Cobro.
 */
export interface Cotizacion {
  id: number;
  folio: string;
  fecha: string;
  /** Opcional — hasta cuándo es válido el precio cotizado. null = sin fecha límite. */
  fechaVigencia: string | null;
  clienteId: number;
  vendedorUsuarioId: number;
  subtotal: number;
  descuento: number;
  total: number;
  estado: EstadoCotizacion;
  notas: string | null;
  /** La Venta que resultó de convertir esta cotización — null mientras
   *  sigue Vigente/Cancelada. Ver CotizacionService.convertirAVenta(). */
  ventaConvertidaId: number | null;
  activo: boolean;
}

/** Un renglón de la cotización — mismos campos que VentaItem (ver
 *  venta.model.ts) salvo bodegaId: una cotización no reserva ni descuenta
 *  existencia de ninguna bodega todavía, eso se decide hasta convertir. */
export interface CotizacionItem {
  id: number;
  cotizacionId: number;
  productoId: number | null;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  descuentoPct: number;
  subtotal: number;
  activo: boolean;
}

export type EstadoVenta = 'Pendiente' | 'Pagada' | 'Cancelada';

export interface Venta {
  id: number;
  folio: string;
  clienteId: number;
  fecha: string;
  estado: EstadoVenta;
  ivaPct: number;
  notas: string | null;
  subtotal: number;
  iva: number;
  total: number;
  /** Liga a la cotización de origen cuando viene de "Convertir a venta". */
  cotizacionOrigenId: number | null;
  vendedorUsuarioId: number | null;
  activo: boolean;
}

export interface VentaItem {
  id: number;
  ventaId: number;
  productoId: number;
  cantidad: number;
  precioUnitario: number;
  descuentoPct: number;
}

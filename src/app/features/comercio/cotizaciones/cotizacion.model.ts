export type EstadoCotizacion = 'Borrador' | 'Enviada' | 'Aceptada' | 'Rechazada' | 'Convertida';

export interface Cotizacion {
  id: number;
  folio: string;
  clienteId: number;
  fecha: string;
  validaHasta: string | null;
  estado: EstadoCotizacion;
  ivaPct: number;
  notas: string | null;
  subtotal: number;
  iva: number;
  total: number;
  /** Informativo únicamente — no es filtro de propiedad (módulo compartido). */
  vendedorUsuarioId: number | null;
  activo: boolean;
}

export interface CotizacionItem {
  id: number;
  cotizacionId: number;
  productoId: number;
  cantidad: number;
  precioUnitario: number;
  descuentoPct: number;
}

export interface ClienteOpcion {
  id: number;
  nombre: string;
}

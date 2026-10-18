export type EstadoPedidoTienda = 'Pendiente' | 'Confirmado' | 'Descartado';

/** Un renglón del pedido — misma forma que LineaCarritoTienda en
 *  tienda.model.ts (es, literalmente, un snapshot de ese carrito en el
 *  momento en que el cliente dio "Enviar pedido"). */
export interface ItemPedidoTienda {
  productoId: number;
  nombreProducto: string;
  precioBase: number;
  opcionesElegidas: { grupoNombre: string; valorNombre: string; precioAdicional: number }[];
  cantidad: number;
}

/**
 * Un pedido recibido desde la tienda pública (/tienda/:clave) — ver
 * migración 30_pedidos_tienda.sql. Se crea solo (sin login) vía la RPC
 * seguridad.crear_pedido_tienda, justo cuando el cliente manda su pedido
 * por WhatsApp (ver CatalogoTiendaComponent.enviarPorWhatsapp()); el
 * WhatsApp sigue siendo el canal real de contacto, esto es solo para que
 * el pedido también aparezca aquí en vez de tener que volver a teclearlo.
 *
 * NO afecta inventario ni caja hasta que se Confirma — igual que
 * Cotizacion (ver cotizacion.model.ts) — momento en el que
 * PedidoTiendaService.confirmarComoVenta() registra una Venta real con el
 * mismo VentaService que usa Cobro.
 */
export interface PedidoTienda {
  id: number;
  empresaId: number;
  nombreCliente: string;
  telefonoCliente: string;
  notasCliente: string | null;
  ubicacionLat: number | null;
  ubicacionLng: number | null;
  items: ItemPedidoTienda[];
  total: number;
  estado: EstadoPedidoTienda;
  /** La Venta que resultó al confirmar — null mientras sigue Pendiente/Descartado. */
  ventaId: number | null;
  fechaCreacion: string;
  activo: boolean;
}

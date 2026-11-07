/** 'Expirado' es exclusivo de origen='menu_qr' (Bloque G — ver
 *  ventas.fn_expirar_ordenes_menu_qr(), corrida cada 15 min por pg_cron):
 *  una orden 'Pendiente' sin reclamar que lleva más de 2 horas sin pasar a
 *  caja. 'pedido_web' nunca expira por sí solo (se sigue resolviendo a
 *  mano, como siempre). */
export type EstadoPedidoTienda = 'Pendiente' | 'Confirmado' | 'Descartado' | 'Expirado';

/** De dónde nació el pedido (ver migración pedido_tienda_origen_folio_token
 *  y la sección 8 del plan "Menú + Mi orden"):
 *  - 'pedido_web': el flujo de siempre — carrito + datos/entrega + WhatsApp
 *    (ver CatalogoTiendaComponent.enviarPorWhatsapp()).
 *  - 'menu_qr': "Mostrar en caja" del modo Menú + Mi orden — NO es un
 *    pedido en línea, es solo una intención local que el cliente muestra
 *    en caja con folio/QR (ver confirmarMostrarEnCaja() en
 *    catalogo-tienda.component.ts). Nunca se infiere de otros campos: es
 *    una columna explícita (`origen`) puesta por el servidor. */
export type OrigenPedidoTienda = 'pedido_web' | 'menu_qr';

/** Un renglón del pedido — misma forma que LineaCarritoTienda en
 *  tienda.model.ts (es, literalmente, un snapshot de ese carrito en el
 *  momento en que el cliente dio "Enviar pedido"/"Mostrar en caja"). */
export interface ItemPedidoTienda {
  productoId: number;
  nombreProducto: string;
  precioBase: number;
  opcionesElegidas: { grupoNombre: string; valorNombre: string; precioAdicional: number }[];
  cantidad: number;
}

/**
 * Un pedido recibido desde la tienda pública (/tienda/:clave) — ver
 * migración 30_pedidos_tienda.sql. Se crea solo (sin login), vía la RPC
 * seguridad.crear_pedido_tienda ('pedido_web', justo cuando el cliente
 * manda su pedido por WhatsApp — ver
 * CatalogoTiendaComponent.enviarPorWhatsapp()) o vía
 * seguridad.crear_orden_menu_qr ('menu_qr', al presionar "Mostrar en
 * caja" en el modo Menú + Mi orden — ver confirmarMostrarEnCaja()). El
 * WhatsApp sigue siendo el canal real de contacto para 'pedido_web'; para
 * 'menu_qr' el folio/QR es el único contacto — ninguno de los dos crea
 * una Venta/MovimientoInventario por sí solo.
 *
 * NO afecta inventario ni caja hasta que se Confirma — igual que
 * Cotizacion (ver cotizacion.model.ts) — momento en el que CobroComponent
 * (vía "Cargar a venta", único camino desde Fase 5 2026-11 para los 2
 * orígenes) registra una Venta real con VentaService y
 * PedidoTiendaService.marcarConfirmadoDesdeVenta() vincula este pedido
 * con ella.
 */
export interface PedidoTienda {
  id: number;
  empresaId: number;
  origen: OrigenPedidoTienda;
  /** Folio corto y hablable (p.ej. "P-23"/"A-24") — NUNCA el id interno,
   *  ver ventas.fn_asignar_folio_pedido_tienda(). null solo en filas de
   *  antes de esa migración que aún no se hayan vuelto a tocar (no debería
   *  pasar tras el backfill, pero el tipo se deja honesto). */
  folio: string | null;
  /** Solo 'pedido_web': nombre que el cliente tecleó en el paso "Tus
   *  datos". null en 'menu_qr' (ver nombreMostrarEn). */
  nombreCliente: string | null;
  /** Solo 'pedido_web': obligatorio en ese flujo. null en 'menu_qr' (no
   *  se pide teléfono para Menú + Mi orden). */
  telefonoCliente: string | null;
  /** Solo 'menu_qr': el "¿A nombre de quién?" opcional del paso "Mostrar
   *  en caja" — nunca un Cliente formal. null en 'pedido_web' (usa
   *  nombreCliente) o si el cliente lo dejó en blanco. */
  nombreMostrarEn: string | null;
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

/** Un renglón de la bandeja (ver ventas.fn_pedidos_tienda_listar()) —
 *  SOLO lo necesario para la cuadrícula, nunca `items`/ubicación/notas:
 *  eso se trae a demanda al abrir "Ver detalle" (getById(), sin N+1). Es
 *  el mismo criterio de rendimiento ya aplicado en Kardex/catálogo
 *  público: nunca se descarga la tabla completa ni se filtra en el
 *  navegador — ver PedidosTiendaComponent.cargar(). */
export interface FilaPedidoTienda {
  id: number;
  fechaCreacion: string;
  folio: string | null;
  origen: OrigenPedidoTienda;
  /** Ya viene resuelto por el servidor: nombreCliente si es 'pedido_web',
   *  nombreMostrarEn si es 'menu_qr' (o cadena vacía si no dejó nombre). */
  cliente: string;
  /** null en 'menu_qr' — ver PedidoTienda.telefonoCliente. */
  telefonoCliente: string | null;
  total: number;
  estado: EstadoPedidoTienda;
  ventaId: number | null;
}

import { Injectable, signal } from '@angular/core';

/** Un renglón ya REVALIDADO del lado del servidor (ver
 *  ventas.fn_revalidar_items_pedido_tienda) — precioUnitario es el precio
 *  ACTUAL del catálogo, nunca el que traía guardado el pedido/orden.
 *  disponible=false no bloquea nada (el cajero puede seguir editando todo
 *  en Cobro), solo avisa que esa línea necesita revisión (producto
 *  desactivado/ya no existe/opción ya no existe). */
export interface LineaCargaVentaPedidoTienda {
  productoId: number | null;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  disponible: boolean;
  motivo: string | null;
}

export interface CargaVentaPedidoTienda {
  pedidoId: number;
  canal: string;
  lineas: LineaCargaVentaPedidoTienda[];
}

/**
 * Puente entre "Cargar a venta" (Pedidos web) y Cobro — ver la sección 8 y
 * 30 del plan "Menú + Mi orden": el cajero sigue viendo/editando TODO en
 * Cobro antes de cobrar (esto solo precarga el carrito), y "cargar a
 * venta" nunca es lo mismo que "venta cobrada" (eso lo marca
 * CobroComponent.confirmarCobro() hasta que la venta de verdad se
 * registra, ver PedidoTiendaService.marcarConfirmadoDesdeVenta()).
 *
 * Un solo valor pendiente, en memoria (sin localStorage): tomar() lo
 * consume y lo borra, así un refresh o una segunda visita a Cobro no
 * vuelve a precargar lo mismo por accidente — si se perdiera, el cajero
 * solo tiene que volver a "Cargar a venta" desde Pedidos web.
 */
@Injectable({ providedIn: 'root' })
export class CargaVentaPedidoTiendaService {
  private readonly pendiente = signal<CargaVentaPedidoTienda | null>(null);

  fijar(valor: CargaVentaPedidoTienda): void {
    this.pendiente.set(valor);
  }

  tomar(): CargaVentaPedidoTienda | null {
    const valor = this.pendiente();
    this.pendiente.set(null);
    return valor;
  }
}

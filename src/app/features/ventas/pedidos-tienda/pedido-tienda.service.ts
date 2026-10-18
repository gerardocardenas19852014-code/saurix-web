import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { VentaService, PagoEntrada } from '../venta/venta.service';
import { Venta } from '../venta/venta.model';
import { PedidoTienda } from './pedido-tienda.model';

/**
 * Confirmar/descartar pedidos web — confirmarComoVenta() SÍ toca
 * inventario y caja, reutilizando el MISMO VentaService.registrar() que
 * usa Cobro (igual patrón que CotizacionService.convertirAVenta()), así
 * que una venta nacida de un pedido web es indistinguible de una venta
 * normal en el Historial/Dashboard (misma tabla Venta, mismo folio
 * VTA-####, canal "Tienda en línea").
 */
@Injectable({ providedIn: 'root' })
export class PedidoTiendaService {
  private readonly data = inject(DataClientService);
  private readonly ventaService = inject(VentaService);

  /** Texto para Venta.notas — se conserva ahí el nombre/teléfono/nota/
   *  ubicación del cliente, porque la venta queda a nombre del cliente
   *  genérico (el pedido web no crea un Cliente con datos fiscales). */
  private notasVenta(pedido: PedidoTienda): string {
    const partes = [`Pedido web — Cliente: ${pedido.nombreCliente}, Tel: ${pedido.telefonoCliente}`];
    if (pedido.notasCliente) partes.push(`Nota: ${pedido.notasCliente}`);
    if (pedido.ubicacionLat !== null && pedido.ubicacionLng !== null) {
      partes.push(`Ubicación: https://www.google.com/maps?q=${pedido.ubicacionLat},${pedido.ubicacionLng}`);
    }
    return partes.join(' — ');
  }

  async confirmarComoVenta(
    pedido: PedidoTienda,
    params: { turnoCajaId: number; clienteId: number; vendedorUsuarioId: number; bodegaId: number | null; pago: PagoEntrada },
  ): Promise<Venta> {
    const venta = await this.ventaService.registrar({
      turnoCajaId: params.turnoCajaId,
      clienteId: params.clienteId,
      vendedorUsuarioId: params.vendedorUsuarioId,
      notas: this.notasVenta(pedido),
      canal: 'Tienda en línea',
      lineas: pedido.items.map((item) => ({
        productoId: item.productoId,
        descripcion:
          item.nombreProducto +
          (item.opcionesElegidas.length > 0
            ? ` (${item.opcionesElegidas.map((o) => `${o.grupoNombre}: ${o.valorNombre}`).join(', ')})`
            : ''),
        cantidad: item.cantidad,
        precioUnitario: item.precioBase + item.opcionesElegidas.reduce((acc, o) => acc + o.precioAdicional, 0),
        descuentoPct: 0,
        bodegaId: params.bodegaId,
      })),
      pagos: [params.pago],
    });

    await firstValueFrom(
      this.data.modificacion<PedidoTienda>('PedidoTienda', { ...pedido, estado: 'Confirmado', ventaId: venta.id }),
    );

    return venta;
  }

  async descartar(pedido: PedidoTienda): Promise<PedidoTienda> {
    if (pedido.estado !== 'Pendiente') return pedido;
    return firstValueFrom(this.data.modificacion<PedidoTienda>('PedidoTienda', { ...pedido, estado: 'Descartado' }));
  }
}

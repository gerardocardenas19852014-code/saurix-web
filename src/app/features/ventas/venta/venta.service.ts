import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { MovimientoInventarioService } from '../../inventario/movimientos-bodega/movimiento-inventario.service';
import { MetodoPago, Venta, VentaItem, VentaPago } from './venta.model';

/** Folio autogenerado 'VTA-0001' — mismo patrón exacto que
 *  folioSugeridoOrdenCompra() en orden-compra.service.ts: siguiente
 *  consecutivo global. */
export function folioSugeridoVenta(ventas: Venta[]): string {
  const numeros = ventas.map((v) => Number(v.folio.replace(/\D/g, '')) || 0);
  const siguiente = (numeros.length ? Math.max(...numeros) : 0) + 1;
  return `VTA-${String(siguiente).padStart(4, '0')}`;
}

export interface LineaVentaEntrada {
  /** null = renglón de "Venta simple" (texto libre, sin producto del catálogo). */
  productoId: number | null;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  descuentoPct: number;
  /** Bodega de la que se descuenta existencia — null en Venta simple o si
   *  el producto es un servicio (sin inventario, ver producto.model.ts). */
  bodegaId: number | null;
}

export interface PagoEntrada {
  metodoPago: MetodoPago;
  monto: number;
  montoRecibido: number | null;
  cambio: number | null;
}

/**
 * Único lugar que de verdad registra una venta — Venta + VentaItem(s) +
 * VentaPago(s), y descuenta existencia por cada renglón con producto real
 * (vía MovimientoInventarioService.registrar(), como una Salida/Ajuste: sin
 * bodega destino). Mismo criterio de "servicio único que escribe" que
 * OrdenCompraService.recibir().
 */
@Injectable({ providedIn: 'root' })
export class VentaService {
  private readonly data = inject(DataClientService);
  private readonly movimientoService = inject(MovimientoInventarioService);

  async registrar(params: {
    turnoCajaId: number;
    clienteId: number;
    vendedorUsuarioId: number;
    notas: string | null;
    lineas: LineaVentaEntrada[];
    pagos: PagoEntrada[];
  }): Promise<Venta> {
    const ventas = await firstValueFrom(this.data.list<Venta>('Venta'));
    const folio = folioSugeridoVenta(ventas);

    const subtotal = params.lineas.reduce((acc, l) => acc + l.cantidad * l.precioUnitario, 0);
    const descuento = params.lineas.reduce(
      (acc, l) => acc + l.cantidad * l.precioUnitario * (l.descuentoPct / 100),
      0,
    );
    const total = subtotal - descuento;

    const venta = await firstValueFrom(
      this.data.alta<Venta>('Venta', {
        folio,
        fecha: new Date().toISOString(),
        turnoCajaId: params.turnoCajaId,
        clienteId: params.clienteId,
        vendedorUsuarioId: params.vendedorUsuarioId,
        subtotal,
        descuento,
        total,
        estado: 'Completada',
        notas: params.notas,
        activo: true,
      }),
    );

    for (const linea of params.lineas) {
      const lineaSubtotal = linea.cantidad * linea.precioUnitario * (1 - linea.descuentoPct / 100);
      await firstValueFrom(
        this.data.alta<VentaItem>('VentaItem', {
          ventaId: venta.id,
          productoId: linea.productoId,
          descripcion: linea.descripcion,
          cantidad: linea.cantidad,
          precioUnitario: linea.precioUnitario,
          descuentoPct: linea.descuentoPct,
          subtotal: lineaSubtotal,
          bodegaId: linea.bodegaId,
          activo: true,
        }),
      );

      if (linea.productoId !== null && linea.bodegaId !== null) {
        await this.movimientoService.registrar({
          productoId: linea.productoId,
          bodegaOrigenId: linea.bodegaId,
          bodegaDestinoId: null,
          cantidad: linea.cantidad,
          nota: `Venta ${folio}`,
        });
      }
    }

    for (const pago of params.pagos) {
      await firstValueFrom(
        this.data.alta<VentaPago>('VentaPago', {
          ventaId: venta.id,
          metodoPago: pago.metodoPago,
          monto: pago.monto,
          montoRecibido: pago.montoRecibido,
          cambio: pago.cambio,
          activo: true,
        }),
      );
    }

    return venta;
  }

  /** Cancela una venta ya cobrada: repone la existencia de cada renglón con
   *  producto real (Entrada, lo opuesto exacto de la Salida que hizo
   *  registrar()) y marca la venta como Cancelada. Los pagos NO se tocan
   *  (quedan como quedaron, para que el historial siga mostrando cómo se
   *  cobró) — Cancelar es sobre inventario/estado, no sobre el dinero ya
   *  entregado (eso se maneja aparte, fuera del alcance de esta primera
   *  versión del módulo). */
  async cancelar(venta: Venta): Promise<Venta> {
    if (venta.estado === 'Cancelada') return venta;

    const items = await firstValueFrom(this.data.list<VentaItem>('VentaItem', { ventaId: venta.id }));
    for (const item of items) {
      if (item.productoId !== null && item.bodegaId !== null) {
        await this.movimientoService.registrar({
          productoId: item.productoId,
          bodegaOrigenId: null,
          bodegaDestinoId: item.bodegaId,
          cantidad: item.cantidad,
          nota: `Cancelación de venta ${venta.folio}`,
        });
      }
    }

    return firstValueFrom(this.data.modificacion<Venta>('Venta', { ...venta, estado: 'Cancelada' }));
  }
}

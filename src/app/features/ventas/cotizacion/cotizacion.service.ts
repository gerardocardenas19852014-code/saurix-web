import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { VentaService, LineaVentaEntrada, PagoEntrada } from '../venta/venta.service';
import { Venta } from '../venta/venta.model';
import { Cotizacion, CotizacionItem } from './cotizacion.model';

/** Folio autogenerado 'COT-0001' — mismo patrón que folioSugeridoVenta()
 *  (ver venta.service.ts). */
export function folioSugeridoCotizacion(cotizaciones: Cotizacion[]): string {
  const numeros = cotizaciones.map((c) => Number(c.folio.replace(/\D/g, '')) || 0);
  const siguiente = (numeros.length ? Math.max(...numeros) : 0) + 1;
  return `COT-${String(siguiente).padStart(4, '0')}`;
}

export interface LineaCotizacionEntrada {
  productoId: number | null;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  descuentoPct: number;
}

/**
 * Generar/convertir/cancelar cotizaciones — generar() NO toca inventario
 * ni caja (ver cotizacion.model.ts); convertirAVenta() sí, reutilizando el
 * MISMO VentaService.registrar() que usa Cobro, para que una venta nacida
 * de una cotización sea indistinguible de una venta normal en el
 * Historial/Dashboard (misma tabla Venta, mismo folio VTA-####).
 */
@Injectable({ providedIn: 'root' })
export class CotizacionService {
  private readonly data = inject(DataClientService);
  private readonly ventaService = inject(VentaService);

  async generar(params: {
    clienteId: number;
    vendedorUsuarioId: number;
    fechaVigencia: string | null;
    notas: string | null;
    lineas: LineaCotizacionEntrada[];
  }): Promise<Cotizacion> {
    const cotizaciones = await firstValueFrom(this.data.list<Cotizacion>('Cotizacion'));
    const folio = folioSugeridoCotizacion(cotizaciones);

    const subtotal = params.lineas.reduce((acc, l) => acc + l.cantidad * l.precioUnitario, 0);
    const descuento = params.lineas.reduce(
      (acc, l) => acc + l.cantidad * l.precioUnitario * (l.descuentoPct / 100),
      0,
    );
    const total = subtotal - descuento;

    const cotizacion = await firstValueFrom(
      this.data.alta<Cotizacion>('Cotizacion', {
        folio,
        fecha: new Date().toISOString(),
        fechaVigencia: params.fechaVigencia,
        clienteId: params.clienteId,
        vendedorUsuarioId: params.vendedorUsuarioId,
        subtotal,
        descuento,
        total,
        estado: 'Vigente',
        notas: params.notas,
        ventaConvertidaId: null,
        activo: true,
      }),
    );

    for (const linea of params.lineas) {
      const lineaSubtotal = linea.cantidad * linea.precioUnitario * (1 - linea.descuentoPct / 100);
      await firstValueFrom(
        this.data.alta<CotizacionItem>('CotizacionItem', {
          cotizacionId: cotizacion.id,
          productoId: linea.productoId,
          descripcion: linea.descripcion,
          cantidad: linea.cantidad,
          precioUnitario: linea.precioUnitario,
          descuentoPct: linea.descuentoPct,
          subtotal: lineaSubtotal,
          activo: true,
        }),
      );
    }

    return cotizacion;
  }

  /** Convierte una cotización Vigente en una Venta real — recibe
   *  turnoCajaId/bodegaId (una sola bodega para todos los renglones con
   *  producto real, mismo criterio que CobroComponent.bodegaVentaId) y el
   *  pago con el que se cobra. Marca la cotización como Convertida y
   *  guarda qué Venta resultó (Cotizacion.ventaConvertidaId). */
  async convertirAVenta(
    cotizacion: Cotizacion,
    items: CotizacionItem[],
    params: { turnoCajaId: number; bodegaId: number | null; pago: PagoEntrada },
  ): Promise<Venta> {
    const lineas: LineaVentaEntrada[] = items.map((item) => ({
      productoId: item.productoId,
      descripcion: item.descripcion,
      cantidad: item.cantidad,
      precioUnitario: item.precioUnitario,
      descuentoPct: item.descuentoPct,
      bodegaId: item.productoId !== null ? params.bodegaId : null,
    }));

    const venta = await this.ventaService.registrar({
      turnoCajaId: params.turnoCajaId,
      clienteId: cotizacion.clienteId,
      vendedorUsuarioId: cotizacion.vendedorUsuarioId,
      notas: `Convertida de cotización ${cotizacion.folio}`,
      canal: 'Cotización',
      lineas,
      pagos: [params.pago],
    });

    await firstValueFrom(
      this.data.modificacion<Cotizacion>('Cotizacion', {
        ...cotizacion,
        estado: 'Convertida',
        ventaConvertidaId: venta.id,
      }),
    );

    return venta;
  }

  async cancelar(cotizacion: Cotizacion): Promise<Cotizacion> {
    if (cotizacion.estado !== 'Vigente') return cotizacion;
    return firstValueFrom(this.data.modificacion<Cotizacion>('Cotizacion', { ...cotizacion, estado: 'Cancelada' }));
  }
}

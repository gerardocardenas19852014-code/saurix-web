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

/** Mismo criterio que folioSugeridoDespuesDe() en venta.service.ts: calcula
 *  el siguiente folio a partir de UN folio ya conocido (el de la última
 *  cotización, pedida con listarPagina(...,0,1,{columna:'id',direccion:'desc'}))
 *  en vez de descargar la tabla Cotizacion completa solo para esto (Fase 4,
 *  optimización de Cotizaciones, 2026-11). Si no existe ninguna cotización
 *  todavía, folioPrevio es null y el siguiente es COT-0001. */
export function folioSugeridoCotizacionDespuesDe(folioPrevio: string | null): string {
  const numero = folioPrevio ? Number(folioPrevio.replace(/\D/g, '')) || 0 : 0;
  return `COT-${String(numero + 1).padStart(4, '0')}`;
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
    // Antes descargaba la tabla Cotizacion COMPLETA solo para calcular el
    // siguiente folio (ver folioSugeridoCotizacion(), que sigue existiendo
    // para quien ya tenga el arreglo completo en memoria) -- ahora pide
    // UNA sola fila (la de mayor id) y calcula a partir de ese folio, mismo
    // criterio que folioSugeridoDespuesDe() en venta.service.ts (Fase 4,
    // 2026-11).
    const ultima = await firstValueFrom(
      this.data.listarPagina<Cotizacion>('Cotizacion', undefined, 0, 1, { columna: 'id', direccion: 'desc' }),
    );
    const folio = folioSugeridoCotizacionDespuesDe(ultima.filas[0]?.folio ?? null);

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

    // Fase 4 (2026-11): antes, si un renglón fallaba a mitad del ciclo (p.ej.
    // por una restricción de la base que un dato inválido del lado de
    // Angular no detectó -- ver Validators agregados a descuentoPct en
    // CotizacionesComponent), el encabezado de Cotizacion ya creado quedaba
    // huérfano (una cotización con 0 o solo algunos renglones, visible en el
    // listado). Ahora, si CUALQUIER renglón falla, se intenta borrar ese
    // encabezado (best-effort: si el borrado también fallara, no se vuelve a
    // mostrar un segundo error -- el que importa es el original) y luego se
    // vuelve a lanzar el error original, para que se siga viendo el MISMO
    // aviso de siempre (conToast() ya se encarga de mostrarlo una sola vez).
    try {
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
    } catch (error) {
      try {
        await firstValueFrom(this.data.baja('Cotizacion', cotizacion.id));
      } catch {
        // Mejor esfuerzo: si tampoco se pudo borrar el encabezado huérfano,
        // no se interrumpe el manejo del error original por esto.
      }
      throw error;
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

import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { MovimientoInventarioService } from '../../inventario/movimientos-bodega/movimiento-inventario.service';
import { MetodoPago, VentaItem, VentaPago } from '../venta/venta.model';
import { Devolucion, DevolucionItem } from './devolucion.model';

/** Folio autogenerado 'DEV-0001' — mismo patrón que folioSugeridoVenta()
 *  (ver venta.service.ts). */
export function folioSugeridoDevolucion(devoluciones: Devolucion[]): string {
  const numeros = devoluciones.map((d) => Number(d.folio.replace(/\D/g, '')) || 0);
  const siguiente = (numeros.length ? Math.max(...numeros) : 0) + 1;
  return `DEV-${String(siguiente).padStart(4, '0')}`;
}

/** Cuánto de ESE renglón de venta todavía se puede devolver — lo vendido
 *  menos lo ya devuelto en devoluciones anteriores sobre el mismo
 *  VentaItem. Pura (sin peticiones), para poder usarse tanto al armar el
 *  formulario como al validar antes de guardar. */
export function cantidadDisponibleParaDevolver(ventaItem: VentaItem, devolucionItemsPrevios: DevolucionItem[]): number {
  const yaDevuelto = devolucionItemsPrevios
    .filter((di) => di.ventaItemId === ventaItem.id && di.activo !== false)
    .reduce((acc, di) => acc + di.cantidad, 0);
  return Math.max(0, ventaItem.cantidad - yaDevuelto);
}

export interface LineaDevolucionEntrada {
  ventaItemId: number;
  productoId: number | null;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
  bodegaId: number | null;
}

/**
 * Registra una Devolución — Devolucion + DevolucionItem(s), repone
 * existencia de cada renglón con producto real (Entrada, mismo criterio
 * que VentaService.cancelar() pero solo de lo devuelto) y refleja el
 * reembolso como un VentaPago EN NEGATIVO ligado a la venta original —
 * así TurnoCajaService.resumen() (que solo suma VentaPago.monto por
 * método) ya lo resta solo, sin tener que tocar ese cálculo. El reembolso
 * queda atribuido al turno de la VENTA ORIGINAL (no al turno que esté
 * abierto ahora mismo al momento de devolver) — simplificación consciente
 * para no tener que rastrear "en qué turno se procesó cada devolución".
 */
@Injectable({ providedIn: 'root' })
export class DevolucionService {
  private readonly data = inject(DataClientService);
  private readonly movimientoService = inject(MovimientoInventarioService);

  async registrar(params: {
    ventaId: number;
    usuarioId: number;
    motivo: string | null;
    lineas: LineaDevolucionEntrada[];
    metodoReembolso: MetodoPago;
  }): Promise<Devolucion> {
    const devoluciones = await firstValueFrom(this.data.list<Devolucion>('Devolucion'));
    const folio = folioSugeridoDevolucion(devoluciones);
    const totalReembolsado = params.lineas.reduce((acc, l) => acc + l.subtotal, 0);

    const devolucion = await firstValueFrom(
      this.data.alta<Devolucion>('Devolucion', {
        folio,
        ventaId: params.ventaId,
        fecha: new Date().toISOString(),
        usuarioId: params.usuarioId,
        motivo: params.motivo,
        totalReembolsado,
        activo: true,
      }),
    );

    for (const linea of params.lineas) {
      await firstValueFrom(
        this.data.alta<DevolucionItem>('DevolucionItem', {
          devolucionId: devolucion.id,
          ventaItemId: linea.ventaItemId,
          productoId: linea.productoId,
          descripcion: linea.descripcion,
          cantidad: linea.cantidad,
          precioUnitario: linea.precioUnitario,
          subtotal: linea.subtotal,
          bodegaId: linea.bodegaId,
          activo: true,
        }),
      );

      if (linea.productoId !== null && linea.bodegaId !== null) {
        await this.movimientoService.registrar({
          productoId: linea.productoId,
          bodegaOrigenId: null,
          bodegaDestinoId: linea.bodegaId,
          cantidad: linea.cantidad,
          nota: `Devolución ${folio} de venta`,
        });
      }
    }

    await firstValueFrom(
      this.data.alta<VentaPago>('VentaPago', {
        ventaId: params.ventaId,
        metodoPago: params.metodoReembolso,
        monto: -totalReembolsado,
        montoRecibido: null,
        cambio: null,
        activo: true,
      }),
    );

    return devolucion;
  }
}

import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { MovimientoInventarioService } from '../movimientos-bodega/movimiento-inventario.service';
import { Producto } from '../productos/producto.model';
import { ExistenciaBodega } from '../movimientos-bodega/existencia-bodega.model';
import { existenciaTotal, costoPromedioPonderado } from '../productos/producto.util';
import { OrdenCompra, EstadoOrdenCompra } from './orden-compra.model';
import { OrdenCompraItem } from './orden-compra-item.model';

export interface LineaRecepcion {
  item: OrdenCompraItem;
  cantidadARecibir: number;
}

/**
 * Folio autogenerado 'OC-0001' — mismo patrón exacto que Ticket.numeroTicket
 * (ver folioSugerido() en kanban.component.ts): siguiente consecutivo global,
 * no por proveedor.
 */
export function folioSugeridoOrdenCompra(ordenes: OrdenCompra[]): string {
  const numeros = ordenes.map((o) => Number(o.folio.replace(/\D/g, '')) || 0);
  const siguiente = (numeros.length ? Math.max(...numeros) : 0) + 1;
  return `OC-${String(siguiente).padStart(4, '0')}`;
}

/**
 * Recepción de mercancía de una Orden de compra — único lugar que conecta
 * Compras con el resto de Inventario:
 *  1. Por cada línea con cantidad > 0 a recibir, convierte esa cantidad y su
 *     costo unitario a la unidad BASE del producto usando
 *     item.factorConversion (ver OrdenCompraItem — la línea puede estar
 *     capturada en una unidad de compra alterna, p.ej. "Caja", distinta de
 *     la que de verdad lleva la existencia): cantidadBase = cantidadARecibir
 *     × factor, costoBaseUnitario = item.costoUnitario ÷ factor (si el
 *     costo es "por Caja", el costo por unidad base es menor). factor = 1
 *     para toda línea sin unidad de compra alterna (el caso de siempre).
 *  2. Registra una Entrada real (ver MovimientoInventarioService.registrar())
 *     a la bodega destino de la orden, YA en unidad base, con
 *     ordenCompraId/costoUnitario para trazabilidad.
 *  3. Recalcula Producto.costo con costo promedio ponderado (ver
 *     costoPromedioPonderado() en producto.util.ts), usando la existencia
 *     total ANTES de esta entrada — también en unidad base.
 *  4. Acumula OrdenCompraItem.cantidadRecibida EN LA UNIDAD DE LA LÍNEA (sin
 *     convertir — "Pendiente"/"Recibido" en la ficha de la orden siguen
 *     comparándose contra item.cantidad, que está en esa misma unidad).
 *  5. Recalcula OrdenCompra.estado: 'recibida_completa' si TODAS las líneas
 *     ya están completas, 'recibida_parcial' si al menos una tiene algo mas
 *     no todo, 'pendiente' si ninguna tiene nada recibido todavía.
 *
 * Mismo criterio de "servicio único que escribe" que MovimientoInventarioService
 * (ver ese archivo): evita que la lógica de costeo/estado se reimplemente en
 * cada pantalla que reciba una orden y se desincronicen.
 */
@Injectable({ providedIn: 'root' })
export class OrdenCompraService {
  private readonly data = inject(DataClientService);
  private readonly movimientoService = inject(MovimientoInventarioService);

  async recibir(orden: OrdenCompra, lineas: LineaRecepcion[]): Promise<void> {
    const aplicar = lineas.filter((l) => l.cantidadARecibir > 0);
    if (aplicar.length === 0) return;

    const productos = await firstValueFrom(this.data.list<Producto>('Producto'));
    const productosPorId = new Map(productos.map((p) => [p.id, p]));

    for (const { item, cantidadARecibir } of aplicar) {
      const producto = productosPorId.get(item.productoId);

      // Existencia total ANTES de esta entrada, para el costo promedio ponderado.
      const existenciasBodega = await firstValueFrom(this.data.list<ExistenciaBodega>('ExistenciaBodega'));
      const existenciaAntes = producto ? existenciaTotal(producto, existenciasBodega) : 0;
      const costoAntes = producto?.costo ?? 0;

      // La línea puede estar capturada en una unidad de compra alterna del
      // producto (p.ej. "Caja") — factorConversion siempre viene ya
      // congelado en el item (ver OrdenCompraItem), 1 para toda línea sin
      // unidad alterna. Existencia/costo SIEMPRE se mueven en unidad base.
      const factor = item.factorConversion || 1;
      const cantidadBase = cantidadARecibir * factor;
      const costoBaseUnitario = item.costoUnitario / factor;

      await this.movimientoService.registrar({
        productoId: item.productoId,
        bodegaOrigenId: null,
        bodegaDestinoId: orden.bodegaDestinoId,
        cantidad: cantidadBase,
        nota: `Recepción de orden de compra ${orden.folio}`,
        ordenCompraId: orden.id,
        costoUnitario: costoBaseUnitario,
      });

      if (producto) {
        const nuevoCosto = costoPromedioPonderado(existenciaAntes, costoAntes, cantidadBase, costoBaseUnitario);
        await firstValueFrom(this.data.modificacion<Producto>('Producto', { ...producto, costo: nuevoCosto }));
      }

      await firstValueFrom(
        this.data.modificacion<OrdenCompraItem>('OrdenCompraItem', {
          ...item,
          cantidadRecibida: item.cantidadRecibida + cantidadARecibir,
        }),
      );
    }

    const items = await firstValueFrom(this.data.list<OrdenCompraItem>('OrdenCompraItem', { ordenCompraId: orden.id }));
    const estado = this.calcularEstado(items);
    if (estado !== orden.estado) {
      await firstValueFrom(this.data.modificacion<OrdenCompra>('OrdenCompra', { ...orden, estado }));
    }
  }

  private calcularEstado(items: OrdenCompraItem[]): EstadoOrdenCompra {
    if (items.length === 0) return 'pendiente';
    const todasCompletas = items.every((i) => i.cantidadRecibida >= i.cantidad);
    if (todasCompletas) return 'recibida_completa';
    const algoRecibido = items.some((i) => i.cantidadRecibida > 0);
    return algoRecibido ? 'recibida_parcial' : 'pendiente';
  }
}

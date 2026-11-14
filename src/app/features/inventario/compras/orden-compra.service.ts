import { Injectable, inject } from '@angular/core';
import { OrdenCompra } from './orden-compra.model';
import { OrdenCompraItem } from './orden-compra-item.model';
import { SupabaseService } from '../../../core/services/supabase.service';

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
 * Compras con el resto de Inventario.
 *
 * MANDATO 72 (B5.4): antes, recibir() hacía 1 carga completa de Producto +
 * por cada línea 1 carga completa de ExistenciaBodega + 1 registro de
 * movimiento + 1 actualización de Producto.costo + 1 actualización de
 * OrdenCompraItem (4 llamadas HTTP secuenciales por línea, sin transacción
 * ni candados) — además de 2 cargas de tabla COMPLETA sin filtro, que
 * DataClientService.list() trunca silenciosamente a 1000 filas: pasado ese
 * umbral de Producto o de ExistenciaBodega, el costeo quedaba mal calculado
 * sin ningún error visible. Ahora TODO el trabajo (validar orden/líneas/
 * productos, calcular el costo promedio ponderado con una consulta acotada
 * por producto, registrar los movimientos, actualizar cantidadRecibida y
 * recalcular estado) ocurre en una sola llamada a la función RPC
 * inventario.fn_orden_compra_recibir, dentro de una única transacción
 * atómica de Postgres — sin carga de tablas completas, con todo o nada si
 * cualquier línea falla. Ver esa función (su propio comentario de diseño)
 * para el detalle de candados/concurrencia/idempotencia.
 *
 * El parámetro de idempotencia (operacionId) protege dos escenarios reales,
 * verificados con conexiones concurrentes de verdad en entorno de prueba
 * local: (a) un reintento de transporte (la respuesta se pierde pero la
 * petición sí llegó) reutiliza el MISMO id dentro de esta misma llamada, así
 * que el servidor reconoce la operación y no la vuelve a aplicar; (b) un
 * doble clic/doble llamada de recibir() para la MISMA orden mientras la
 * primera todavía está en curso se colapsa en una sola petición real (ver
 * el mapa `enCurso` abajo) en vez de mandar dos peticiones con ids
 * distintos, que el servidor sí trataría como dos recepciones separadas.
 */
@Injectable({ providedIn: 'root' })
export class OrdenCompraService {
  private readonly sb = inject(SupabaseService).cliente;

  /** Recepciones en curso por orden — ver comentario de clase (doble clic). */
  private readonly enCurso = new Map<number, Promise<void>>();

  async recibir(orden: OrdenCompra, lineas: LineaRecepcion[]): Promise<void> {
    const existente = this.enCurso.get(orden.id);
    if (existente) return existente;

    const promesa = this.recibirInterno(orden, lineas).finally(() => {
      this.enCurso.delete(orden.id);
    });
    this.enCurso.set(orden.id, promesa);
    return promesa;
  }

  private async recibirInterno(orden: OrdenCompra, lineas: LineaRecepcion[]): Promise<void> {
    const aplicar = lineas.filter((l) => l.cantidadARecibir > 0);
    if (aplicar.length === 0) return;

    const payload = aplicar.map((l) => ({
      orden_compra_item_id: l.item.id,
      cantidad: l.cantidadARecibir,
    }));

    const { error } = await this.sb.schema('inventario').rpc('fn_orden_compra_recibir', {
      p_orden_id: orden.id,
      p_lineas: payload,
      p_operacion_id: crypto.randomUUID(),
    });

    if (error) throw error;
  }
}

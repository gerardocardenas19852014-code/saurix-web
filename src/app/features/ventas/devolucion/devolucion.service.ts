import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { MovimientoInventarioService } from '../../inventario/movimientos-bodega/movimiento-inventario.service';
import { MetodoPago, VentaItem, VentaPago } from '../venta/venta.model';
import { redondear } from '../ventas.util';
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

/** Importe neto de UNA línea de devolución — respeta el descuento que ya
 *  traía ese renglón de venta (precio unitario neto = subtotal del
 *  renglón / su cantidad vendida; VentaItem no tiene ningún campo de
 *  impuesto separado — ver venta.model.ts — así que no hay nada más que
 *  "respetar" ahí). cantidad <= 0 o item.cantidad <= 0 siempre da $0,
 *  nunca división por cero. Pura — usada tanto por el formulario
 *  (totalDevolucionActual()) como por confirmarDevolucion() al armar las
 *  líneas que se envían a registrar(). */
export function calcularSubtotalDevolucion(item: Pick<VentaItem, 'cantidad' | 'subtotal'>, cantidad: number): number {
  if (cantidad <= 0 || item.cantidad <= 0) return 0;
  const precioNeto = item.subtotal / item.cantidad;
  return redondear(cantidad * precioNeto);
}

/** La primera línea con cantidad positiva pero importe calculado en $0 (o
 *  negativo) — nunca debe llegar a registrarse (hallazgo QA "Devolución
 *  parcial: total a reembolsar en $0"). undefined si todas las líneas con
 *  cantidad > 0 tienen un importe > 0. Pura — usada tanto por el
 *  formulario (para avisar antes de intentar guardar) como por
 *  registrar() (última defensa, por si el formulario se saltó). */
export function lineaDevolucionEnCeros(lineas: LineaDevolucionEntrada[]): LineaDevolucionEntrada | undefined {
  return lineas.find((l) => l.cantidad > 0 && l.subtotal <= 0);
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

/** Lo que ya se llegó a escribir en esta llamada a registrar() — para que,
 *  si algo truena a medio camino, compensar() sepa exactamente qué revertir. */
interface EscriturasRealizadas {
  devolucionId: number | null;
  devolucionItemIds: number[];
  ventaPagoId: number | null;
}

/**
 * Registra una Devolución — Devolucion + DevolucionItem(s), refleja el
 * reembolso como un VentaPago EN NEGATIVO ligado a la venta original —
 * así cualquier suma de VentaPago.monto por método (ver
 * dashboard-ventas.component.ts) ya lo resta solo, sin tener que tocar ese
 * cálculo — y repone existencia de cada renglón con producto real
 * (Entrada, mismo criterio que VentaService.cancelar() pero solo de lo
 * devuelto). El reembolso queda atribuido al turno de la VENTA ORIGINAL
 * (no al turno que esté abierto ahora mismo al momento de devolver) —
 * simplificación consciente para no tener que rastrear "en qué turno se
 * procesó cada devolución" (turno que, desde Mandato 86, el usuario ya ni
 * siquiera ve).
 *
 * CORRECCIÓN (hallazgo QA nov-2026, "Devolución parcial: total a
 * reembolsar en $0" + "evitar devoluciones duplicadas y registros
 * parciales ante errores"): esta operación todavía NO tiene un RPC
 * atómico en PostgreSQL (a diferencia de VentaService.registrar()/
 * cancelar() o inventario.fn_movimiento_masivo_registrar) — es una
 * secuencia de escrituras REST independientes, cada una exitosa por su
 * cuenta pero sin una transacción de base de datos que las una. Mientras
 * no exista ese RPC (propuesto aparte — ver SQL entregado por separado —
 * pendiente de autorización porque modificaría PRODUCCIÓN), este método:
 *   1. Valida TODO antes de escribir nada (ninguna línea con cantidad > 0
 *      pero importe calculado en $0 o negativo — sin esto, nunca se habría
 *      llegado ni a crear filas con ese contenido).
 *   2. Escribe primero las filas que, si algo sale mal después, se pueden
 *      deshacer con un simple DELETE sin ningún efecto colateral
 *      (Devolucion → DevolucionItem(s) → VentaPago) y DEJA AL FINAL el
 *      único paso con un efecto físico real (reponer existencia en
 *      inventario.movimiento_inventario vía el RPC atómico existente) —
 *      así, si algo falla ANTES de ese último paso, deshacerlo nunca toca
 *      inventario.
 *   3. Si falla a medio camino de reponer existencia (ya se repuso la
 *      bodega de algunas líneas y la siguiente truena), compensar()
 *      revierte cada reposición que sí se alcanzó a aplicar con un
 *      movimiento contrario (Salida de esa misma bodega) antes de borrar
 *      las filas creadas y relanzar el error — para que la pantalla nunca
 *      muestre, ni deje en la base de datos, una devolución "a medias".
 * Esto reduce mucho, pero no elimina del todo, la ventana de condición de
 * carrera entre dos devoluciones simultáneas sobre el mismo renglón de
 * venta (dos pestañas/usuarios devolviendo al mismo tiempo) — eso solo se
 * cierra de verdad con el RPC atómico propuesto, que validaría y
 * escribiría todo dentro de una sola transacción de Postgres.
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
    if (params.lineas.length === 0) {
      throw new Error('La devolución no tiene ninguna línea con cantidad a devolver.');
    }
    // Nunca procesar un renglón con cantidad positiva cuyo importe
    // calculado sea $0 (o negativo) — el síntoma exacto del hallazgo QA.
    const lineaInvalida = lineaDevolucionEnCeros(params.lineas);
    if (lineaInvalida) {
      throw new Error(
        `El importe calculado para "${lineaInvalida.descripcion}" es $0.00 — no se puede registrar una devolución en ceros.`,
      );
    }

    const devoluciones = await firstValueFrom(this.data.list<Devolucion>('Devolucion'));
    const folio = folioSugeridoDevolucion(devoluciones);
    const totalReembolsado = params.lineas.reduce((acc, l) => acc + l.subtotal, 0);

    const escrituras: EscriturasRealizadas = { devolucionId: null, devolucionItemIds: [], ventaPagoId: null };
    const movimientosAplicados: LineaDevolucionEntrada[] = [];

    try {
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
      escrituras.devolucionId = devolucion.id;

      for (const linea of params.lineas) {
        const item = await firstValueFrom(
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
        escrituras.devolucionItemIds.push(item.id);
      }

      const pago = await firstValueFrom(
        this.data.alta<VentaPago>('VentaPago', {
          ventaId: params.ventaId,
          metodoPago: params.metodoReembolso,
          monto: -totalReembolsado,
          montoRecibido: null,
          cambio: null,
          activo: true,
        }),
      );
      escrituras.ventaPagoId = pago.id;

      // Último paso — el ÚNICO con un efecto físico real (repone
      // existencia). Si truena a medio camino, el catch de abajo revierte
      // exactamente lo que sí se alcanzó a aplicar.
      for (const linea of params.lineas) {
        if (linea.productoId !== null && linea.bodegaId !== null) {
          await this.movimientoService.registrar({
            productoId: linea.productoId,
            bodegaOrigenId: null,
            bodegaDestinoId: linea.bodegaId,
            cantidad: linea.cantidad,
            nota: `Devolución ${folio} de venta`,
          });
          movimientosAplicados.push(linea);
        }
      }

      return devolucion;
    } catch (error) {
      await this.compensar(escrituras, movimientosAplicados, folio);
      throw error;
    }
  }

  /** Mejor esfuerzo para deshacer lo que sí se llegó a escribir cuando un
   *  paso posterior falla a medio camino — ver el comentario de clase.
   *  Revierte en orden inverso al de creación (primero lo más "físico":
   *  las reposiciones de existencia que sí se aplicaron; al final la fila
   *  Devolucion). Nunca vuelve a lanzar: si la propia compensación falla,
   *  solo se registra en consola — el error original ya se relanza hacia
   *  el usuario desde registrar(), y una segunda excepción aquí solo
   *  ocultaría esa primera. */
  private async compensar(
    escrituras: EscriturasRealizadas,
    movimientosAplicados: LineaDevolucionEntrada[],
    folio: string,
  ): Promise<void> {
    for (const linea of movimientosAplicados) {
      if (linea.productoId === null || linea.bodegaId === null) continue;
      try {
        // Movimiento contrario exacto: lo que se repuso como Entrada a
        // bodegaId se retira con una Salida de esa misma bodega — mismo
        // RPC atómico, nunca se edita el movimiento original.
        await this.movimientoService.registrar({
          productoId: linea.productoId,
          bodegaOrigenId: linea.bodegaId,
          bodegaDestinoId: null,
          cantidad: linea.cantidad,
          nota: `Reversión automática — devolución ${folio} no se completó`,
        });
      } catch (e) {
        console.error('No se pudo revertir automáticamente la reposición de existencia de la devolución fallida', folio, linea, e);
      }
    }
    if (escrituras.ventaPagoId !== null) {
      try {
        await firstValueFrom(this.data.baja('VentaPago', escrituras.ventaPagoId));
      } catch (e) {
        console.error('No se pudo eliminar el VentaPago de la devolución fallida', folio, escrituras.ventaPagoId, e);
      }
    }
    for (const id of escrituras.devolucionItemIds) {
      try {
        await firstValueFrom(this.data.baja('DevolucionItem', id));
      } catch (e) {
        console.error('No se pudo eliminar un DevolucionItem de la devolución fallida', folio, id, e);
      }
    }
    if (escrituras.devolucionId !== null) {
      try {
        await firstValueFrom(this.data.baja('Devolucion', escrituras.devolucionId));
      } catch (e) {
        console.error('No se pudo eliminar la Devolucion fallida', folio, escrituras.devolucionId, e);
      }
    }
  }
}

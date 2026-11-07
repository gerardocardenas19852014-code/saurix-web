import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { MetodoPago, Venta } from './venta.model';

/** Folio autogenerado 'VTA-0001' — mismo patrón exacto que
 *  folioSugeridoOrdenCompra() en orden-compra.service.ts: siguiente
 *  consecutivo global. Usado SOLO como hint visual ("Folio sugerido") en
 *  el encabezado de Cobro antes de cobrar — el folio real y definitivo lo
 *  asigna ventas.fn_venta_registrar() del lado del servidor (bajo un
 *  advisory lock por empresa, ver ese archivo SQL), nunca este cálculo. */
export function folioSugeridoVenta(ventas: Venta[]): string {
  const numeros = ventas.map((v) => Number(v.folio.replace(/\D/g, '')) || 0);
  const siguiente = (numeros.length ? Math.max(...numeros) : 0) + 1;
  return `VTA-${String(siguiente).padStart(4, '0')}`;
}

/** Mismo cálculo que folioSugeridoVenta(), pero a partir de UN folio ya
 *  conocido (el de la venta que el servidor acaba de registrar) — para no
 *  volver a descargar Venta completa solo para recalcular el siguiente
 *  folio después de cobrar (ver Bloque "eliminar 8 cargas" de Cobro,
 *  2026-11). Los folios los asigna fn_venta_registrar() en orden
 *  estrictamente creciente bajo un advisory lock, así que el folio de la
 *  venta recién registrada siempre es, por construcción, el más alto que
 *  existe en ese momento. */
export function folioSugeridoDespuesDe(folio: string): string {
  const numero = Number(folio.replace(/\D/g, '')) || 0;
  return `VTA-${String(numero + 1).padStart(4, '0')}`;
}

/** Sugerencias para el <datalist> de Cobro — Venta.canal es texto LIBRE a
 *  propósito (ver venta.model.ts), esto es solo para no escribir siempre
 *  lo mismo a mano; el cajero puede teclear cualquier otro valor. */
export const CANALES_SUGERIDOS: string[] = ['Mostrador', 'Tienda en línea', 'WhatsApp', 'Teléfono', 'Facebook/Instagram'];

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
 * VentaPago(s), descuenta existencia por cada renglón con producto real y
 * aplica el programa de lealtad, TODO en una sola operación transaccional
 * (ventas.fn_venta_registrar) — mismo patrón que
 * inventario.fn_orden_compra_guardar: si algo falla a mitad, Postgres
 * revierte TODO (ya no puede quedar una Venta registrada con pagos sin
 * aplicar, o con el descuento de inventario de solo algunos renglones).
 *
 * Antes de esta homologación (Bloque F), este método hacía ~15-16
 * llamadas HTTP sueltas y secuenciales (una por cada insert), cada una un
 * punto de falla parcial independiente — ver
 * tienda-publica-homologacion-integral-2026-11 / el reporte de auditoría
 * de Ventas/Cobro para el detalle completo de la brecha encontrada.
 */
@Injectable({ providedIn: 'root' })
export class VentaService {
  private readonly data = inject(DataClientService);
  private readonly sb = inject(SupabaseService).cliente;

  async registrar(params: {
    turnoCajaId: number;
    clienteId: number;
    vendedorUsuarioId: number;
    notas: string | null;
    /** Texto libre, igual que Venta.canal — null/"" = mostrador normal. */
    canal: string | null;
    lineas: LineaVentaEntrada[];
    pagos: PagoEntrada[];
    /** Puntos del programa de lealtad que el cliente canjea en ESTA venta.
     *  La tasa/el estado del programa y si el cliente es el genérico se
     *  revalidan del lado del servidor dentro de fn_venta_registrar —
     *  nunca se confía en un descuento ya calculado por la UI. */
    puntosACanjear?: number;
  }): Promise<Venta> {
    const { data: ventaId, error } = await this.sb.schema('ventas').rpc('fn_venta_registrar', {
      p_turno_caja_id: params.turnoCajaId,
      p_cliente_id: params.clienteId,
      p_vendedor_usuario_id: params.vendedorUsuarioId,
      p_notas: params.notas,
      p_canal: params.canal,
      p_lineas: params.lineas.map((l) => ({
        producto_id: l.productoId,
        descripcion: l.descripcion,
        cantidad: l.cantidad,
        precio_unitario: l.precioUnitario,
        descuento_pct: l.descuentoPct,
        bodega_id: l.bodegaId,
      })),
      p_pagos: params.pagos.map((p) => ({
        metodo_pago: p.metodoPago,
        monto: p.monto,
        monto_recibido: p.montoRecibido,
        cambio: p.cambio,
      })),
      p_puntos_a_canjear: params.puntosACanjear ?? 0,
    });
    if (error) throw new Error(error.message);

    const venta = await firstValueFrom(this.data.getById<Venta>('Venta', ventaId as number));
    if (!venta) throw new Error('La venta se registró pero no se pudo recuperar.');
    return venta;
  }

  /**
   * Único camino para convertir un Pedido web/Menú QR en una Venta --
   * ventas.fn_pedido_tienda_cargar_a_venta (Fase 5, 2026-11): candado
   * `SELECT...FOR UPDATE` + ventas.fn_venta_registrar() + actualización del
   * pedido (estado='Confirmado', venta_id), TODO en una sola transacción
   * atómica -- si cualquier paso falla (incluyendo la actualización del
   * pedido DESPUÉS de ya haber registrado la venta), Postgres revierte
   * también lo que fn_venta_registrar ya había hecho (venta + pagos +
   * descuento de inventario). Ver
   * claude/fase5-propuesta-atomicidad-pedido-venta-2026-11.md y
   * claude/fase5-verificacion-final-parteB-2026-11.md para el diseño y las
   * pruebas. fn_venta_registrar() en sí NUNCA se modificó -- esta función
   * es un wrapper nuevo alrededor, no un reemplazo.
   *
   * Reemplaza el patrón anterior de 2 pasos sueltos (registrar() +
   * PedidoTiendaService.marcarConfirmadoDesdeVenta() por separado, sin
   * protección transaccional conjunta) para el único camino que queda en
   * Pedidos web ("Cargar a venta" → Cobro, ver CobroComponent.confirmarCobro()).
   *
   * Idempotente a propósito: si el pedido ya estaba 'Confirmado' cuando
   * llega esta solicitud (otro cajero ya lo cobró primero, o esta misma
   * solicitud se reintentó por un timeout de red), la función de Postgres
   * NO crea una segunda venta -- devuelve la que ya existe, marcando
   * `creadaEnEstaSolicitud: false` para que el llamador pueda distinguir
   * "esta llamada acaba de cobrar" de "alguien ya lo había cobrado antes"
   * SIN depender de la fecha de la venta (instrucción explícita del
   * mandato: la fecha nunca es un identificador confiable de reintento).
   */
  async registrarDesdePedidoTienda(
    pedidoTiendaId: number,
    params: {
      turnoCajaId: number;
      clienteId: number;
      vendedorUsuarioId: number;
      notas: string | null;
      canal: string | null;
      lineas: LineaVentaEntrada[];
      pagos: PagoEntrada[];
      puntosACanjear?: number;
    },
  ): Promise<{ venta: Venta; creadaEnEstaSolicitud: boolean }> {
    const { data, error } = await this.sb.schema('ventas').rpc('fn_pedido_tienda_cargar_a_venta', {
      p_pedido_id: pedidoTiendaId,
      p_turno_caja_id: params.turnoCajaId,
      p_cliente_id: params.clienteId,
      p_vendedor_usuario_id: params.vendedorUsuarioId,
      p_notas: params.notas,
      p_canal: params.canal,
      p_lineas: params.lineas.map((l) => ({
        producto_id: l.productoId,
        descripcion: l.descripcion,
        cantidad: l.cantidad,
        precio_unitario: l.precioUnitario,
        descuento_pct: l.descuentoPct,
        bodega_id: l.bodegaId,
      })),
      p_pagos: params.pagos.map((p) => ({
        metodo_pago: p.metodoPago,
        monto: p.monto,
        monto_recibido: p.montoRecibido,
        cambio: p.cambio,
      })),
      p_puntos_a_canjear: params.puntosACanjear ?? 0,
    });
    if (error) throw new Error(error.message);

    const resultado = data as { ventaId: number; creadaEnEstaSolicitud: boolean };
    const venta = await firstValueFrom(this.data.getById<Venta>('Venta', resultado.ventaId));
    if (!venta) throw new Error('La venta se registró pero no se pudo recuperar.');
    return { venta, creadaEnEstaSolicitud: resultado.creadaEnEstaSolicitud };
  }

  /** Cancela una venta ya cobrada: repone la existencia de cada renglón con
   *  producto real (Entrada, lo opuesto exacto de la Salida que hizo
   *  registrar()), revierte el programa de lealtad y marca la venta como
   *  Cancelada — todo en una sola operación transaccional
   *  (ventas.fn_venta_cancelar). Los pagos NO se tocan (quedan como
   *  quedaron, para que el historial siga mostrando cómo se cobró). Si la
   *  venta tenía algo a Crédito, esa CuentaPorCobrar se cancela también —
   *  PERO solo si todavía no tiene ningún abono: si el cliente ya pagó
   *  parte, cancelar la venta dejaría ese dinero ya cobrado sin ninguna
   *  cuenta que lo explique, así que se bloquea (igual que con una
   *  Devolución ya aplicada, ver HistorialVentasComponent.puedeCancelarDetalle).
   *
   *  NOTA de auditoría (ver reporte Bloque F): si la cuenta por cobrar NO
   *  tiene abonos, Postgres rechaza hoy el intento de marcarla 'Cancelada'
   *  porque el CHECK de ventas.cuenta_por_cobrar.estado solo permite
   *  'Pendiente'/'Pagada' — un defecto preexistente, no introducido por
   *  esta homologación, que se deja intacto a propósito (no se amplía el
   *  CHECK sin que el negocio decida el valor correcto) y que ahora, al
   *  ser atómico, ya no puede dejar el inventario revertido a medias. */
  async cancelar(venta: Venta): Promise<Venta> {
    if (venta.estado === 'Cancelada') return venta;

    const { error } = await this.sb.schema('ventas').rpc('fn_venta_cancelar', { p_venta_id: venta.id });
    if (error) throw new Error(error.message);

    const ventaActualizada = await firstValueFrom(this.data.getById<Venta>('Venta', venta.id));
    if (!ventaActualizada) throw new Error('La venta se canceló pero no se pudo recuperar.');
    return ventaActualizada;
  }
}

import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { EstadoPedidoTienda, FilaPedidoTienda, OrigenPedidoTienda, PedidoTienda } from './pedido-tienda.model';
import { LineaCargaVentaPedidoTienda } from '../carga-venta-pedido-tienda.service';

/** Filtros server-side de la bandeja — ver ventas.fn_pedidos_tienda_listar()
 *  y la sección 29 del plan (nunca se filtra en el navegador sobre una
 *  tabla completa ya descargada). */
export interface FiltrosPedidosTienda {
  desdeFecha: string | null;
  hastaFecha: string | null;
  estado: EstadoPedidoTienda | null;
  origen: OrigenPedidoTienda | null;
  busqueda: string | null;
}

/**
 * Reclamar/revalidar/descartar pedidos web — registrar la venta en sí ya
 * no ocurre aquí (ver Fase 5, 2026-11): el único camino a venta es
 * "Cargar a venta" hacia Cobro (CobroComponent.confirmarCobro(), que desde
 * Fase 5 Parte B usa VentaService.registrarDesdePedidoTienda() →
 * ventas.fn_pedido_tienda_cargar_a_venta(), candado + venta + actualización
 * del pedido en una sola transacción atómica). marcarConfirmadoDesdeVenta()
 * abajo ya NO tiene ningún llamador real — queda documentado como código
 * muerto, sin retirar por no haber sido pedido explícitamente.
 */
@Injectable({ providedIn: 'root' })
export class PedidoTiendaService {
  private readonly data = inject(DataClientService);
  private readonly sb = inject(SupabaseService).cliente;

  /** Bandeja paginada/filtrada del lado del servidor (ver
   *  ventas.fn_pedidos_tienda_listar()) — misma arquitectura que
   *  fn_kardex_listar: una función SQL normal (no security definer) sobre
   *  ventas.pedido_tienda, protegida por las políticas RLS ya existentes
   *  de esa tabla (empresa_id = empresa_actual_id()), nunca por filtrar en
   *  el navegador. `desde` es el offset (0-based), `cantidad` el tamaño de
   *  página. */
  async listar(
    filtros: FiltrosPedidosTienda,
    desde: number,
    cantidad: number,
  ): Promise<{ filas: FilaPedidoTienda[]; total: number }> {
    const { data, error } = await this.sb.schema('ventas').rpc('fn_pedidos_tienda_listar', {
      p_desde_fecha: filtros.desdeFecha,
      p_hasta_fecha: filtros.hastaFecha,
      p_estado: filtros.estado,
      p_origen: filtros.origen,
      p_busqueda: filtros.busqueda?.trim() || null,
      p_desde: desde,
      p_cantidad: cantidad,
    });
    if (error) throw new Error(error.message);
    const filas = (data ?? []) as Record<string, unknown>[];
    return {
      filas: filas.map((f) => ({
        id: f['id'] as number,
        fechaCreacion: f['fecha_creacion'] as string,
        folio: f['folio'] as string | null,
        origen: f['origen'] as OrigenPedidoTienda,
        cliente: f['cliente'] as string,
        telefonoCliente: f['telefono_cliente'] as string | null,
        total: Number(f['total']),
        estado: f['estado'] as EstadoPedidoTienda,
        ventaId: f['venta_id'] as number | null,
      })),
      total: Number(filas[0]?.['total_filas'] ?? 0),
    };
  }

  /** Resuelve una orden por su token público (ver
   *  ventas.fn_asignar_folio_pedido_tienda()) — usado por el lector de
   *  Cobro al escanear un "QR de orden Saurix" (Bloque F). Una consulta
   *  normal a la tabla (no RPC): ya protegida por las políticas RLS de
   *  pedido_tienda (empresa_id = empresa_actual_id()), así que un token de
   *  OTRA empresa simplemente no encuentra nada aquí — nunca expone ni
   *  carga el pedido de otra empresa (sección 23 del plan), sin tener que
   *  repetir ese filtro a mano. null = token inexistente, de otra
   *  empresa, o de una fila ya borrada (activo=false). */
  async resolverPorToken(token: string): Promise<{
    id: number;
    folio: string | null;
    origen: OrigenPedidoTienda;
    nombreCliente: string | null;
    nombreMostrarEn: string | null;
    estado: EstadoPedidoTienda;
  } | null> {
    const { data, error } = await this.sb
      .schema('ventas')
      .from('pedido_tienda')
      .select('id, folio, origen, nombre_cliente, nombre_mostrar_en, estado')
      .eq('token_publico', token)
      .eq('activo', true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return {
      id: data['id'] as number,
      folio: data['folio'] as string | null,
      origen: data['origen'] as OrigenPedidoTienda,
      nombreCliente: data['nombre_cliente'] as string | null,
      nombreMostrarEn: data['nombre_mostrar_en'] as string | null,
      estado: data['estado'] as EstadoPedidoTienda,
    };
  }

  /** "Cargar a venta" (Bloque E — ver ventas.fn_revalidar_items_pedido_tienda
   *  y la sección 30 del plan): recalcula precio/disponibilidad del lado
   *  del servidor para cada renglón del pedido, SIN tocar nada todavía —
   *  el cajero sigue pudiendo editar todo en Cobro antes de cobrar. Misma
   *  arquitectura que listar(): una función SQL normal, protegida por las
   *  políticas RLS ya existentes (nunca security definer). */
  async revalidarItems(pedidoId: number): Promise<LineaCargaVentaPedidoTienda[]> {
    const { data, error } = await this.sb.schema('ventas').rpc('fn_revalidar_items_pedido_tienda', {
      p_pedido_id: pedidoId,
    });
    if (error) throw new Error(error.message);
    const filas = (data ?? []) as Record<string, unknown>[];
    return filas.map((f) => ({
      productoId: f['producto_id'] as number | null,
      descripcion: f['descripcion'] as string,
      cantidad: Number(f['cantidad']),
      precioUnitario: Number(f['precio_unitario']),
      disponible: f['disponible'] as boolean,
      motivo: f['motivo'] as string | null,
    }));
  }

  /** Reclamo atómico (Bloque G — adjudicación de concurrencia, sección 21
   *  del plan): SIEMPRE antes de cargar un pedido/orden a Cobro (botón
   *  "Cargar a venta" o lector de QR) o de abrir "Confirmar venta" — nunca
   *  se decide en Angular si un pedido "ya lo tiene otro cajero", eso lo
   *  resuelve ventas.fn_reclamar_pedido_tienda() con un solo UPDATE
   *  condicionado (atómico por diseño de Postgres: solo UNA transacción
   *  concurrente puede ganar la condición WHERE estado='Pendiente').
   *  false = el pedido ya no está disponible: alguien más lo tiene
   *  reclamado hace menos de 5 minutos, o ya cambió de estado
   *  (Confirmado/Descartado/Expirado). Reclamar de nuevo el mismo pedido
   *  (p.ej. recargar Cobro) es idempotente para el mismo cajero. */
  async reclamar(pedidoId: number): Promise<boolean> {
    const { data, error } = await this.sb.schema('ventas').rpc('fn_reclamar_pedido_tienda', {
      p_pedido_id: pedidoId,
    });
    if (error) throw new Error(error.message);
    return Boolean((data as { ok?: boolean } | null)?.ok);
  }

  /** Suelta un reclamo propio antes de los 5 minutos (p.ej. el cajero vació
   *  el carrito o canceló "Confirmar venta") — solo una optimización de
   *  prontitud: si no se llama, fn_reclamar_pedido_tienda() lo vuelve a
   *  tomar igual en cuanto pasan los 5 minutos. Nunca libera el reclamo de
   *  OTRO cajero (lo valida el propio SQL). Best-effort: los llamadores la
   *  disparan sin esperar ni bloquear por su resultado. */
  async liberar(pedidoId: number): Promise<void> {
    const { error } = await this.sb.schema('ventas').rpc('fn_liberar_pedido_tienda', { p_pedido_id: pedidoId });
    if (error) throw new Error(error.message);
  }

  /** Vincula el pedido/orden de origen con la Venta que resultó de
   *  "Cargar a venta" — llamado por CobroComponent.confirmarCobro() SOLO
   *  hasta que la venta ya quedó registrada (nunca antes: "cargar a
   *  venta" ≠ "venta cobrada", sección 19 del plan). Si esto falla, la
   *  venta ya registrada NO se deshace — el pedido simplemente se queda
   *  "Pendiente" en la bandeja y el staff lo puede resolver a mano.
   *
   *  Fase 5 (2026-11): este método quedó SIN llamadores reales al activarse
   *  ventas.fn_pedido_tienda_cargar_a_venta() (ver
   *  claude/fase5-propuesta-atomicidad-pedido-venta-2026-11.md del
   *  proyecto) — la grieta de protección contra ventas duplicadas que
   *  tenía este patrón de 2 pasos (un pedido cuyo paso 2 fallaba aquí se
   *  quedaba reclamable de nuevo, sin registro de que ya existía una
   *  venta) ya no existe en el único camino que queda ("Cargar a venta").
   *  Se deja el método intacto (código muerto) en vez de borrarlo, por no
   *  haberse pedido explícitamente su retiro. */
  async marcarConfirmadoDesdeVenta(pedidoId: number, ventaId: number): Promise<void> {
    await firstValueFrom(
      this.data.modificacion<PedidoTienda>('PedidoTienda', { id: pedidoId, estado: 'Confirmado', ventaId }),
    );
  }

  async descartar(pedido: PedidoTienda): Promise<PedidoTienda> {
    if (pedido.estado !== 'Pendiente') return pedido;
    return firstValueFrom(this.data.modificacion<PedidoTienda>('PedidoTienda', { ...pedido, estado: 'Descartado' }));
  }
}

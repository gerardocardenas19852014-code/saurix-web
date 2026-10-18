import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../core/services/supabase.service';
import { LineaCarritoTienda, TiendaActiva, TiendaDetalle } from './tienda.model';

/**
 * Acceso a las 2 únicas funciones RPC públicas del sistema (ver
 * supabase/migrations/27_tienda_publica.sql) — llamadas directo con el
 * cliente de Supabase, sin pasar por DataClientService, porque NO son
 * tablas: son funciones security definer que ya filtran por empresa_id
 * adentro. No requieren sesión (se llaman con el rol `anon`) — por eso
 * esta pantalla funciona sin login, a diferencia de todo lo demás en
 * Saurix.
 */
@Injectable({ providedIn: 'root' })
export class TiendaPublicaService {
  private readonly sb = inject(SupabaseService).cliente;

  async tiendasActivas(): Promise<TiendaActiva[]> {
    const { data, error } = await this.sb.schema('seguridad').rpc('tiendas_activas');
    if (error) throw new Error(error.message);
    return (data ?? []) as TiendaActiva[];
  }

  /** null = la clave no existe, está inactiva o no tiene catálogo público activado. */
  async tiendaDetalle(clave: string): Promise<TiendaDetalle | null> {
    const { data, error } = await this.sb.schema('seguridad').rpc('tienda_detalle', { p_clave: clave });
    if (error) throw new Error(error.message);
    return (data as TiendaDetalle | null) ?? null;
  }

  /** Guarda un registro LIGERO del pedido (ver migración 30_pedidos_tienda.sql)
   *  para que también aparezca en Ventas → Pedidos web — el canal real
   *  sigue siendo el WhatsApp que arma enviarPorWhatsapp() en
   *  catalogo-tienda.component.ts, esto es solo para no tener que volver a
   *  teclearlo. Se llama "en segundo plano" (sin esperar/bloquear el envío
   *  del WhatsApp) — si falla, el cliente de todas formas ya recibió su
   *  WhatsApp, que es lo que de verdad importa. */
  async crearPedidoPendiente(
    clave: string,
    datos: {
      nombre: string;
      telefono: string;
      notas: string;
      lat: number | null;
      lng: number | null;
      items: LineaCarritoTienda[];
      total: number;
    },
  ): Promise<void> {
    const { error } = await this.sb.schema('seguridad').rpc('crear_pedido_tienda', {
      p_clave: clave,
      p_nombre: datos.nombre,
      p_telefono: datos.telefono,
      p_notas: datos.notas || null,
      p_lat: datos.lat,
      p_lng: datos.lng,
      p_items: datos.items,
      p_total: datos.total,
    });
    if (error) throw new Error(error.message);
  }
}

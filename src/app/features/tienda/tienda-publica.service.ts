import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../core/services/supabase.service';
import { TiendaActiva, TiendaDetalle } from './tienda.model';

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
}

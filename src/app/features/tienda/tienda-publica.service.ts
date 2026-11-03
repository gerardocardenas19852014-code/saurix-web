import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../core/services/supabase.service';
import {
  CategoriaTienda,
  ConfiguracionTienda,
  CursorCatalogoTienda,
  LineaCarritoTienda,
  PaginaCatalogoTienda,
  ProductoTienda,
  TiendaActiva,
} from './tienda.model';

/** Orden del catálogo paginado — ver fn_catalogo_tienda_pagina() y
 *  agruparPorPrecio()/cambiarAgrupacion() en catalogo-tienda.component.ts. */
export type OrdenCatalogoTienda = 'categoria' | 'precio';

/**
 * Acceso a las funciones RPC públicas del sistema (ver
 * supabase/migrations/27_tienda_publica.sql y la homologación de
 * rendimiento de 2026-10 en claude/tienda-publica-homologacion-2026-10.md)
 * — llamadas directo con el cliente de Supabase, sin pasar por
 * DataClientService, porque NO son tablas: son funciones security definer
 * que ya filtran por empresa_id adentro. No requieren sesión (se llaman
 * con el rol `anon`) — por eso esta pantalla funciona sin login, a
 * diferencia de todo lo demás en Saurix.
 *
 * Desde la homologación de 2026-10, abrir una tienda ya NO descarga el
 * catálogo completo en una sola llamada: tiendaConfig() trae solo la
 * configuración (pequeña), tiendaCategorias()/tiendaDestacados() son
 * consultas chicas aparte, y catalogoPagina() trae el catálogo real,
 * paginado con cursor/keyset — ver catalogo-tienda.component.ts.
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
  async tiendaConfig(clave: string): Promise<ConfiguracionTienda | null> {
    const { data, error } = await this.sb.schema('seguridad').rpc('tienda_detalle', { p_clave: clave });
    if (error) throw new Error(error.message);
    return (data as ConfiguracionTienda | null) ?? null;
  }

  /** Chips de categoría — ver fn_tienda_categorias(). Independiente del
   *  catálogo paginado: nunca se derivan descargando todos los productos. */
  async tiendaCategorias(clave: string): Promise<CategoriaTienda[]> {
    const { data, error } = await this.sb.schema('seguridad').rpc('fn_tienda_categorias', { p_clave: clave });
    if (error) throw new Error(error.message);
    return (data ?? []) as CategoriaTienda[];
  }

  /** Carrusel "⭐ Destacados" — ver fn_tienda_destacados(). Acotado (máx. 20)
   *  del lado del servidor, independiente de cuántas páginas del catálogo
   *  normal se hayan cargado. */
  async tiendaDestacados(clave: string): Promise<ProductoTienda[]> {
    const { data, error } = await this.sb.schema('seguridad').rpc('fn_tienda_destacados', { p_clave: clave });
    if (error) throw new Error(error.message);
    return (data ?? []) as ProductoTienda[];
  }

  /** Una página del catálogo — ver fn_catalogo_tienda_pagina(). `cursor`
   *  null = primera página. */
  async catalogoPagina(
    clave: string,
    opciones: {
      busqueda?: string | null;
      categoriaId?: number | null;
      orden?: OrdenCatalogoTienda;
      cursor?: CursorCatalogoTienda | null;
      cantidad?: number;
    },
  ): Promise<PaginaCatalogoTienda> {
    const { data, error } = await this.sb.schema('seguridad').rpc('fn_catalogo_tienda_pagina', {
      p_clave: clave,
      p_busqueda: opciones.busqueda || null,
      p_categoria_id: opciones.categoriaId ?? null,
      p_orden: opciones.orden ?? 'categoria',
      p_cursor_categoria_nombre: opciones.cursor?.categoriaNombre ?? null,
      p_cursor_nombre: opciones.cursor?.nombre ?? null,
      p_cursor_precio: opciones.cursor?.precio ?? null,
      p_cursor_id: opciones.cursor?.id ?? null,
      p_cantidad: opciones.cantidad ?? 24,
    });
    if (error) throw new Error(error.message);
    return (data ?? { productos: [], hayMas: false, cursor: null }) as PaginaCatalogoTienda;
  }

  /** Guarda un registro LIGERO del pedido (ver migración 30_pedidos_tienda.sql)
   *  para que también aparezca en Ventas → Pedidos web — el canal real
   *  sigue siendo el WhatsApp que arma enviarPorWhatsapp() en
   *  catalogo-tienda.component.ts, esto es solo para no tener que volver a
   *  teclearlo. Se llama "en segundo plano" (sin esperar/bloquear el envío
   *  del WhatsApp) — si falla, el cliente de todas formas ya recibió su
   *  WhatsApp, que es lo que de verdad importa.
   *
   *  Homologación nov-2026 (Bloque F): igual que crearOrdenMenuQr(), solo
   *  se manda producto/cantidad/opciones elegidas — NUNCA el precio ni el
   *  total que calculó Angular. El servidor (seguridad.crear_pedido_tienda,
   *  vía el helper compartido fn_revalidar_items_pedido) reconstruye precio
   *  y total desde inventario.producto antes de guardarlos; p_total se
   *  conserva en la llamada solo por compatibilidad de forma, su valor ya
   *  no se usa del lado del servidor. */
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
      p_items: datos.items.map((linea) => ({
        productoId: linea.productoId,
        cantidad: linea.cantidad,
        opcionValorIds: linea.opcionesElegidas.map((o) => o.valorId),
      })),
      p_total: datos.total,
    });
    if (error) throw new Error(error.message);
  }

  /** "Mostrar en caja" del modo Menú + Mi orden (ver seguridad.crear_orden_menu_qr
   *  y la sección 30 del plan): crea la orden en el servidor — el precio/total
   *  se reconstruye SIEMPRE del lado del servidor a partir de inventario.producto,
   *  nunca se confía en lo que traiga el carrito local. No es un pedido en línea
   *  ni una venta: no toca inventario, no genera MovimientoInventario ni cuenta
   *  por cobrar (ver ventas.pedido_tienda, origen='menu_qr'). Devuelve
   *  { ok:false, error } con el código tal cual lo manda el RPC (p.ej.
   *  'modo_no_disponible', 'producto_no_disponible', 'opcion_invalida') para que
   *  el componente decida el mensaje — nunca se interpreta aquí. */
  async crearOrdenMenuQr(
    clave: string,
    nombreMostrarEn: string | null,
    items: LineaCarritoTienda[],
  ): Promise<
    | { ok: true; id: number; folio: string; token: string; articulos: number; total: number }
    | { ok: false; error: string }
  > {
    const { data, error } = await this.sb.schema('seguridad').rpc('crear_orden_menu_qr', {
      p_clave: clave,
      p_nombre_cliente: nombreMostrarEn,
      p_items: items.map((linea) => ({
        productoId: linea.productoId,
        cantidad: linea.cantidad,
        opcionValorIds: linea.opcionesElegidas.map((o) => o.valorId),
      })),
    });
    if (error) throw new Error(error.message);
    const resultado = data as Record<string, unknown> | null;
    if (!resultado || typeof resultado['error'] === 'string') {
      return { ok: false, error: (resultado?.['error'] as string) ?? 'desconocido' };
    }
    return {
      ok: true,
      id: resultado['id'] as number,
      folio: resultado['folio'] as string,
      token: resultado['token'] as string,
      articulos: resultado['articulos'] as number,
      total: resultado['total'] as number,
    };
  }
}

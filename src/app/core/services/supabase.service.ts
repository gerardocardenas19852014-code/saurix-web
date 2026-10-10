import { Injectable } from '@angular/core';
import { SupabaseClient, createClient } from '@supabase/supabase-js';
import { conexionActual } from './conexion';

/**
 * Cliente único de Supabase para toda la app (base de datos, Auth y
 * Storage), apuntando a la conexión activa (ver conexion.ts). La llave es
 * la "publishable": es pública por diseño; lo que protege los datos son las
 * reglas RLS definidas en supabase/migrations. La sesión de Auth la guarda
 * el propio cliente en localStorage (una por conexión) y la renueva sola.
 */
@Injectable({ providedIn: 'root' })
export class SupabaseService {
  readonly conexion = conexionActual();

  readonly cliente: SupabaseClient = createClient(this.conexion.supabaseUrl, this.conexion.supabaseKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true, // enlace de "¿Olvidaste tu contraseña?"
      storageKey: `saurix.supabase.auth.${this.conexion.clave}`,
    },
  });

  private empresaEnCache: { usuario: string; prefijo: Promise<string> } | null = null;

  /**
   * Carpeta de Storage de la empresa del usuario en sesión ('empresa_<id>').
   * Las reglas de Storage solo dejan leer y escribir dentro de esa carpeta.
   */
  async prefijoEmpresa(): Promise<string> {
    const { data } = await this.cliente.auth.getSession();
    const usuario = data.session?.user.id ?? '';
    const enCache = this.empresaEnCache;
    if (enCache && enCache.usuario === usuario) return enCache.prefijo;

    const prefijo = this.consultarPrefijo();
    this.empresaEnCache = { usuario, prefijo };
    prefijo.catch(() => (this.empresaEnCache = null));
    return prefijo;
  }

  private async consultarPrefijo(): Promise<string> {
    const { data, error } = await this.cliente.schema('seguridad').rpc('mi_empresa');
    const empresa = (data as { id: number }[] | null)?.[0];
    if (error || !empresa) throw new Error('No se pudo identificar tu empresa.');
    return `empresa_${empresa.id}`;
  }
}

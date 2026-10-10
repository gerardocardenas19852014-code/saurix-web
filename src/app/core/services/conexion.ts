import { environment } from '../../../environments/environment';

/**
 * Conexión de Supabase activa (opción "un proyecto por cliente").
 *
 * Hoy todos los clientes viven en un mismo proyecto, separados por empresa
 * (columna empresa_id + RLS), así que `environment.conexiones` trae una sola
 * entrada. Cuando un cliente necesite su propia base, se crea su proyecto de
 * Supabase, se le aplican los scripts de supabase/migrations y se agrega aquí
 * otra entrada; nada más cambia en la app.
 *
 * Cuál se usa, en este orden:
 *  1. ?conexion=<clave> en la URL (se recuerda en este navegador);
 *  2. subdominio igual a la clave (acme.saurix.com → 'acme');
 *  3. la última elegida en el login (localStorage);
 *  4. la primera de la lista.
 */
export interface ConexionSupabase {
  clave: string;
  nombre: string;
  supabaseUrl: string;
  supabaseKey: string;
}

const CLAVE = 'saurix.conexion';

export const CONEXIONES: ConexionSupabase[] = environment.conexiones;

export function conexionActual(): ConexionSupabase {
  const buscar = (clave: string | null | undefined) =>
    clave ? CONEXIONES.find((c) => c.clave.toLowerCase() === clave.toLowerCase()) : undefined;

  try {
    const deUrl = buscar(new URLSearchParams(window.location.search).get('conexion'));
    if (deUrl) {
      guardarConexion(deUrl.clave);
      return deUrl;
    }
  } catch {
    /* sin window (pruebas); se ignora */
  }

  try {
    const deSubdominio = buscar(window.location.hostname.split('.')[0]);
    if (deSubdominio) return deSubdominio;
  } catch {
    /* se ignora */
  }

  try {
    const guardada = buscar(localStorage.getItem(CLAVE));
    if (guardada) return guardada;
  } catch {
    /* localStorage no disponible */
  }

  return CONEXIONES[0];
}

export function guardarConexion(clave: string): void {
  try {
    localStorage.setItem(CLAVE, clave);
  } catch {
    /* localStorage no disponible; se ignora */
  }
}

import { Usuario } from '../../features/seguridad/usuarios/usuario.model';

/** Hoy en formato 'YYYY-MM-DD', igual al de las fechas de vigencia guardadas
 *  (comparación lexicográfica directa, sin parsear fechas). */
export function hoyIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * true si el usuario está marcado "Activo" pero su fecha final de vigencia
 * ya pasó — el caso que hay que sincronizar (desactivar) para que la columna
 * Activo no quede desfasada de la realidad. El login ya bloquea por vigencia
 * vencida de forma independiente (ver AuthService); esto es solo para que el
 * dato guardado/mostrado sea honesto.
 */
export function debeDesactivarsePorVigenciaVencida(usuario: Usuario, hoy = hoyIso()): boolean {
  return usuario.activo && usuario.fechaFinVigencia < hoy;
}

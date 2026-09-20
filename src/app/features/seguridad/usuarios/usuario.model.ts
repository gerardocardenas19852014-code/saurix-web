export interface Usuario {
  id: number;
  nombreUsuario: string;
  nombre: string;
  /** Opcionales: el resto de campos del usuario son obligatorios. */
  apellidoPaterno?: string;
  apellidoMaterno?: string;
  email: string;
  /** Solo se envía al backend (Alta/Modificacion); nunca viene en las respuestas de lectura. */
  password?: string;
  role: string;
  /** Vigencia de la cuenta (fechas en formato 'YYYY-MM-DD'). */
  fechaInicioVigencia: string;
  fechaFinVigencia: string;
  ultimoAcceso?: string | null;
  activo: boolean;
  fechaCreacion?: string;
  fechaModificacion?: string;
  /** Intentos de login fallidos consecutivos; se reinicia a 0 en cuanto entra bien. */
  intentosFallidos?: number;
  /** ISO datetime hasta el cual la cuenta queda bloqueada por demasiados intentos
   *  fallidos (ver AuthService). null/ausente = sin bloqueo activo. */
  bloqueadoHasta?: string | null;
  /** true = debe cambiar su contraseña en el próximo inicio de sesión (lo pone el
   *  botón de "Resetear contraseña" del admin; se apaga solo al cambiarla en Mi Perfil). */
  debeCambiarPassword?: boolean;
}

export interface UsuarioFiltro {
  nombreUsuario?: string;
}

/** Arma "Nombre Paterno Materno" a partir de las 3 partes (los apellidos son opcionales). */
export function nombreCompletoUsuario(
  usuario: Pick<Usuario, 'nombre' | 'apellidoPaterno' | 'apellidoMaterno'>,
): string {
  return [usuario.nombre, usuario.apellidoPaterno, usuario.apellidoMaterno].filter(Boolean).join(' ');
}

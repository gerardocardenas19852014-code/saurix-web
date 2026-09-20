export interface ConfiguracionConexion {
  id: number;
  nombre: string;
  proveedor: string;
  servidor: string;
  puerto: number;
  baseDatos: string;
  usuarioConexion: string;
  /** Solo se envía al crear/editar; el backend nunca la regresa en las lecturas. */
  passwordConexion?: string;
  activo: boolean;
}

export interface NivelJerarquicoItem {
  id: number;
  nombre: string;
  activo: boolean;
  [campo: string]: unknown;
}

/**
 * Configuración de un nivel dentro de una jerarquía de catálogos
 * padre-hijo (p.ej. País→Estado→Municipio→Localidad→Colonia→Calle, o
 * TipoSistema→Categoria→Seccion). El backend exige el FK del padre en
 * GetList para estas entidades (no admite listar todo sin padre), así
 * que la navegación siempre es en cascada: se entra al nivel raíz y de
 * ahí se va drilling hacia abajo.
 */
export interface NivelJerarquicoConfig {
  entidad: string;
  tituloSingular: string;
  tituloPlural: string;
  /** Campo FK hacia el padre (p.ej. 'paisId'); ausente en el primer nivel. */
  campoPadre?: string;
  /** Entidad del padre, para mostrar su nombre como referencia. */
  entidadPadre?: string;
  /** Base de ruta absoluta del siguiente nivel (p.ej. '/catalogos/geografico/estados'). */
  siguienteRutaBase?: string;
  /** Último segmento del siguiente nivel (p.ej. 'municipios'). */
  siguienteSegmento?: string;
  siguienteEtiquetaBoton?: string;
}

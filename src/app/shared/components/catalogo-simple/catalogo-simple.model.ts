export interface CatalogoSimpleItem {
  id: number;
  nombre: string;
  activo: boolean;
}

/** Configuración de un catálogo simple (solo id + nombre), registrada en la ruta vía `data`. */
export interface CatalogoSimpleConfig {
  /** Debe coincidir 1:1 con el nombre del Controller en PlataformaSaurix.Web (/api/{entidad}/...) */
  entidad: string;
  tituloPlural: string;
  tituloSingular: string;
}

export interface Documento {
  id: number;
  seccionId: number;
  titulo: string;
  /**
   * Contenido del documento, generado por el editor visual `app-editor-texto`
   * (HTML — títulos, negritas, listas, imágenes y archivos incrustados como
   * data URL, enlaces, etc.). Los documentos creados antes de este editor
   * quedaron guardados en Markdown; la vista detecta automáticamente cuál es
   * cuál (busca etiquetas HTML típicas) y usa `marked` solo para los antiguos,
   * así que ambos formatos se siguen viendo bien sin necesidad de migrarlos.
   */
  contenido: string;
  activo: boolean;
  /** Estampadas automáticamente por IndexedDbDataClientService en Alta/Modificación. */
  fechaCreacion?: string;
  fechaModificacion?: string;
}

/**
 * Opciones para los combos en cascada de alta/edición de Documento —
 * reflejan la jerarquía real de Catálogos: TipoSistema (1) → Categoria (N,
 * FK a TipoSistema) → Seccion (N, FK a Categoria) → Documento (FK a
 * Seccion). Cada nivel exige el Id de su padre para listarse.
 */
export interface TipoSistemaOpcion {
  id: number;
  nombre: string;
}

export interface CategoriaOpcion {
  id: number;
  nombre: string;
  tipoSistemaId: number;
}

export interface SeccionOpcion {
  id: number;
  nombre: string;
  categoriaId: number;
}

/** Documento marcado como favorito por un usuario — un registro por
 *  usuario+documento (no un campo booleano en Documento, para que cada
 *  usuario tenga sus propios favoritos sin pisar los de los demás). */
export interface DocumentoFavorito {
  id: number;
  documentoId: number;
  usuario: string;
}

/** Snapshot del contenido de un Documento justo ANTES de sobrescribirlo —
 *  se crea uno nuevo cada vez que se guarda una edición (ver guardar() en
 *  documentos-list.component.ts), nunca se modifica ni se borra, así que
 *  sirve como historial de cambios simple (quién y cuándo) con opción de
 *  restaurar una versión anterior. */
export interface DocumentoVersion {
  id: number;
  documentoId: number;
  titulo: string;
  contenido: string;
  usuario: string;
  /** Estampada automáticamente por IndexedDbDataClientService en el alta. */
  fechaCreacion?: string;
}

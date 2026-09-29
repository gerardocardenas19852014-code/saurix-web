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

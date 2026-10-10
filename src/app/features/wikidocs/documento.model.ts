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

/**
 * Trazabilidad de WikiDocs: un Documento puede referenciar "cosas" reales
 * del sistema para poder rastrear, por ejemplo, en qué procesos se usa una
 * tabla — idea del usuario (2026-10-10, ver esquema-tablas-saurix.md en el
 * proyecto de Claude). Mismo patrón ya usado por TicketEtiqueta/
 * TicketDependencia/TicketSeguidor en Proyectos: una entidad hija por
 * Documento (no un array embebido), con alta/baja inmediata por registro.
 *
 * Tablas y Procesos son texto libre (no hay catálogo real de tablas SQL ni
 * de procesos de negocio dentro de esta app) — igual que TicketEtiqueta.
 * Módulos SÍ es una relación real: apunta a una pantalla existente del
 * catálogo de navegación (ver navegacion-destinos.util.ts). Documentos
 * relaciona dos Documento entre sí, con un tipo de relación.
 */
export interface DocumentoReferenciaTabla {
  id: number;
  documentoId: number;
  texto: string;
}

export interface DocumentoReferenciaProceso {
  id: number;
  documentoId: number;
  texto: string;
}

/** `etiqueta`/`grupo` se guardan junto con `ruta` (en vez de resolverse en
 *  cada render contra DESTINOS) para que la referencia siga mostrando el
 *  nombre correcto aunque el catálogo de navegación cambie después. */
export interface DocumentoReferenciaModulo {
  id: number;
  documentoId: number;
  ruta: string;
  etiqueta: string;
  grupo: string;
}

export type TipoRelacionDocumento = 'relacionado' | 'depende_de' | 'reemplaza_a';

/** Relación dirigida: documentoId es el documento donde se capturó la
 *  relación, documentoRelacionadoId el que referencia. */
export interface DocumentoRelacion {
  id: number;
  documentoId: number;
  documentoRelacionadoId: number;
  tipo: TipoRelacionDocumento;
}

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
  /** Estampadas automáticamente por SupabaseDataClientService en Alta/Modificación. */
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
  /** Estampada automáticamente por SupabaseDataClientService en el alta. */
  fechaCreacion?: string;
}

/**
 * Trazabilidad de WikiDocs: un Documento puede referenciar "cosas" reales
 * de CUALQUIER sistema (propio o externo) para poder rastrear, por ejemplo,
 * en qué procesos se usa una tabla — idea del usuario (2026-10-10, ver
 * esquema-tablas-saurix.md en el proyecto de Claude), evolucionada en el
 * Mandato 89 (nov-2026, "WikiDocs: mejora integral de experiencia de
 * usuario, referencias universales y limpieza definitiva") de "solo
 * pantallas internas de Saurix" a "cualquier sistema, interno o externo".
 * Mismo patrón ya usado por TicketEtiqueta/TicketDependencia/TicketSeguidor
 * en Proyectos: una entidad hija por Documento (no un array embebido), con
 * alta/baja/edición inmediata por registro.
 *
 * Las 3 (Tabla/Proceso/Módulo) son texto libre en TODOS sus campos —
 * incluido `sistema` — con autocompletado opcional desde
 * `wikidocs.fn_referencias_sugerencias` (ver TextoSugeridoComponent), nunca
 * un catálogo administrativo obligatorio. `sistema` queda `null` en
 * referencias migradas cuyo sistema no se pudo determinar con certeza
 * (nunca se inventa). Documentos relaciona dos Documento entre sí, con un
 * tipo de relación — ese sí sigue siendo universal por naturaleza, no
 * depende de ningún sistema externo.
 */
export interface DocumentoReferenciaTabla {
  id: number;
  documentoId: number;
  /** Sistema dueño de la tabla (ej. "SIIF", "SAP", "Saurix") — texto libre,
   *  sugerido por defecto con el sistema del propio documento. `null` =
   *  sin especificar (dato migrado antes del Mandato 89, o el usuario lo
   *  dejó en blanco a propósito). */
  sistema: string | null;
  /** Esquema de la tabla, cuando aplica (ej. "dbo", "contabilidad"). Opcional. */
  esquema: string | null;
  tabla: string;
  descripcion: string | null;
}

export interface DocumentoReferenciaProceso {
  id: number;
  documentoId: number;
  sistema: string | null;
  proceso: string;
  descripcion: string | null;
}

/**
 * Hasta el Mandato 89, Módulo estaba atado al catálogo interno de
 * navegación de Saurix (`DESTINOS` en navegacion-destinos.util.ts) — ya no:
 * `sistema`/`modulo` son obligatorios (identifican de qué sistema y qué
 * módulo se habla, sin exigir que ese módulo exista en ningún catálogo),
 * `pantallaFuncionalidad`/`url`/`descripcion` son opcionales (permite
 * documentar un módulo completo sin bajar al nivel de una pantalla
 * puntual). `url`, cuando se captura, se valida en la UI antes de
 * convertirse en enlace navegable (solo http/https, nunca javascript: ni
 * otros esquemas ejecutables).
 */
export interface DocumentoReferenciaModulo {
  id: number;
  documentoId: number;
  sistema: string;
  modulo: string;
  pantallaFuncionalidad: string | null;
  url: string | null;
  descripcion: string | null;
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

export interface Documento {
  id: number;
  seccionId: number;
  titulo: string;
  /** Contenido en Markdown; se renderiza con `marked` en la vista y se busca en texto plano desde el asistente de IA del shell. */
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

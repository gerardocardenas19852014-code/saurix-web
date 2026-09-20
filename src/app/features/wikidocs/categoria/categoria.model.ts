/**
 * Coincide 1:1 con CategoriaDTO/CategoriaDisplayObject reales de
 * PlataformaSaurix: Categoria SOLO referencia a TipoSistema (no tiene
 * SeccionId propio — es Sección la que referencia a Categoria, no al revés).
 */
export interface Categoria {
  id: number;
  nombre: string;
  tipoSistemaId: number;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

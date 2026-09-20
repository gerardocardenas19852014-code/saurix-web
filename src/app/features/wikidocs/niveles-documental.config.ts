import { NivelJerarquicoConfig } from '../../shared/components/catalogo-jerarquico/nivel-jerarquico.model';

/**
 * Jerarquía documental usada por WikiDocs: TipoSistema (1) → Categoria (N)
 * → Seccion (N) → Documento (N). Igual que la jerarquía geográfica, el
 * backend exige el FK del padre en GetList para Categoria y Seccion, así
 * que se administra con el mismo componente de navegación en cascada.
 * El último nivel (Documento) no es un catálogo simple — tiene su propia
 * ventana (ver documentos-list.component.ts).
 */
export const NIVELES_DOCUMENTAL: NivelJerarquicoConfig[] = [
  {
    entidad: 'TipoSistema',
    tituloSingular: 'Tipo de sistema',
    tituloPlural: 'Tipos de sistema',
    siguienteRutaBase: '/catalogos/documental/tipo-sistema',
    siguienteSegmento: 'categorias',
    siguienteEtiquetaBoton: 'Ver categorías',
  },
  {
    entidad: 'Categoria',
    tituloSingular: 'Categoría',
    tituloPlural: 'Categorías',
    campoPadre: 'tipoSistemaId',
    entidadPadre: 'TipoSistema',
    siguienteRutaBase: '/catalogos/documental/categorias',
    siguienteSegmento: 'secciones',
    siguienteEtiquetaBoton: 'Ver secciones',
  },
  {
    entidad: 'Seccion',
    tituloSingular: 'Sección',
    tituloPlural: 'Secciones',
    campoPadre: 'categoriaId',
    entidadPadre: 'Categoria',
    siguienteRutaBase: '/wikidocs/secciones',
    siguienteSegmento: 'documentos',
    siguienteEtiquetaBoton: 'Ver documentos',
  },
];

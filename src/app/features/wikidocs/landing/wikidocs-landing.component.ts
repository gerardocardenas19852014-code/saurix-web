import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

type ColorIcono = 'siif' | 'personal' | 'generic';

interface EnlaceModulo {
  ruta: string;
  queryParams?: Record<string, string | number>;
  icono: string;
  color: ColorIcono;
  titulo: string;
  descripcion: string;
}

interface GrupoModulo {
  titulo: string;
  enlaces: EnlaceModulo[];
}

const GRUPOS: GrupoModulo[] = [
  {
    titulo: 'Proceso',
    enlaces: [
      {
        ruta: 'documentos',
        icono: '📚',
        color: 'siif',
        titulo: 'Documentos',
        descripcion: 'Todas las páginas de documentación, con adjuntos y descarga en HTML.',
      },
      {
        ruta: 'documentos',
        queryParams: { soloFavoritos: 1 },
        icono: '⭐',
        color: 'siif',
        titulo: 'Favoritos',
        descripcion: 'Tus documentos marcados como favoritos.',
      },
    ],
  },
  {
    titulo: 'Reporte',
    enlaces: [
      {
        ruta: 'dashboard',
        icono: '📊',
        color: 'siif',
        titulo: 'Dashboard',
        descripcion:
          'Indicadores de WikiDocs: documentos activos/inactivos/huérfanos, distribución por sistema y categoría, últimos documentos actualizados y favoritos recientes.',
      },
      {
        ruta: 'mapa-trazabilidad',
        icono: '🕸️',
        color: 'siif',
        titulo: 'Mapa de trazabilidad',
        descripcion: 'Explora visualmente las relaciones de un documento con tablas, procesos, módulos y otros documentos.',
      },
    ],
  },
  {
    titulo: 'Catálogos',
    enlaces: [
      {
        ruta: 'tipos-sistema',
        icono: '🗂️',
        color: 'generic',
        titulo: 'Tipo de sistema',
        descripcion: 'Espacios de trabajo raíz de la jerarquía documental (ej. Interno, Cliente).',
      },
      {
        ruta: 'categorias',
        icono: '📖',
        color: 'generic',
        titulo: 'Categoría',
        descripcion: 'Categorías de cada tipo de sistema, para organizar sus secciones.',
      },
      {
        ruta: 'secciones',
        icono: '📑',
        color: 'generic',
        titulo: 'Secciones',
        descripcion: 'Secciones de cada categoría — de aquí cuelgan los documentos.',
      },
    ],
  },
  {
    titulo: 'Configuración',
    enlaces: [
      {
        ruta: 'plantillas',
        icono: '🧩',
        color: 'generic',
        titulo: 'Plantillas',
        descripcion: 'Contenido de partida reutilizable al crear un documento nuevo.',
      },
    ],
  },
];

/**
 * Landing propia de WikiDocs — mismo patrón que ProyectosLandingComponent/
 * InventarioLandingComponent/VentasLandingComponent: Inicio es SOLO un
 * índice de pantallas (cuadrícula de accesos), sin ninguna carga de datos
 * propia.
 *
 * Corrección prioritaria "Separación definitiva de Inicio y Dashboard"
 * (nov-2026): se reagrupan los tiles para que coincidan EXACTAMENTE con los
 * grupos del menú lateral de WikiDocs (ver shell.component.html):
 *  - Proceso: Documentos, Favoritos (antes vivían sueltos en un grupo
 *    llamado "WikiDocs").
 *  - Reporte: Dashboard, Mapa de trazabilidad (antes Mapa de trazabilidad
 *    vivía en el grupo "WikiDocs" y Dashboard en un grupo "Reportes" sin
 *    Mapa de trazabilidad — se corrige el agrupado pedido explícitamente).
 *  - Catálogos: Tipo de sistema, Categoría, Secciones.
 *  - Configuración: Plantillas (antes vivía dentro de Catálogos).
 * Ningún `ruta`/`queryParams`/color/ícono/permiso cambió — solo el grupo al
 * que pertenece cada tile.
 */
@Component({
  selector: 'app-wikidocs-landing',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './wikidocs-landing.component.html',
  styleUrl: './wikidocs-landing.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WikidocsLandingComponent {
  protected readonly grupos = GRUPOS;
}

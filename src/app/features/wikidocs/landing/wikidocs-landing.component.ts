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
    titulo: 'WikiDocs',
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
    titulo: 'Reportes',
    enlaces: [
      {
        ruta: 'dashboard',
        icono: '📊',
        color: 'siif',
        titulo: 'Dashboard',
        descripcion:
          'Indicadores de WikiDocs: documentos activos/inactivos/huérfanos, distribución por sistema y categoría, últimos documentos actualizados y favoritos recientes.',
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
 * Rectificación a la Corrección 02 del Mandato 89 (nov-2026): la corrección
 * anterior había movido el bloque de menús (WikiDocs/Catálogos) a la parte
 * de arriba de esta misma pantalla, pero el Dashboard (indicadores,
 * distribución por sistema/categoría, últimos documentos, favoritos) seguía
 * viviendo aquí también — dos responsabilidades en un solo componente, que
 * no es como funcionan los demás módulos. Se corrige homologando con el
 * patrón real de Inventario/Ventas: Inicio y Dashboard son dos RUTAS y dos
 * COMPONENTES independientes (`wikidocs` → este componente; `wikidocs/
 * dashboard` → `WikidocsDashboardComponent`, ver dashboard/
 * wikidocs-dashboard.component.ts). Este componente volvió a ser un simple
 * índice de pantallas: ninguna llamada a Supabase, ningún signal de datos,
 * ningún `OnInit`/`OnDestroy` — exactamente como
 * `InventarioLandingComponent`/`VentasLandingComponent`. Se agregó el grupo
 * "Reportes" con el tile "Dashboard" (mismo criterio que Inventario/Ventas:
 * "Reportes" es su propio grupo, con Dashboard como su pantalla), para que
 * el Dashboard siga siendo accesible desde Inicio.
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

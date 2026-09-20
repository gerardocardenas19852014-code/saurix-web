import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

type ColorIcono = 'siif' | 'personal' | 'generic';

interface EnlaceModulo {
  ruta: string;
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
];

/**
 * Landing propia de WikiDocs — mismo patrón que ProyectosLandingComponent:
 * los catálogos de este módulo (Tipo de sistema, Categoría, Secciones) ya
 * no viven en la landing genérica de Catálogos, viven aquí.
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

import { Routes } from '@angular/router';

export const WIKIDOCS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./landing/wikidocs-landing.component').then((m) => m.WikidocsLandingComponent),
  },
  {
    path: 'documentos',
    loadComponent: () => import('./documentos-list.component').then((m) => m.DocumentosListComponent),
  },
  {
    path: 'secciones/:seccionId/documentos',
    loadComponent: () => import('./documentos-list.component').then((m) => m.DocumentosListComponent),
  },

  // Catálogos propios de WikiDocs (jerarquía real TipoSistema→Categoria→Sección,
  // con FK padre obligatorio: cada nivel exige elegir su padre para listar).
  {
    path: 'tipos-sistema',
    loadComponent: () =>
      import('./tipo-sistema/tipo-sistema-list.component').then((m) => m.TipoSistemaListComponent),
  },
  {
    path: 'categorias',
    loadComponent: () => import('./categoria/categoria-list.component').then((m) => m.CategoriaListComponent),
  },
  {
    path: 'secciones',
    loadComponent: () => import('./secciones/secciones-list.component').then((m) => m.SeccionesListComponent),
  },
];

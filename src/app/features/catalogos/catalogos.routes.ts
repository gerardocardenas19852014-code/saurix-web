import { Routes } from '@angular/router';

export const CATALOGOS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./landing/catalogos-landing.component').then((m) => m.CatalogosLandingComponent),
  },

  // Los catálogos de WikiDocs (Tipo de sistema, Categoría, Secciones) se
  // movieron por completo a features/wikidocs (jerarquía real
  // TipoSistema→Categoria→Sección, con FK padre obligatorio) — mismo
  // criterio que los catálogos de Proyectos, que viven solo en su propio
  // módulo y no aquí.

  // Catálogos de Presupuesto Personal (compartidos entre todos los usuarios).
  {
    path: 'categorias-presupuesto',
    loadComponent: () =>
      import('./categoria-presupuesto/categoria-presupuesto-list.component').then(
        (m) => m.CategoriaPresupuestoListComponent,
      ),
  },
  {
    path: 'cuentas-presupuesto',
    loadComponent: () =>
      import('./cuenta-presupuesto/cuenta-presupuesto-list.component').then((m) => m.CuentaPresupuestoListComponent),
  },
];

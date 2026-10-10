import { Routes } from '@angular/router';

export const SEGURIDAD_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./landing/seguridad-landing.component').then((m) => m.SeguridadLandingComponent),
  },
  {
    path: 'empresas',
    loadComponent: () => import('./empresas/empresas.component').then((m) => m.EmpresasComponent),
  },
  {
    path: 'usuarios',
    loadComponent: () =>
      import('./usuarios/usuarios-list.component').then((m) => m.UsuariosListComponent),
  },
];

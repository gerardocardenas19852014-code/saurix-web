import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { ShellComponent } from './layout/shell/shell.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'modulos' },
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'modulos',
    canActivate: [authGuard],
    loadComponent: () => import('./features/auth/modulos/modulos.component').then((m) => m.ModulosComponent),
  },
  {
    path: '',
    component: ShellComponent,
    canActivate: [authGuard],
    children: [
      {
        path: 'seguridad',
        loadChildren: () => import('./features/seguridad/seguridad.routes').then((m) => m.SEGURIDAD_ROUTES),
      },
      {
        path: 'wikidocs',
        loadChildren: () => import('./features/wikidocs/wikidocs.routes').then((m) => m.WIKIDOCS_ROUTES),
      },
      {
        path: 'panel-control',
        loadChildren: () =>
          import('./features/panel-control/panel-control.routes').then((m) => m.PANEL_CONTROL_ROUTES),
      },

      {
        path: 'presupuesto',
        loadChildren: () =>
          import('./features/presupuesto/presupuesto.routes').then((m) => m.PRESUPUESTO_ROUTES),
      },

      {
        path: 'proyectos',
        loadChildren: () => import('./features/proyectos/proyectos.routes').then((m) => m.PROYECTOS_ROUTES),
      },

      // Deshabilitado temporalmente mientras se termina de trabajar en los demás
      // módulos. El código sigue aquí, solo se quitó del router: entrar a esta
      // ruta cae en el '**' de abajo y redirige a /modulos. Para reactivarlo,
      // solo descomenta su entrada.
      // {
      //   path: 'comercio',
      //   loadChildren: () => import('./features/comercio/comercio.routes').then((m) => m.COMERCIO_ROUTES),
      // },
    ],
  },
  { path: '**', redirectTo: 'modulos' },
];

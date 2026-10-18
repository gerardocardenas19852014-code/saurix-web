import { Routes } from '@angular/router';

export const PANEL_CONTROL_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./landing/panel-control-landing.component').then((m) => m.PanelControlLandingComponent),
  },
  {
    path: 'apariencia',
    loadComponent: () => import('./apariencia/apariencia.component').then((m) => m.AparienciaComponent),
  },
  {
    path: 'parametros',
    loadComponent: () => import('./parametros/parametros.component').then((m) => m.ParametrosComponent),
  },
];

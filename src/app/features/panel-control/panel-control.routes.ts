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
    path: 'conexiones',
    loadComponent: () => import('./conexiones/conexiones.component').then((m) => m.ConexionesComponent),
  },
  {
    path: 'respaldo',
    loadComponent: () => import('./respaldo/respaldo.component').then((m) => m.RespaldoComponent),
  },
];

import { Routes } from '@angular/router';

export const PANEL_CONTROL_ROUTES: Routes = [
  { path: '', redirectTo: 'apariencia', pathMatch: 'full' },
  {
    path: 'apariencia',
    loadComponent: () => import('./apariencia/apariencia.component').then((m) => m.AparienciaComponent),
  },
  {
    path: 'conexiones',
    loadComponent: () => import('./conexiones/conexiones.component').then((m) => m.ConexionesComponent),
  },
];

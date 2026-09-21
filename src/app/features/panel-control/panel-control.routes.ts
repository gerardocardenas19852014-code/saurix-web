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

  // Configuración propia de cada módulo, anidada bajo el nombre del módulo
  // al que pertenece — evita ambigüedad ahora que Panel de Control aloja
  // pantallas de configuración de varios módulos distintos.
  {
    path: 'gestion-proyectos/gestor-estados',
    loadComponent: () => import('./gestor-estados/tableros.component').then((m) => m.TablerosComponent),
  },
];

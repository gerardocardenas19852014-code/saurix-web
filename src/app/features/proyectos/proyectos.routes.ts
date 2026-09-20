import { Routes } from '@angular/router';

export const PROYECTOS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./landing/proyectos-landing.component').then((m) => m.ProyectosLandingComponent),
  },
  {
    path: 'tablero',
    loadComponent: () => import('./kanban/kanban.component').then((m) => m.KanbanComponent),
  },
  {
    path: 'proyectos',
    loadComponent: () =>
      import('./proyectos-lista/proyectos-lista.component').then((m) => m.ProyectosListaComponent),
  },
  {
    path: 'dashboard',
    loadComponent: () => import('./dashboard/dashboard.component').then((m) => m.ProyectosDashboardComponent),
  },
  {
    path: 'reportes-horas',
    loadComponent: () => import('./reportes-horas/reportes-horas.component').then((m) => m.ReportesHorasComponent),
  },
];

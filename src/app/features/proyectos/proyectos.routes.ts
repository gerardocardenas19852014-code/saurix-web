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
    path: 'backlog',
    loadComponent: () => import('./backlog/backlog.component').then((m) => m.BacklogComponent),
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
  {
    path: 'gantt',
    loadComponent: () => import('./gantt/gantt.component').then((m) => m.GanttComponent),
  },
  {
    path: 'resumen-ejecutivo',
    loadComponent: () =>
      import('./resumen-ejecutivo/resumen-ejecutivo.component').then((m) => m.ResumenEjecutivoComponent),
  },
  {
    path: 'gestor-estados',
    loadComponent: () => import('./gestor-estados/tableros.component').then((m) => m.TablerosComponent),
  },
  {
    path: 'balanceo',
    loadComponent: () => import('./balanceo/balanceo.component').then((m) => m.BalanceoComponent),
  },
  {
    path: 'reportes-ejecutivos',
    loadComponent: () =>
      import('./reportes-ejecutivos/reportes-ejecutivos.component').then((m) => m.ReportesEjecutivosComponent),
  },

  // Catálogos de Gestión de Proyectos (antes en features/catalogos; se
  // movieron aquí porque son propios de este módulo).
  {
    path: 'tipos-ticket',
    loadComponent: () => import('./ticket-tipos/ticket-tipos.component').then((m) => m.TicketTiposComponent),
  },
  {
    path: 'prioridades',
    loadComponent: () =>
      import('./ticket-prioridades/ticket-prioridades.component').then((m) => m.TicketPrioridadesComponent),
  },
  {
    path: 'modulos',
    loadComponent: () => import('./ticket-modulos/ticket-modulos.component').then((m) => m.TicketModulosComponent),
  },
];

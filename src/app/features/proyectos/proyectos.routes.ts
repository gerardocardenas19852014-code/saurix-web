import { Routes } from '@angular/router';
import { CatalogoSimpleConfig } from '../../shared/components/catalogo-simple/catalogo-simple.model';

function rutaCatalogoSimple(path: string, config: CatalogoSimpleConfig) {
  return {
    path,
    loadComponent: () =>
      import('../../shared/components/catalogo-simple/catalogo-simple.component').then(
        (m) => m.CatalogoSimpleComponent,
      ),
    data: { config },
  };
}

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
    path: 'tableros',
    loadComponent: () => import('./tableros/tableros.component').then((m) => m.TablerosComponent),
  },
  {
    path: 'tipos-ticket',
    loadComponent: () => import('./ticket-tipos/ticket-tipos.component').then((m) => m.TicketTiposComponent),
  },
  {
    path: 'prioridades',
    loadComponent: () =>
      import('./ticket-prioridades/ticket-prioridades.component').then((m) => m.TicketPrioridadesComponent),
  },
  rutaCatalogoSimple('motivos-solucion', {
    entidad: 'TicketTipoSolucion',
    tituloPlural: 'Motivos de Solución',
    tituloSingular: 'Motivo de Solución',
  }),
  {
    path: 'dashboard',
    loadComponent: () => import('./dashboard/dashboard.component').then((m) => m.ProyectosDashboardComponent),
  },
  {
    path: 'reportes-horas',
    loadComponent: () => import('./reportes-horas/reportes-horas.component').then((m) => m.ReportesHorasComponent),
  },
];

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

/**
 * CRM absorbe lo que antes era el módulo "Comercio" (quedó deshabilitado en
 * app.routes.ts desde 2026-09-18) como su sub-sección "Ventas" — los
 * componentes siguen viviendo físicamente en features/comercio/ (no se
 * duplicó ni movió código, solo se reenrutaron) para no arriesgar el
 * código ya probado; lo nuevo de este módulo (Leads, y lo que se agregue
 * después: Pipeline de oportunidades, Casos, Campañas) vive aquí mismo en
 * features/crm/.
 */
export const CRM_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./landing/crm-landing.component').then((m) => m.CrmLandingComponent),
  },

  // Leads
  {
    path: 'leads',
    loadComponent: () => import('./leads/leads-list.component').then((m) => m.LeadsListComponent),
  },
  rutaCatalogoSimple('leads/origenes', {
    entidad: 'LeadOrigen',
    tituloPlural: 'Orígenes de lead',
    tituloSingular: 'Origen de lead',
  }),

  // Pipeline de oportunidades
  {
    path: 'oportunidades',
    loadComponent: () =>
      import('./oportunidades/oportunidades-kanban.component').then((m) => m.OportunidadesKanbanComponent),
  },
  {
    path: 'oportunidades/etapas',
    loadComponent: () =>
      import('./oportunidades/gestor-etapas/gestor-etapas.component').then((m) => m.GestorEtapasComponent),
  },
  rutaCatalogoSimple('oportunidades/motivos-perdida', {
    entidad: 'MotivoPerdida',
    tituloPlural: 'Motivos de pérdida',
    tituloSingular: 'Motivo de pérdida',
  }),

  // Casos de servicio
  {
    path: 'casos',
    loadComponent: () => import('./casos/casos-list.component').then((m) => m.CasosListComponent),
  },

  // Campañas de marketing
  {
    path: 'campanas',
    loadComponent: () => import('./campanas/campanas-list.component').then((m) => m.CampanasListComponent),
  },

  // Ventas (ex-Comercio)
  rutaCatalogoSimple('categorias-producto', {
    entidad: 'CategoriaProducto',
    tituloPlural: 'Categorías de Producto',
    tituloSingular: 'Categoría de Producto',
  }),
  {
    path: 'productos',
    loadComponent: () => import('../comercio/productos/productos.component').then((m) => m.ProductosComponent),
  },
  {
    path: 'clientes',
    loadComponent: () => import('../comercio/clientes/clientes.component').then((m) => m.ClientesComponent),
  },
  {
    path: 'cotizaciones',
    loadComponent: () =>
      import('../comercio/cotizaciones/cotizaciones.component').then((m) => m.CotizacionesComponent),
  },
  {
    path: 'ventas',
    loadComponent: () => import('../comercio/ventas/ventas.component').then((m) => m.VentasComponent),
  },
];

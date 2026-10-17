import { Routes } from '@angular/router';

export const VENTAS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./landing/ventas-landing.component').then((m) => m.VentasLandingComponent),
  },
  {
    path: 'cobro',
    loadComponent: () => import('./cobro/cobro.component').then((m) => m.CobroComponent),
  },
  {
    path: 'apertura-turno',
    loadComponent: () => import('./turno/apertura-turno.component').then((m) => m.AperturaTurnoComponent),
  },
  {
    path: 'corte-turno',
    loadComponent: () => import('./turno/corte-turno.component').then((m) => m.CorteTurnoComponent),
  },
  {
    path: 'cierre-turno',
    loadComponent: () => import('./turno/cierre-turno.component').then((m) => m.CierreTurnoComponent),
  },
  {
    path: 'historial',
    loadComponent: () => import('./historial/historial-ventas.component').then((m) => m.HistorialVentasComponent),
  },
  {
    path: 'clientes',
    loadComponent: () => import('./clientes/clientes.component').then((m) => m.ClientesComponent),
  },
  {
    path: 'regimenes-fiscales',
    loadComponent: () =>
      import('./regimenes-fiscales/regimenes-fiscales.component').then((m) => m.RegimenesFiscalesComponent),
  },
  {
    path: 'dashboard',
    loadComponent: () => import('./dashboard/dashboard-ventas.component').then((m) => m.DashboardVentasComponent),
  },
  {
    path: 'cotizaciones',
    loadComponent: () => import('./cotizacion/cotizaciones.component').then((m) => m.CotizacionesComponent),
  },
];

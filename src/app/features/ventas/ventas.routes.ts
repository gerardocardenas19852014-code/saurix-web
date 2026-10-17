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
  {
    path: 'cuentas-por-cobrar',
    loadComponent: () =>
      import('./cuenta-por-cobrar/cuentas-por-cobrar.component').then((m) => m.CuentasPorCobrarComponent),
  },
  {
    path: 'comisiones-vendedores',
    loadComponent: () =>
      import('./comision-vendedor/comisiones-vendedores.component').then((m) => m.ComisionesVendedoresComponent),
  },
  {
    path: 'reporte-comisiones',
    loadComponent: () =>
      import('./comision-vendedor/reporte-comisiones.component').then((m) => m.ReporteComisionesComponent),
  },
  {
    path: 'configuracion-lealtad',
    loadComponent: () =>
      import('./lealtad/configuracion-lealtad.component').then((m) => m.ConfiguracionLealtadComponent),
  },
];

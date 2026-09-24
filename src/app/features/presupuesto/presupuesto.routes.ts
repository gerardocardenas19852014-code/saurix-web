import { Routes } from '@angular/router';
import { PresupuestoLandingComponent } from './landing/presupuesto-landing.component';
import { PresupuestoInicioComponent } from './inicio/presupuesto-inicio.component';
import { MovimientosComponent } from './movimientos/movimientos.component';
import { RecurrentesComponent } from './recurrentes/recurrentes.component';
import { DeudasComponent } from './deudas/deudas.component';
import { MetasComponent } from './metas/metas.component';
import { LimitesComponent } from './limites/limites.component';
import { ReportesComponent } from './reportes/reportes.component';
import { CalendarioComponent } from './calendario/calendario.component';
import { ProyeccionComponent } from './proyeccion/proyeccion.component';

export const PRESUPUESTO_ROUTES: Routes = [
  { path: '', component: PresupuestoInicioComponent },
  { path: 'dashboard', component: PresupuestoLandingComponent },
  { path: 'movimientos', component: MovimientosComponent },
  { path: 'recurrentes', component: RecurrentesComponent },
  { path: 'deudas', component: DeudasComponent },
  { path: 'metas', component: MetasComponent },
  { path: 'limites', component: LimitesComponent },
  { path: 'reportes', component: ReportesComponent },
  { path: 'calendario', component: CalendarioComponent },
  { path: 'proyeccion', component: ProyeccionComponent },

  // Catálogos de Presupuesto Personal (antes en features/catalogos; se
  // movieron aquí porque son propios de este módulo). Se cargan de forma
  // perezosa (loadComponent), igual que el resto de catálogos de la app.
  {
    path: 'categorias-presupuesto',
    loadComponent: () =>
      import('./categoria-presupuesto/categoria-presupuesto-list.component').then(
        (m) => m.CategoriaPresupuestoListComponent,
      ),
  },
  {
    path: 'cuentas-presupuesto',
    loadComponent: () =>
      import('./cuenta-presupuesto/cuenta-presupuesto-list.component').then((m) => m.CuentaPresupuestoListComponent),
  },
  {
    path: 'tipo-cuenta-presupuesto',
    loadComponent: () =>
      import('./tipo-cuenta-presupuesto/tipo-cuenta-presupuesto.component').then(
        (m) => m.TipoCuentaPresupuestoComponent,
      ),
  },
  {
    path: 'tipo-movimiento-presupuesto',
    loadComponent: () =>
      import('./tipo-movimiento-presupuesto/tipo-movimiento-presupuesto.component').then(
        (m) => m.TipoMovimientoPresupuestoComponent,
      ),
  },
  {
    path: 'frecuencia-fijos-presupuesto',
    loadComponent: () =>
      import('./frecuencia-fijos-presupuesto/frecuencia-fijos-presupuesto.component').then(
        (m) => m.FrecuenciaFijosPresupuestoComponent,
      ),
  },
  {
    path: 'presupuesto-anual',
    loadComponent: () =>
      import('./presupuesto-anual/presupuesto-anual-list.component').then((m) => m.PresupuestoAnualListComponent),
  },
  {
    path: 'estatus-presupuesto-anual',
    loadComponent: () =>
      import('./presupuesto-anual-estatus/presupuesto-anual-estatus.component').then(
        (m) => m.PresupuestoAnualEstatusComponent,
      ),
  },
];

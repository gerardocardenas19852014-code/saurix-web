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
];

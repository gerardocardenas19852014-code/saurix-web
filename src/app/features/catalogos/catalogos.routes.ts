import { Routes } from '@angular/router';

export const CATALOGOS_ROUTES: Routes = [
  // Sin landing/Inicio propio: el menú lateral ya lista cada catálogo
  // agrupado (ver shell.component.html), así que entrar a /catalogos a
  // secas manda directo al primero.
  { path: '', redirectTo: 'categorias-presupuesto', pathMatch: 'full' },

  // Los catálogos de WikiDocs (Tipo de sistema, Categoría, Secciones) se
  // movieron por completo a features/wikidocs (jerarquía real
  // TipoSistema→Categoria→Sección, con FK padre obligatorio) y viven solo
  // en su propio módulo, no aquí.

  // Catálogos de Presupuesto Personal (compartidos entre todos los usuarios).
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
    path: 'proveedor-conexion',
    loadComponent: () =>
      import('./proveedor-conexion/proveedor-conexion.component').then((m) => m.ProveedorConexionComponent),
  },

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

  // Catálogos de Gestión de Proyectos (los administra el mismo Catálogos
  // general; el modelo de datos de cada uno sigue viviendo en su módulo de
  // origen, dentro de features/proyectos, ya que las pantallas del propio
  // módulo de Gestión de Proyectos también lo usan).
  {
    path: 'tipos-ticket',
    loadComponent: () =>
      import('./ticket-tipos/ticket-tipos.component').then((m) => m.TicketTiposComponent),
  },
  {
    path: 'prioridades',
    loadComponent: () =>
      import('./ticket-prioridades/ticket-prioridades.component').then((m) => m.TicketPrioridadesComponent),
  },
  {
    path: 'modulos',
    loadComponent: () =>
      import('./ticket-modulos/ticket-modulos.component').then((m) => m.TicketModulosComponent),
  },
];

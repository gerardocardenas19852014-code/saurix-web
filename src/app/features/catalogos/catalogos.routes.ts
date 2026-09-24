import { Routes } from '@angular/router';

export const CATALOGOS_ROUTES: Routes = [
  // Sin landing/Inicio propio: el menú lateral ya lista cada catálogo
  // agrupado (ver shell.component.html), así que entrar a /catalogos a
  // secas manda directo al primero.
  { path: '', redirectTo: 'proveedor-conexion', pathMatch: 'full' },

  // Los catálogos de WikiDocs (Tipo de sistema, Categoría, Secciones) se
  // movieron por completo a features/wikidocs (jerarquía real
  // TipoSistema→Categoria→Sección, con FK padre obligatorio) y viven solo
  // en su propio módulo, no aquí.

  // Los catálogos de Presupuesto Personal (categorías, cuentas, tipo de
  // cuenta, tipo de movimiento, frecuencia de fijos, presupuesto anual y su
  // estatus) se movieron a features/presupuesto — ver presupuesto.routes.ts.

  // Los catálogos de Gestión de Proyectos (Tipos de Ticket, Prioridades,
  // Módulos) se movieron a features/proyectos — ver proyectos.routes.ts.

  {
    path: 'proveedor-conexion',
    loadComponent: () =>
      import('./proveedor-conexion/proveedor-conexion.component').then((m) => m.ProveedorConexionComponent),
  },
];

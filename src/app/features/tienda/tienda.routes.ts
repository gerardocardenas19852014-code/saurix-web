import { Routes } from '@angular/router';

/**
 * Rutas PÚBLICAS (sin login, sin ShellComponent/authGuard — ver
 * app.routes.ts, mismo nivel que 'login'/'restablecer') de la tienda:
 *  - /tienda           → portal con selector de negocios activos.
 *  - /tienda/:clave    → catálogo de un negocio en concreto; si ya se
 *    conoce la clave (link directo, QR impreso, etc.) se entra aquí sin
 *    pasar por el portal.
 */
export const TIENDA_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./portal/portal-tienda.component').then((m) => m.PortalTiendaComponent),
  },
  {
    path: ':clave',
    loadComponent: () => import('./catalogo/catalogo-tienda.component').then((m) => m.CatalogoTiendaComponent),
  },
];

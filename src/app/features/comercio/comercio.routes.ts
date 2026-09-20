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

export const COMERCIO_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./landing/comercio-landing.component').then((m) => m.ComercioLandingComponent),
  },
  rutaCatalogoSimple('categorias-producto', {
    entidad: 'CategoriaProducto',
    tituloPlural: 'Categorías de Producto',
    tituloSingular: 'Categoría de Producto',
  }),
  {
    path: 'productos',
    loadComponent: () => import('./productos/productos.component').then((m) => m.ProductosComponent),
  },
  {
    path: 'clientes',
    loadComponent: () => import('./clientes/clientes.component').then((m) => m.ClientesComponent),
  },
  {
    path: 'cotizaciones',
    loadComponent: () => import('./cotizaciones/cotizaciones.component').then((m) => m.CotizacionesComponent),
  },
  {
    path: 'ventas',
    loadComponent: () => import('./ventas/ventas.component').then((m) => m.VentasComponent),
  },
];

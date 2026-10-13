import { Routes } from '@angular/router';

export const INVENTARIO_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./landing/inventario-landing.component').then((m) => m.InventarioLandingComponent),
  },
  {
    path: 'productos',
    loadComponent: () => import('./productos/productos.component').then((m) => m.ProductosComponent),
  },

  // Catálogos propios de Inventario.
  {
    path: 'bodegas',
    loadComponent: () => import('./bodegas/bodegas.component').then((m) => m.BodegasComponent),
  },
  {
    path: 'proveedores',
    loadComponent: () => import('./proveedores/proveedores.component').then((m) => m.ProveedoresComponent),
  },
  {
    path: 'categorias-producto',
    loadComponent: () =>
      import('./categorias-producto/categorias-producto.component').then((m) => m.CategoriasProductoComponent),
  },
  {
    path: 'unidades-medida',
    loadComponent: () =>
      import('./unidades-medida/unidades-medida.component').then((m) => m.UnidadesMedidaComponent),
  },
  {
    path: 'tipos-lista-precio',
    loadComponent: () =>
      import('./tipos-lista-precio/tipos-lista-precio.component').then((m) => m.TiposListaPrecioComponent),
  },
  {
    path: 'listas-precio/:id',
    loadComponent: () =>
      import('./listas-precio/lista-precio-detalle.component').then((m) => m.ListaPrecioDetalleComponent),
  },
  {
    path: 'valor-stock',
    loadComponent: () => import('./valor-stock/valor-stock.component').then((m) => m.ValorStockComponent),
  },
  {
    path: 'movimientos-bodega',
    loadComponent: () =>
      import('./movimientos-bodega/movimientos-bodega.component').then((m) => m.MovimientosBodegaComponent),
  },
  {
    path: 'sugerencia-reposicion',
    loadComponent: () =>
      import('./sugerencia-reposicion/sugerencia-reposicion.component').then((m) => m.SugerenciaReposicionComponent),
  },
  {
    path: 'conteo-fisico',
    loadComponent: () => import('./conteo-fisico/conteo-fisico.component').then((m) => m.ConteoFisicoComponent),
  },
];

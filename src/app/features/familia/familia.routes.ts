import { Routes } from '@angular/router';

export const FAMILIA_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./inicio/familia-inicio.component').then((m) => m.FamiliaInicioComponent),
  },
  {
    path: 'miembros',
    loadComponent: () => import('./miembros/miembros.component').then((m) => m.MiembrosFamiliaComponent),
  },
  {
    path: 'parentesco',
    loadComponent: () => import('./parentesco/parentesco.component').then((m) => m.ParentescoComponent),
  },
  {
    path: 'tipo-documento',
    loadComponent: () => import('./documento-tipo/documento-tipo.component').then((m) => m.DocumentoTipoComponent),
  },
];

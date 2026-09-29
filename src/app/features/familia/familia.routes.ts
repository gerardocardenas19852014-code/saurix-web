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
  {
    path: 'sexo',
    loadComponent: () => import('./sexo/sexo.component').then((m) => m.SexoComponent),
  },
  {
    path: 'entidad-nacimiento',
    loadComponent: () => import('./entidad-nacimiento/entidad-nacimiento.component').then((m) => m.EntidadNacimientoComponent),
  },
  {
    path: 'tipo-sangre',
    loadComponent: () => import('./tipo-sangre/tipo-sangre.component').then((m) => m.TipoSangreComponent),
  },
];

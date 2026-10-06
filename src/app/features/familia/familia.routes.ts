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
    path: 'arbol',
    loadComponent: () => import('./arbol/arbol-familiar.component').then((m) => m.ArbolFamiliarComponent),
  },
  {
    path: 'calendario',
    loadComponent: () => import('./calendario/calendario-familiar.component').then((m) => m.CalendarioFamiliarComponent),
  },
  {
    path: 'resumen',
    loadComponent: () => import('./resumen/resumen-familia.component').then((m) => m.ResumenFamiliaComponent),
  },
  {
    path: 'tramites',
    loadComponent: () => import('./tramites/tramites-familiares.component').then((m) => m.TramitesFamiliaresComponent),
  },
  {
    path: 'tareas',
    loadComponent: () => import('./tareas-hogar/tareas-hogar.component').then((m) => m.TareasHogarComponent),
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
  {
    path: 'proveedor-salud',
    loadComponent: () => import('./proveedor-salud/proveedor-salud.component').then((m) => m.ProveedorSaludComponent),
  },
];

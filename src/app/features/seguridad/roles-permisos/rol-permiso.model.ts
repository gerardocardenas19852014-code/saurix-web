export interface Rol {
  id: number;
  nombre: string;
  activo: boolean;
}

export interface Permiso {
  id: number;
  nombre: string;
  activo: boolean;
}

export interface RolPermiso {
  id: number;
  rolId: number;
  permisoId: number;
  activo: boolean;
}

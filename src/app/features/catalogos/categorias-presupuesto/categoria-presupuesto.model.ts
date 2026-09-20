export interface CategoriaPresupuesto {
  id: number;
  nombre: string;
  categoriaPresupuestoPadreId: number | null;
  activo: boolean;
}

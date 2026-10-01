/**
 * Límite de gasto mensual — compartido entre todos los usuarios
 * (creadoPorUsuarioId se guarda solo como auditoría, no filtra la lista).
 * Por categoría, o general (todas) si categoriaPresupuestoId es NULL.
 */
export interface LimitePresupuesto {
  id: number;
  categoriaPresupuestoId: number | null;
  montoLimite: number;
  creadoPorUsuarioId: number;
  activo: boolean;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

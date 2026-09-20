/**
 * Límite de gasto mensual — personal (por usuario, vía creadoPorUsuarioId).
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

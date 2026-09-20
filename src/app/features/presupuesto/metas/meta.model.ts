/**
 * Metas de ahorro — personal (por usuario, vía creadoPorUsuarioId). Seguimiento
 * manual: "Aportar" suma directo a montoActual (no hay tabla de historial para
 * metas, a diferencia de Deudas/DeudaPresupuestoAbono — así lo define el esquema).
 */
export interface MetaPresupuesto {
  id: number;
  nombre: string;
  montoObjetivo: number;
  montoActual: number;
  fechaLimite: string;
  creadoPorUsuarioId: number;
  activo: boolean;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

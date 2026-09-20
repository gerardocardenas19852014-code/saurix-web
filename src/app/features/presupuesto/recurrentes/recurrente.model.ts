/** Ahora viene del catálogo "Listas de valores" (Catálogos, grupo
 *  MovimientoRecurrenteFrecuencia) en vez de un enum fijo. */
export type FrecuenciaRecurrente = string;

/**
 * "Fijos y Proyección" — personal (por usuario, vía creadoPorUsuarioId).
 * Un "Anual" usa como mes de referencia el mes en que se creó el fijo
 * (fechaCreacion) — p.ej. una póliza de seguro dada de alta en marzo se
 * considera "del ciclo" cada marzo.
 */
export interface MovimientoRecurrentePresupuesto {
  id: number;
  descripcion: string;
  tipo: string; // catálogo "Listas de valores", grupo MovimientoPresupuestoTipo (compartido con Movimientos)
  cuentaPresupuestoId: number;
  categoriaPresupuestoId: number | null;
  monto: number;
  frecuencia: FrecuenciaRecurrente;
  diaDelMes: number;
  /** Último ciclo ('2026-8' o '2026') ya avisado como "fijo sin registrar", para no duplicar el aviso. */
  avisoFaltanteCiclo: string | null;
  creadoPorUsuarioId: number;
  activo: boolean;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

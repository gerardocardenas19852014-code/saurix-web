export type FrecuenciaRecurrente = 'Mensual' | 'Anual';

/**
 * "Fijos y Proyección" — personal (por usuario, vía creadoPorUsuarioId).
 * Un "Anual" usa como mes de referencia el mes en que se creó el fijo
 * (fechaCreacion) — p.ej. una póliza de seguro dada de alta en marzo se
 * considera "del ciclo" cada marzo.
 */
export interface MovimientoRecurrentePresupuesto {
  id: number;
  descripcion: string;
  tipo: 'Ingreso' | 'Gasto';
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

/**
 * Deudas (préstamos) — personal (por usuario, vía creadoPorUsuarioId).
 * saldoActual es un campo "caché" que siempre se recalcula a partir del
 * historial real de abonos (DeudaPresupuestoAbono) — nunca se edita a mano
 * en el formulario, para que el saldo nunca se desincronice de sus abonos.
 */
export interface DeudaPresupuesto {
  id: number;
  descripcion: string;
  montoOriginal: number;
  saldoActual: number;
  fechaInicio: string;
  creadoPorUsuarioId: number;
  activo: boolean;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

/** Historial real de abonos de una deuda — la fuente de verdad del saldo. */
export interface DeudaPresupuestoAbono {
  id: number;
  deudaPresupuestoId: number;
  fecha: string;
  monto: number;
  nota: string | null;
  /** Cuenta desde la que se pagó este abono, SOLO cuando el usuario decidió
   *  que también se registrara como un Gasto real (afecta el saldo de esa
   *  cuenta y aparece en Movimientos/Reportes/Dashboard). null = abono
   *  "manual" de solo este ledger, sin tocar ninguna cuenta (comportamiento
   *  original, antes de que existiera esta opción). */
  cuentaPresupuestoId: number | null;
  /** Id del MovimientoPresupuesto (Gasto) generado para este abono cuando
   *  cuentaPresupuestoId no es null — permite revertirlo si el abono se
   *  borra (ver DeudasComponent.eliminarAbono). */
  movimientoPresupuestoId: number | null;
  creadoPorUsuarioId: number;
  fechaCreacion?: string;
}

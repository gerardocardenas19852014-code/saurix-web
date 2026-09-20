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
  creadoPorUsuarioId: number;
  fechaCreacion?: string;
}

/** Ahora viene del catálogo "Listas de valores" (Catálogos, grupo
 *  CuentaPresupuestoTipo) en vez de un enum fijo — cualquier clave que
 *  exista ahí es válida. */
export type TipoCuentaPresupuesto = string;

/**
 * Catálogo compartido (Presupuesto Personal). No tiene "saldoInicial": el
 * saldo de cada cuenta se calcula 100% a partir de sus movimientos. Los
 * campos de tarjeta solo aplican cuando tipo = 'Tarjeta' (el resto de tipos
 * los deja en null).
 */
export interface CuentaPresupuesto {
  id: number;
  nombre: string;
  tipo: TipoCuentaPresupuesto;
  limiteCredito: number | null;
  diaCorte: number | null;
  diaPago: number | null;
  pagoMinimo: number | null;
  pagoSinIntereses: number | null;
  /** Igual que en otros catálogos: alternativa al borrado duro (que ya se
   *  bloquea si la usan movimientos/recurrentes). undefined en filas viejas
   *  se trata como activo. */
  activo?: boolean;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

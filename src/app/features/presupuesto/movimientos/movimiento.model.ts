/** Ahora viene del catálogo "Listas de valores" (Catálogos, grupo
 *  MovimientoPresupuestoTipo) en vez de un enum fijo. */
export type TipoMovimiento = string;

/** Personal (por usuario, vía creadoPorUsuarioId) — nunca visible entre usuarios. */
export interface MovimientoPresupuesto {
  id: number;
  fecha: string;
  tipo: TipoMovimiento;
  cuentaPresupuestoId: number;
  categoriaPresupuestoId: number | null;
  monto: number;
  descripcion: string;
  /** GUID que liga el par (gasto en origen + ingreso en destino) de una transferencia entre cuentas propias. */
  transferenciaId: string | null;
  /** Si este movimiento se generó desde "Registrar este ciclo" de un fijo, aquí queda la referencia (trazabilidad). */
  origenRecurrenteId: number | null;
  creadoPorUsuarioId: number;
  activo: boolean;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

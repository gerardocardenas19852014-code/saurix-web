/**
 * Metas de ahorro — personal (por usuario, vía creadoPorUsuarioId).
 * montoActual sigue siendo el campo que se muestra y edita directo (igual
 * que siempre): "+ Aportar" lo incrementa, y el formulario permite
 * corregirlo a mano si hace falta. Desde que existe MetaPresupuestoAporte,
 * cada "+ Aportar" ADEMÁS deja un registro con fecha en ese historial (y,
 * opcionalmente, qué cuenta lo pagó) — un aporte de historial se puede
 * borrar (revierte su monto de montoActual) pero montoActual en sí NO se
 * deriva 100% del ledger como saldoActual en Deudas: el progreso que ya
 * tenías capturado antes de este historial se conserva tal cual, sin
 * inventarle aportes que nunca se registraron con fecha.
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

/** Historial de aportes — mismo patrón que DeudaPresupuestoAbono en Deudas. */
export interface MetaPresupuestoAporte {
  id: number;
  metaPresupuestoId: number;
  fecha: string;
  monto: number;
  nota: string | null;
  /** Cuenta desde la que salió este aporte, SOLO cuando el usuario decidió
   *  que también se registrara como un Gasto real (afecta el saldo de esa
   *  cuenta y aparece en Movimientos/Reportes/Dashboard). null = aporte
   *  "manual" de solo este ledger, sin tocar ninguna cuenta. */
  cuentaPresupuestoId: number | null;
  /** Id del MovimientoPresupuesto (Gasto) generado para este aporte cuando
   *  cuentaPresupuestoId no es null — permite revertirlo si el aporte se
   *  borra (ver MetasComponent.eliminarAporte). */
  movimientoPresupuestoId: number | null;
  creadoPorUsuarioId: number;
  fechaCreacion?: string;
}

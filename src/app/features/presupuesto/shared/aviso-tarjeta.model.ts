/**
 * Registro de dedupe para las alertas de tarjeta (uso ≥90% del límite / recordatorio
 * de pago próximo con deuda pendiente) — mismo espíritu que
 * MovimientoRecurrentePresupuesto.avisoFaltanteCiclo: evita mandar el mismo aviso
 * una y otra vez dentro del mismo ciclo. Es personal (por usuario, vía usuarioId)
 * aunque CuentaPresupuesto sea un catálogo compartido, porque la deuda/uso que
 * dispara la alerta se calcula sobre MIS movimientos de esa cuenta.
 *
 * NOTA: al igual que Notificacion, esta entidad todavía NO existe en
 * 01_Tablas_Saurix.sql/02_SPs_Saurix.sql — vive hoy en IndexedDB sin backend.
 */
export interface AvisoTarjetaCiclo {
  id: number;
  cuentaPresupuestoId: number;
  usuarioId: number;
  tipoAviso: 'uso' | 'pago';
  /** Ciclo ya avisado, p.ej. '2026-9' — así no se repite el mismo aviso en el mismo mes. */
  ciclo: string;
  fechaCreacion?: string;
}

/**
 * Registro de dedupe para la alerta persistente de "stock bajo" (ver
 * NotificacionesService.revisarAlertasStockBajo()) — mismo espíritu que
 * AvisoTarjetaCiclo (presupuesto/shared/aviso-tarjeta.model.ts): evita
 * mandar el mismo aviso una y otra vez mientras el producto siga por
 * debajo de su nivelMinimo. A diferencia de AvisoTarjetaCiclo, que es
 * mensual, aquí el dedupe es por DÍA (`dia`) — el stock cambia mucho más
 * rápido que el ciclo de una tarjeta de crédito, así que conviene volver a
 * avisar al día siguiente si el producto sigue sin reabastecerse.
 *
 * NOTA: al igual que Notificacion/AvisoTarjetaCiclo, esta entidad todavía
 * NO existe en 01_Tablas_Saurix.sql/02_SPs_Saurix.sql — vive hoy en
 * IndexedDB sin backend.
 */
export interface AvisoStockBajo {
  id: number;
  productoId: number;
  usuarioId: number;
  /** Día ya avisado, formato 'YYYY-MM-DD'. */
  dia: string;
  fechaCreacion?: string;
}

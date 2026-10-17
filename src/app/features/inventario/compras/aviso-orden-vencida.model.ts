/**
 * Dedupe de la notificación persistente de "orden de compra vencida" (ver
 * NotificacionesService.revisarOrdenesVencidas()) — mismo patrón exacto que
 * AvisoStockBajo (ver aviso-stock-bajo.model.ts en valor-stock): sin esto,
 * cada ciclo de revisión periódica (ver shell.component.ts) volvería a
 * mandar la misma notificación una y otra vez mientras la orden siga
 * vencida. Único por (ordenCompraId, usuarioId, dia) — si sigue vencida al
 * día siguiente, se vuelve a avisar una vez ese día.
 */
export interface AvisoOrdenVencida {
  id: number;
  ordenCompraId: number;
  usuarioId: number;
  /** 'YYYY-MM-DD', día local en que se mandó este aviso. */
  dia: string;
}

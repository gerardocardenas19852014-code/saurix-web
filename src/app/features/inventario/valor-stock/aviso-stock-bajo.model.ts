/**
 * Registro de dedupe para la alerta persistente de "stock bajo" (ver
 * NotificacionesService.revisarAlertasStockBajo()) — mismo espíritu que
 * AvisoTarjetaCiclo (presupuesto/shared/aviso-tarjeta.model.ts): evita
 * mandar el mismo aviso una y otra vez mientras el producto siga por
 * debajo de su mínimo. A diferencia de AvisoTarjetaCiclo, que es mensual,
 * aquí el dedupe es por DÍA (`dia`) — el stock cambia mucho más rápido que
 * el ciclo de una tarjeta de crédito, así que conviene volver a avisar al
 * día siguiente si el producto sigue sin reabastecerse.
 */
export interface AvisoStockBajo {
  id: number;
  productoId: number;
  /** Bodega concreta de la alerta — null cuando es la evaluación global
   *  "heredada" (el producto todavía no tiene ningún NivelMinimoBodega
   *  propio, ver alertasStockBajo() en producto.util.ts). Un mismo producto
   *  puede tener una alerta null Y una o más con bodegaId a la vez si tiene
   *  varias bodegas, cada una vigilada por su cuenta. */
  bodegaId: number | null;
  usuarioId: number;
  /** Día ya avisado, formato 'YYYY-MM-DD'. */
  dia: string;
  fechaCreacion?: string;
}

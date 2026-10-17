export type EstadoTurnoCaja = 'Abierto' | 'Cerrado';

/**
 * Un turno de caja: desde que se abre (con un monto inicial en efectivo)
 * hasta que se cierra (contando el efectivo físico contra lo que el
 * sistema esperaba encontrar — ver TurnoCajaService.cerrar()). Toda Venta
 * queda ligada a UN turno (Venta.turnoCajaId) — así Corte/Cierre pueden
 * resumir exactamente lo vendido en ese turno, sin mezclar con turnos
 * anteriores o de otro cajero.
 *
 * Corte (ver corte-turno.component.ts) usa el mismo resumen que Cierre
 * pero SIN pedir el conteo físico ni cambiar el estado — es solo una
 * fotografía de cómo va el turno, se puede seguir vendiendo después.
 */
export interface TurnoCaja {
  id: number;
  usuarioId: number;
  fechaApertura: string;
  montoApertura: number;
  notasApertura: string | null;
  fechaCierre: string | null;
  /** Efectivo contado físicamente al cierre — null mientras el turno sigue abierto. */
  montoCierreContado: number | null;
  /** montoApertura + efectivo vendido durante el turno (ver TurnoCajaService.resumen()). */
  montoCierreEsperado: number | null;
  /** montoCierreContado - montoCierreEsperado — positivo = sobrante, negativo = faltante. */
  diferenciaCierre: number | null;
  notasCierre: string | null;
  estado: EstadoTurnoCaja;
  activo: boolean;
}

/** Resumen de ventas de un turno (abierto o ya cerrado) — base para Corte,
 *  Cierre y el encabezado de Cobro ("Ventas de este turno: $X"). */
export interface ResumenTurno {
  turno: TurnoCaja;
  totalVentas: number;
  numeroVentas: number;
  totalPorMetodo: { metodoPago: string; total: number }[];
  /** Cuánto efectivo debería haber en el cajón ahora mismo: montoApertura +
   *  total cobrado en Efectivo (ya neto, sin contar el cambio entregado —
   *  ver venta.model.ts → VentaPago.monto). */
  efectivoEsperado: number;
}

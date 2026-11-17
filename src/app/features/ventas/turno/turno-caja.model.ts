export type EstadoTurnoCaja = 'Abierto' | 'Cerrado';

/**
 * Turno de caja — concepto interno que ya no tiene pantallas propias
 * (Mandato 86, Fase A: se eliminaron Apertura/Corte/Cierre de caja y el
 * conteo por denominación). Se conserva únicamente porque `Venta.turnoCajaId`
 * sigue siendo obligatorio en base de datos (ver turno-caja.service.ts):
 * `TurnoCajaService.turnoAbiertoOCrear()` abre uno en silencio, sin que el
 * usuario vea ni configure nada. La Fase B (pendiente de autorización
 * separada) propone volver nullable esta columna para retirar el concepto
 * por completo; mientras tanto, los turnos ya existentes en producción
 * (histórico, nunca se deben borrar) siguen siendo válidos.
 */
export interface TurnoCaja {
  id: number;
  usuarioId: number;
  fechaApertura: string;
  montoApertura: number;
  notasApertura: string | null;
  fechaCierre: string | null;
  montoCierreContado: number | null;
  montoCierreEsperado: number | null;
  diferenciaCierre: number | null;
  notasCierre: string | null;
  estado: EstadoTurnoCaja;
  activo: boolean;
}

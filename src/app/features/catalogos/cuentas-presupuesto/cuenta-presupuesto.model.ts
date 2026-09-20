export type TipoCuentaPresupuesto = 'Efectivo' | 'Banco' | 'Tarjeta' | 'Ahorro';

export interface CuentaPresupuesto {
  id: number;
  nombre: string;
  tipo: TipoCuentaPresupuesto;
  limiteCredito: number | null;
  diaCorte: number | null;
  diaPago: number | null;
  pagoMinimo: number | null;
  pagoSinIntereses: number | null;
  activo: boolean;
}

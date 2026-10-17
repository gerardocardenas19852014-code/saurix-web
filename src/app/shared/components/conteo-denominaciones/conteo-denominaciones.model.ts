export type TipoDenominacion = 'Billete' | 'Moneda';

/** Denominaciones de efectivo en México (MXN) — fijas, no son un catálogo
 *  editable (son las que emite el Banco de México, no algo que configure
 *  el usuario). */
export const DENOMINACIONES_MXN: { valor: number; tipo: TipoDenominacion }[] = [
  { valor: 1000, tipo: 'Billete' },
  { valor: 500, tipo: 'Billete' },
  { valor: 200, tipo: 'Billete' },
  { valor: 100, tipo: 'Billete' },
  { valor: 50, tipo: 'Billete' },
  { valor: 20, tipo: 'Billete' },
  { valor: 10, tipo: 'Moneda' },
  { valor: 5, tipo: 'Moneda' },
  { valor: 2, tipo: 'Moneda' },
  { valor: 1, tipo: 'Moneda' },
  { valor: 0.5, tipo: 'Moneda' },
];

export interface DenominacionCantidad {
  valor: number;
  cantidad: number;
}

export interface ConteoEfectivoResultado {
  total: number;
  /** Solo las denominaciones con cantidad > 0. */
  desglose: DenominacionCantidad[];
}

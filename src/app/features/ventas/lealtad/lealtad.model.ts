/**
 * Programa de lealtad/puntos — fila única (singleton), igual que
 * ConfiguracionVentas, pero propia de Ventas (no se pidió controlarla desde
 * Panel de Control). `programaActivo` apaga/enciende todo el programa de
 * un jalón (sin esto, ganar o canjear puntos sigue el mismo soft-delete
 * `activo` que todas las tablas, así que se necesita un nombre distinto).
 */
export interface ConfiguracionLealtad {
  id: number;
  programaActivo: boolean;
  /** Pesos vendidos (venta.total, neto) que equivalen a 1 punto ganado. */
  pesosPorPunto: number;
  /** Pesos de descuento que vale CADA punto al canjearlo en Cobro. */
  pesosDescuentoPorPunto: number;
  activo: boolean;
}

export type TipoMovimientoPuntos = 'Ganado' | 'Canjeado' | 'Reversado';

/** Bitácora de puntos — Cliente.puntosAcumulados es el saldo derivado de
 *  sumar estos movimientos, pero se guarda también en el Cliente (no se
 *  recalcula cada vez) para no tener que leer toda la bitácora en cada
 *  pantalla que solo necesita mostrar el saldo actual. */
export interface MovimientoPuntosCliente {
  id: number;
  clienteId: number;
  fecha: string;
  /** Positivo = ganados; negativo = canjeados o reversados. */
  puntos: number;
  tipo: TipoMovimientoPuntos;
  ventaId: number | null;
  activo: boolean;
}

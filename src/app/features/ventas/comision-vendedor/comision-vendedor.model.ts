export type TipoComisionVendedor = 'Porcentaje' | 'MontoFijo';

/**
 * Comisión configurada para un vendedor (Usuario) — 1 fila por usuarioId
 * (singleton por vendedor, mismo criterio que ConfiguracionApariencia pero
 * sin exponerse como "configuración personal": solo un admin la edita, ver
 * ComisionesVendedoresComponent). Sin fila = 0% / sin comisión.
 *
 *  - 'Porcentaje': valor% sobre el total neto vendido (ventas Completadas
 *    del periodo, menos lo devuelto — ver ReporteComisionesComponent).
 *  - 'MontoFijo': valor pesos por cada venta Completada del periodo
 *    (no se prorratea por devoluciones parciales, solo cuenta la venta
 *    completa una vez).
 */
export interface ComisionVendedor {
  id: number;
  usuarioId: number;
  tipo: TipoComisionVendedor;
  valor: number;
  activo: boolean;
}

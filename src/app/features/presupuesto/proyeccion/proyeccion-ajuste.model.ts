/**
 * Un valor capturado a mano por el usuario en la pantalla "Proyección",
 * que sobreescribe (para esa quincena + ese renglón) el monto que se
 * calcularía automáticamente a partir de Fijos y Movimientos. Se guarda
 * solo el "parche": si se borra este registro, la celda vuelve a
 * mostrar el valor automático.
 *
 * `clave` identifica el renglón dentro de la tabla:
 *  - "saldoInicial"        → el Saldo inicial de la primera quincena mostrada.
 *  - "cat:<categoriaId>"   → un renglón de Ingreso o Gasto (por Categoría).
 *  - "cta:<cuentaId>"      → un renglón de Ahorros (por Cuenta, tipo Ahorro).
 *
 * `quincena` identifica la columna: "<año>-<mes 0-indexado>-<mitad 1|2>",
 * p.ej. "2026-8-2" = segunda quincena de septiembre de 2026.
 */
export interface ProyeccionAjuste {
  id: number;
  quincena: string;
  clave: string;
  monto: number;
  creadoPorUsuarioId: number;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

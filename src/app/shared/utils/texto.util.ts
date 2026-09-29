/**
 * Recorta un texto largo a `maximo` caracteres agregando "…" al final,
 * para usarse junto con `ColumnaTabla.titulo` (tooltip con el texto
 * completo) en columnas de <app-data-table> — mismo criterio ya usado a
 * mano para el nombre de Sprint en Kanban (`nombreSprintCorto`), pero
 * genérico para cualquier columna de texto libre (títulos de ticket,
 * descripciones, etc.) que de otra forma estira el renglón completo y
 * empuja/tapa los botones de Acciones.
 */
export function truncarTexto(texto: string, maximo = 70): string {
  const limpio = (texto ?? '').trim();
  if (limpio.length <= maximo) return limpio;
  return `${limpio.slice(0, maximo).trimEnd()}…`;
}

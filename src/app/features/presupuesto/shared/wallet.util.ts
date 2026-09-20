/**
 * Utilidades compartidas por las pantallas de Presupuesto (estilo wallet
 * app del prototipo). Los catálogos CategoriaPresupuesto/CuentaPresupuesto
 * (módulo Catálogos) no tienen campo `color`, así que el color del punto
 * de categoría se deriva de forma determinista de su id, ciclando sobre
 * la paleta de acento ya definida en styles.scss.
 */
const PALETA_CATEGORIAS = [
  'var(--client)',
  'var(--danger)',
  'var(--amber)',
  'var(--indigo)',
  'var(--teal)',
  'var(--technical)',
];

export function colorCategoria(id: number | null | undefined): string {
  if (!id) return 'var(--technical)';
  return PALETA_CATEGORIAS[id % PALETA_CATEGORIAS.length];
}

const ICONOS_TIPO_CUENTA: Record<string, string> = {
  Efectivo: '💵',
  Banco: '🏦',
  Tarjeta: '💳',
  Ahorro: '🐷',
};

export function iconoTipoCuenta(tipo: string): string {
  return ICONOS_TIPO_CUENTA[tipo] ?? '💰';
}

export function formatMoneda(valor: number): string {
  const signo = valor < 0 ? '-$' : '$';
  return signo + Math.abs(valor).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Nivel de uso (ok/warn/over) para pintar una barra de límite/progreso. */
export function nivelUso(pctReal: number): 'ok' | 'warn' | 'over' {
  if (pctReal >= 100) return 'over';
  if (pctReal >= 70) return 'warn';
  return 'ok';
}

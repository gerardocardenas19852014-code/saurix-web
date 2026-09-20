export interface ColumnaCsv<T> {
  clave: keyof T;
  etiqueta: string;
}

/**
 * Exporta cualquier listado a CSV (mismo comportamiento que el prototipo
 * original): separa por coma, escapa comillas/comas/saltos de línea y
 * antepone BOM para que Excel abra los acentos correctamente. Pensado para
 * reutilizarse desde cualquier pantalla de listado, no solo Usuarios.
 */
export function exportarCsv<T extends Record<string, unknown>>(
  nombreArchivo: string,
  columnas: ColumnaCsv<T>[],
  filas: T[],
): void {
  const escapar = (valor: unknown): string => {
    const texto = valor === null || valor === undefined ? '' : String(valor);
    return /[",\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };

  const lineas = [
    columnas.map((c) => escapar(c.etiqueta)).join(','),
    ...filas.map((fila) => columnas.map((c) => escapar(fila[c.clave])).join(',')),
  ];

  const contenido = '﻿' + lineas.join('\r\n');
  const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

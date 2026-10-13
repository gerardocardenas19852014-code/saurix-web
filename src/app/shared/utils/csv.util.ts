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

/**
 * Parsea un CSV (separado por coma, comillas dobles para campos con coma o
 * salto de línea, BOM opcional al inicio) a un arreglo de arreglos de texto
 * — la fila 0 son los encabezados tal cual vienen en el archivo. No asume
 * nada sobre las columnas; quien llama decide cómo mapearlas a un modelo.
 * Pensado para leer de vuelta un archivo generado por `exportarCsv()` (o
 * exportado desde Excel/Google Sheets), para la importación masiva de
 * Productos (ver productos.component.ts).
 */
export function parsearCsv(texto: string): string[][] {
  const limpio = texto.replace(/^\uFEFF/, ''); // quita el BOM si viene
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let entreComillas = false;

  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (entreComillas) {
      if (c === '"') {
        if (limpio[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          entreComillas = false;
        }
      } else {
        campo += c;
      }
      continue;
    }
    if (c === '"') {
      entreComillas = true;
      continue;
    }
    if (c === ',') {
      fila.push(campo);
      campo = '';
      continue;
    }
    if (c === '\r') continue;
    if (c === '\n') {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = '';
      continue;
    }
    campo += c;
  }
  // Última fila/campo si el archivo no termina con salto de línea.
  if (campo.length > 0 || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }

  // Descarta renglones totalmente vacíos (líneas en blanco al final del archivo).
  return filas.filter((f) => f.some((v) => v.trim() !== ''));
}

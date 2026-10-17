import { jsPDF } from 'jspdf';

export interface ColumnaPdf {
  etiqueta: string;
  /** Ancho en mm — si se omite, se reparte el espacio restante entre las
   *  columnas sin ancho fijo a partes iguales. */
  ancho?: number;
}

/**
 * Exporta un listado tabular a PDF imprimible — mismo espíritu que
 * exportarCsv() de csv.util.ts, pero para un reporte con encabezado,
 * título y paginación en vez de un archivo para abrir en Excel. No hay
 * ningún plugin de tablas instalado (ver package.json: solo `jspdf` +
 * `html2canvas`, usados en otros módulos para cosas más visuales como una
 * credencial o un documento con formato enriquecido — ver
 * miembros.component.ts/documentos-list.component.ts), así que aquí se
 * dibuja texto plano con jsPDF y se pagina a mano comparando contra el
 * alto de la página — suficiente para un reporte tabular simple de una
 * sola línea por fila (celdas más largas se truncan, no se envuelven, para
 * no complicar la paginación con alturas de fila variables).
 */
export function exportarTablaPdf(opts: {
  nombreArchivo: string;
  titulo: string;
  subtitulo?: string;
  columnas: ColumnaPdf[];
  filas: string[][];
}): void {
  const { nombreArchivo, titulo, subtitulo, columnas, filas } = opts;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' });
  const margenX = 14;
  const anchoUtil = doc.internal.pageSize.getWidth() - margenX * 2;
  const altoPagina = doc.internal.pageSize.getHeight();

  const anchoFijo = columnas.reduce((acc, c) => acc + (c.ancho ?? 0), 0);
  const columnasSinAncho = columnas.filter((c) => !c.ancho).length;
  const anchoAuto = columnasSinAncho > 0 ? (anchoUtil - anchoFijo) / columnasSinAncho : 0;
  const anchos = columnas.map((c) => c.ancho ?? anchoAuto);

  let y = 16;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(titulo, margenX, y);
  y += 6;

  if (subtitulo) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(110);
    doc.text(subtitulo, margenX, y);
    doc.setTextColor(0);
    y += 6;
  }

  y += 3;

  const dibujarEncabezado = (): void => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    let x = margenX;
    columnas.forEach((c, i) => {
      doc.text(c.etiqueta, x, y);
      x += anchos[i];
    });
    y += 2;
    doc.setLineWidth(0.2);
    doc.line(margenX, y, margenX + anchoUtil, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
  };

  dibujarEncabezado();

  for (const fila of filas) {
    if (y > altoPagina - 16) {
      doc.addPage();
      y = 16;
      dibujarEncabezado();
    }
    let x = margenX;
    fila.forEach((valor, i) => {
      const texto = doc.splitTextToSize(valor ?? '', Math.max(anchos[i] - 2, 5));
      doc.text(texto[0] ?? '', x, y); // solo la primera línea — ver comentario de arriba
      x += anchos[i];
    });
    y += 6;
  }

  if (filas.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(140);
    doc.text('Sin datos para mostrar.', margenX, y);
  }

  doc.save(nombreArchivo);
}

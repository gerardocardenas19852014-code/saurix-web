export interface ItemTablaContenido {
  id: string;
  texto: string;
  nivel: 1 | 2 | 3;
}

export interface ResultadoTablaContenido {
  html: string;
  items: ItemTablaContenido[];
}

/**
 * Recorre los encabezados h1/h2/h3 del HTML ya renderizado de un documento
 * y les asigna un id secuencial (el editor Quill no les pone uno) para
 * poder generar un índice de contenido navegable en la vista "Ver". Se
 * calcula solo al mostrar el documento — nunca se guarda en el contenido
 * real, así que no afecta documentos ya existentes ni el editor.
 */
export function generarTablaContenido(html: string): ResultadoTablaContenido {
  if (!html || !html.trim()) return { html, items: [] };

  const parser = new DOMParser();
  const documento = parser.parseFromString(html, 'text/html');
  const encabezados = Array.from(documento.querySelectorAll('h1, h2, h3'));

  const items: ItemTablaContenido[] = encabezados.map((encabezado, indice) => {
    const id = `doc-heading-${indice}`;
    encabezado.id = id;
    const nivel = Number(encabezado.tagName.substring(1)) as 1 | 2 | 3;
    return { id, texto: encabezado.textContent?.trim() || `Sección ${indice + 1}`, nivel };
  });

  return { html: documento.body.innerHTML, items };
}

export interface ItemTablaContenido {
  id: string;
  texto: string;
  nivel: 1 | 2 | 3 | 4 | 5 | 6;
}

export interface ResultadoTablaContenido {
  html: string;
  items: ItemTablaContenido[];
}

/** Reduce el texto de un encabezado a algo seguro para usar dentro de un
 *  id de elemento HTML (se concatena con el índice de todas formas, así
 *  que no necesita ser único por sí solo — solo evita ids con espacios,
 *  acentos o símbolos que compliquen `document.getElementById`/`#fragmento`
 *  en los enlaces del editor, ver onClickContenido). Vacío-seguro: un
 *  encabezado sin texto (solo una imagen, por ejemplo) no rompe nada. */
function slugEncabezado(texto: string): string {
  const normalizado = texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita acentos/diacríticos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalizado.slice(0, 40);
}

/**
 * Recorre los encabezados h1-h6 del HTML ya renderizado de un documento y
 * les asigna un id (el editor Quill no les pone uno) para poder generar un
 * índice de contenido navegable en la vista "Ver". Se calcula solo al
 * mostrar el documento — nunca se guarda en el contenido real, así que no
 * afecta documentos ya existentes ni el editor.
 *
 * Mandato 90 (nov-2026, "WikiDocs — etiquetas y duplicación de
 * documentos") §7: se extiende de h1-h3 a h1-h6 (documentos largos sí usan
 * niveles más profundos), y el id deja de ser puramente secuencial
 * (`doc-heading-N`) — ahora incluye un slug del propio texto del
 * encabezado (`doc-heading-N-slug`) para que un enlace copiado
 * (`#doc-heading-3-instalacion`) siga siendo legible aunque se reordenen o
 * agreguen encabezados antes; el índice numérico sigue yendo primero y
 * sigue siendo la garantía real de unicidad/anti-colisión (dos encabezados
 * con el mismo texto — o sin texto — nunca colisionan), el slug es solo un
 * plus de legibilidad, nunca la clave.
 */
export function generarTablaContenido(html: string): ResultadoTablaContenido {
  if (!html || !html.trim()) return { html, items: [] };

  const parser = new DOMParser();
  const documento = parser.parseFromString(html, 'text/html');
  const encabezados = Array.from(documento.querySelectorAll('h1, h2, h3, h4, h5, h6'));

  const items: ItemTablaContenido[] = encabezados.map((encabezado, indice) => {
    const texto = encabezado.textContent?.trim() || `Sección ${indice + 1}`;
    const slug = slugEncabezado(texto);
    const id = slug ? `doc-heading-${indice}-${slug}` : `doc-heading-${indice}`;
    encabezado.id = id;
    const nivel = Number(encabezado.tagName.substring(1)) as 1 | 2 | 3 | 4 | 5 | 6;
    return { id, texto, nivel };
  });

  return { html: documento.body.innerHTML, items };
}

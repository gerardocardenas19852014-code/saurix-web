/**
 * Cálculo puro de distribución de etiquetas sobre el papel elegido —
 * SAURIX: Optimización de impresión de etiquetas (nov-2026). Sin DOM, sin
 * Angular: una sola función que tanto la vista previa como la impresión
 * real llaman IGUAL, para que nunca puedan mostrar números distintos (es
 * un requisito explícito del mandato, sección 5: "La distribución de la
 * vista previa debe provenir del mismo cálculo utilizado para imprimir").
 *
 * Unidades: todo en milímetros. "Rollo continuo" (papelAltoMm === null,
 * pensado para rollos térmicos) nunca asume una longitud fija: calcula la
 * altura EXACTA que ocupan todas las etiquetas pedidas, así el @page que
 * lo use mide justo lo necesario, ni un milímetro de rollo de más (sección
 * 1.A / sección 7 del mandato).
 */

export type FormatoPapel = 'carta' | 'a4' | 'termico80' | 'termico58' | 'personalizado';
export type TamanoEtiquetaPreset = 'pequena' | 'mediana' | 'grande' | 'personalizada';
export type ColumnasModo = 'auto' | '1' | '2' | '3' | '4';

/** Dimensiones reales de papel (mm) — Carta con sus medidas físicas reales
 *  (215.9 × 279.4mm, no el redondeo "216 × 279" que a veces se usa), A4
 *  con sus medidas ISO 216. Los rollos térmicos solo fijan el ANCHO (el
 *  alto es `null` = continuo, se calcula — ver calcularDistribucion()). */
export const PAPEL_MM: Record<Exclude<FormatoPapel, 'personalizado'>, { ancho: number; alto: number | null }> = {
  carta: { ancho: 215.9, alto: 279.4 },
  a4: { ancho: 210, alto: 297 },
  termico80: { ancho: 80, alto: null },
  termico58: { ancho: 58, alto: null },
};

export const ETIQUETA_MM: Record<Exclude<TamanoEtiquetaPreset, 'personalizada'>, { ancho: number; alto: number }> = {
  pequena: { ancho: 38, alto: 25 },
  mediana: { ancho: 50, alto: 35 },
  grande: { ancho: 70, alto: 45 },
};

/** Margen interno y separación entre etiquetas — constantes de ingeniería,
 *  NO controles de usuario (el documento solo lista papel / tamaño /
 *  tipo de código / distribución / cantidad como opciones de la ventana
 *  de configuración — sección 2, A-E). Los rollos térmicos usan un margen
 *  más chico porque las impresoras de etiquetas normalmente imprimen casi
 *  hasta el borde; Carta/A4/personalizado usan un margen de impresora
 *  convencional, más conservador. */
export function margenMmPara(papel: FormatoPapel): number {
  return papel === 'termico80' || papel === 'termico58' ? 2 : 5;
}
export const SEPARACION_MM = 3;

export interface ResultadoDistribucion {
  /** Columnas reales que se van a usar (ya ajustadas a lo que cabe). */
  columnas: number;
  /** Filas que caben en UNA hoja (o, en rollo continuo, el total de filas
   *  necesarias para todas las etiquetas -- ahí "una hoja" ES todo el
   *  rollo, calculado a la medida). */
  filasPorPagina: number;
  etiquetasPorPagina: number;
  /** Hojas estimadas -- 1 siempre en modo rollo continuo (una sola tira). */
  paginas: number;
  anchoImprimibleMm: number;
  /** Alto imprimible de UNA hoja; en rollo continuo, el alto TOTAL que se
   *  le va a pedir a esa única "hoja" (@page) -- ver imprimir() del
   *  componente de configuración. */
  altoImprimibleMm: number;
  /** null = sin problema. Si no es null, ya se ajustó algo automáticamente
   *  (columnas topadas a lo que sí cabe) o la combinación es inválida
   *  (columnas o filas en 0 -- no cabe ni una etiqueta). */
  advertencia: string | null;
}

export function calcularDistribucion(params: {
  papelAnchoMm: number;
  /** null = papel continuo (rollo térmico): el alto se calcula, nunca se asume. */
  papelAltoMm: number | null;
  margenMm: number;
  etiquetaAnchoMm: number;
  etiquetaAltoMm: number;
  separacionMm: number;
  columnasModo: ColumnasModo;
  totalEtiquetas: number;
}): ResultadoDistribucion {
  const { papelAnchoMm, papelAltoMm, margenMm, etiquetaAnchoMm, etiquetaAltoMm, separacionMm, columnasModo, totalEtiquetas } = params;

  const anchoImprimibleMm = Math.max(0, papelAnchoMm - 2 * margenMm);
  // Fórmula estándar de "cuántas cajas de ancho E con separación S entran
  // en un espacio A": floor((A + S) / (E + S)) -- el "+S" compensa que N
  // etiquetas solo necesitan (N-1) separaciones, no N.
  const columnasQueCaben =
    etiquetaAnchoMm > 0 ? Math.max(0, Math.floor((anchoImprimibleMm + separacionMm) / (etiquetaAnchoMm + separacionMm))) : 0;

  if (columnasQueCaben === 0) {
    return {
      columnas: 0,
      filasPorPagina: 0,
      etiquetasPorPagina: 0,
      paginas: 0,
      anchoImprimibleMm,
      altoImprimibleMm: 0,
      advertencia: 'La etiqueta elegida no cabe en el ancho de este papel. Usa una etiqueta más chica o un papel más ancho.',
    };
  }

  let advertencia: string | null = null;
  let columnas: number;
  if (columnasModo === 'auto') {
    columnas = columnasQueCaben;
  } else {
    const pedidas = Number(columnasModo);
    columnas = Math.min(pedidas, columnasQueCaben);
    if (pedidas > columnasQueCaben) {
      advertencia = `Con este papel y este tamaño de etiqueta solo caben ${columnasQueCaben} columna${columnasQueCaben === 1 ? '' : 's'} -- se ajustó automáticamente para que no se corten.`;
    }
  }

  if (papelAltoMm === null) {
    // Rollo continuo: nunca se asume una longitud fija -- se calcula
    // exactamente lo que ocupan todas las etiquetas pedidas, en las
    // columnas ya decididas arriba.
    const filasNecesarias = columnas > 0 ? Math.ceil(totalEtiquetas / columnas) : 0;
    const altoImprimibleMm = filasNecesarias > 0 ? filasNecesarias * etiquetaAltoMm + (filasNecesarias - 1) * separacionMm : 0;
    return {
      columnas,
      filasPorPagina: filasNecesarias,
      etiquetasPorPagina: totalEtiquetas,
      paginas: totalEtiquetas > 0 ? 1 : 0,
      anchoImprimibleMm,
      altoImprimibleMm,
      advertencia,
    };
  }

  const altoImprimibleDisponibleMm = Math.max(0, papelAltoMm - 2 * margenMm);
  const filasPorPagina =
    etiquetaAltoMm > 0 ? Math.max(0, Math.floor((altoImprimibleDisponibleMm + separacionMm) / (etiquetaAltoMm + separacionMm))) : 0;
  if (filasPorPagina === 0) {
    return {
      columnas,
      filasPorPagina: 0,
      etiquetasPorPagina: 0,
      paginas: 0,
      anchoImprimibleMm,
      altoImprimibleMm: altoImprimibleDisponibleMm,
      advertencia: 'La etiqueta elegida no cabe en el alto de este papel. Usa una etiqueta más chica o un papel más alto.',
    };
  }

  const etiquetasPorPagina = columnas * filasPorPagina;
  const paginas = etiquetasPorPagina > 0 ? Math.ceil(totalEtiquetas / etiquetasPorPagina) : 0;
  return {
    columnas,
    filasPorPagina,
    etiquetasPorPagina,
    paginas,
    anchoImprimibleMm,
    altoImprimibleMm: altoImprimibleDisponibleMm,
    advertencia,
  };
}

/**
 * Tipografía/medidas internas de UNA etiqueta -- función pura, SIN DOM,
 * que tanto la vista previa en pantalla (ConfiguracionImpresionEtiquetasComponent,
 * bindings de la muestra) como la impresión real (mismo componente,
 * imprimir()) deben llamar IGUAL, por la misma razón que calcularDistribucion():
 * nunca dos cálculos independientes que puedan dar resultados distintos
 * (sección 4 / sección 5 del mandato de corrección, nov-2026).
 *
 * ALTO_BASE_MM (35mm) es la altura de la etiqueta "Mediana", que es el
 * tamaño sobre el que ya estaban calibrados los tamaños de fuente
 * históricos (9px nombre / 7px sku / 11px precio) -- se preserva ese
 * calibre para Mediana (escala 1) y se escala proporcionalmente para
 * Pequeña/Grande/Personalizada, con piso y techo para no volverse
 * ilegible ni desproporcionado.
 */
const ALTO_BASE_TIPOGRAFIA_MM = 35;

export interface TipografiaEtiqueta {
  nombrePx: number;
  skuPx: number;
  precioPx: number;
  /** % del alto de la etiqueta que ocupa el área del código (QR o barras) --
   *  mismo criterio para vista previa e impresión real. */
  codigoAltoPct: number;
}

export function calcularTipografia(etiquetaAltoMm: number): TipografiaEtiqueta {
  const escala = etiquetaAltoMm > 0 ? Math.min(1.5, Math.max(0.65, etiquetaAltoMm / ALTO_BASE_TIPOGRAFIA_MM)) : 1;
  return {
    nombrePx: Math.max(7, Math.round(9 * escala)),
    skuPx: Math.max(6, Math.round(7 * escala)),
    precioPx: Math.max(8, Math.round(11 * escala)),
    codigoAltoPct: 55,
  };
}

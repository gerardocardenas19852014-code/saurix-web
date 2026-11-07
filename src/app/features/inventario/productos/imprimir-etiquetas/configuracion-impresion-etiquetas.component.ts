import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, computed, effect, inject, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ToastService } from '../../../../shared/services/toast.service';
import { formatMoneda } from '../producto.util';
import {
  ColumnasModo,
  ETIQUETA_MM,
  FormatoPapel as TipoPapel,
  PAPEL_MM,
  ResultadoDistribucion,
  SEPARACION_MM,
  TamanoEtiquetaPreset,
  calcularDistribucion,
  margenMmPara,
} from './distribucion-etiquetas.util';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';

/** Formato del código a imprimir -- 'barras' es el comportamiento histórico
 *  (default, se conserva). Vivía en imprimir-etiquetas.component.ts; se
 *  movió aquí porque desde la homologación de nov-2026 ("Optimización de
 *  impresión de etiquetas") el tipo de código es una opción MÁS de esta
 *  ventana de configuración (sección 2.C del mandato), junto con papel,
 *  tamaño, distribución e información a mostrar -- ya no vive aparte en
 *  la pantalla de selección. */
export type FormatoEtiqueta = 'barras' | 'qr';

/** Un producto ya resuelto (con código garantizado) y con sus copias ya
 *  decididas en la pantalla de selección -- ImprimirEtiquetasComponent
 *  arma esta lista UNA vez, al confirmar, y esta ventana ya no vuelve a
 *  tocar selección/copias (sección "No duplicar... cantidad de etiquetas"
 *  del mandato: ya se decidió en el paso anterior, aquí solo se muestra el
 *  total y se ofrece volver a ajustarlo). */
export interface ProductoParaImprimir {
  id: number;
  codigo: string;
  nombre: string;
  precioUnitario: number;
  copias: number;
}

/** Code128 (modo automático de JsBarcode) soporta el rango ASCII
 *  imprimible completo (0x20-0x7E) -- cualquier código con un caracter
 *  fuera de ese rango (acentos, símbolos no ASCII, etc.) no es un SKU
 *  válido para código de barras. Se valida ANTES de imprimir para nunca
 *  generar una etiqueta en blanco o rota (sección 2.C del mandato: "si
 *  algún SKU no es válido para el formato elegido, mostrar el problema y
 *  ofrecer una alternativa, sin generar etiquetas incorrectas"). */
const PATRON_CODE128_VALIDO = /^[\x20-\x7E]+$/;

/** Cuántas etiquetas reales se renderizan en la vista previa -- nunca el
 *  lote completo (podrían ser hasta 1000, ver TOPE_ETIQUETAS_IMPRESION en
 *  el componente padre). Alcanza para que el usuario vea cómo se ve
 *  antes de imprimir; el resto solo se cuenta en el resumen numérico
 *  (sección 4 del mandato: "puede mostrar una muestra representativa"). */
const TOPE_MUESTRA_PREVIA = 12;
/** Tope de columnas de la CUADRÍCULA VISUAL de la muestra en pantalla --
 *  nunca de la impresión real. La impresión puede necesitar 5+ columnas
 *  (p.ej. Carta + etiqueta Pequeña), pero el panel de vista previa mide
 *  como máximo ~360-500px: forzar ese mismo número de columnas ahí (y
 *  sobre todo en celular, donde el panel ocupa ~300px de ancho) deja cada
 *  tarjeta de muestra de ~50-70px, ilegible (hallazgo confirmado en la
 *  revisión de Fase 2, "Prompt maestro" nov-2026, punto 3 "distribución en
 *  celular"/"espacios vacíos"). El número REAL de columnas de impresión
 *  sigue intacto en distribucion().columnas y en el resumen de texto ("N
 *  columnas × M filas") -- esto SOLO topa cómo se acomoda la muestra
 *  visual, nunca lo que se manda a imprimir (columnasGrid() no se usa en
 *  ningún otro lado -- ver imprimir() más abajo). */
const TOPE_COLUMNAS_PREVIEW = 3;

/**
 * Ventana de configuración de impresión de etiquetas -- SAURIX,
 * homologación "Optimización de impresión de etiquetas" (nov-2026, ver
 * claude/productos-imprimir-etiquetas-optimizacion-2026-11.md para el
 * reporte completo). Paso intermedio entre la selección de productos
 * (ImprimirEtiquetasComponent, el padre) y la impresión real del
 * navegador: aquí se elige papel, tamaño de etiqueta, tipo de código
 * (barras/QR), distribución en columnas e información a mostrar, con
 * vista previa en vivo, ANTES de generar el documento a imprimir.
 *
 * Reutiliza tal cual (sin modificar su comportamiento) la infraestructura
 * histórica de generación de código que antes vivía en
 * ImprimirEtiquetasComponent: dibujarCodigoBarras()/generarSvgQr() (SVG
 * por código único, nunca por copia), el mecanismo de iframe oculto +
 * doc.write() + print() (no window.open(), no pestaña nueva), y
 * formatMoneda(). Lo nuevo de esta ronda: el cálculo de distribución
 * (ver distribucion-etiquetas.util.ts, compartido con la vista previa), el
 * CSS de impresión real parametrizado (@page, CSS Grid con columnas
 * calculadas, break-inside:avoid), y los interruptores de
 * nombre/SKU/precio.
 *
 * Nunca toca Supabase, Kardex, Movimientos entre bodegas ni el Importador
 * CSV -- esta pantalla solo lee los productos que ya le pasó el padre
 * (@Input productos, ya resueltos) y genera un documento HTML para
 * imprimir en el navegador.
 */
@Component({
  selector: 'app-configuracion-impresion-etiquetas',
  standalone: true,
  imports: [],
  templateUrl: './configuracion-impresion-etiquetas.component.html',
  styleUrl: './configuracion-impresion-etiquetas.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfiguracionImpresionEtiquetasComponent {
  @Input({ required: true }) productos: ProductoParaImprimir[] = [];
  /** Volver a la pantalla de selección (p.ej. para ajustar cantidades) --
   *  no imprime nada, el padre solo oculta esta ventana. */
  @Output() readonly volver = new EventEmitter<void>();
  /** Impresión enviada con éxito -- el padre cierra todo el flujo. */
  @Output() readonly cerrar = new EventEmitter<void>();

  protected readonly toast = inject(ToastService);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly formatMoneda = formatMoneda;
  protected readonly opcionesColumnas: ColumnasModo[] = ['1', '2', '3', '4'];

  protected readonly totalEtiquetas = computed(() => this.productos.reduce((acc, p) => acc + p.copias, 0));

  // ── A. Papel ─────────────────────────────────────────────────────────────
  protected readonly papel = signal<TipoPapel>('carta');
  protected readonly papelAnchoPersonalizado = signal('100');
  protected readonly papelAltoPersonalizado = signal('150');

  protected readonly papelMmActual = computed<{ ancho: number; alto: number | null }>(() => {
    const p = this.papel();
    if (p === 'personalizado') {
      return { ancho: Number(this.papelAnchoPersonalizado()) || 0, alto: Number(this.papelAltoPersonalizado()) || 0 };
    }
    return PAPEL_MM[p];
  });

  // ── B. Tamaño de etiqueta ────────────────────────────────────────────────
  protected readonly tamanoEtiqueta = signal<TamanoEtiquetaPreset>('mediana');
  protected readonly etiquetaAnchoPersonalizado = signal('50');
  protected readonly etiquetaAltoPersonalizado = signal('35');

  protected readonly etiquetaMmActual = computed<{ ancho: number; alto: number }>(() => {
    const t = this.tamanoEtiqueta();
    if (t === 'personalizada') {
      return { ancho: Number(this.etiquetaAnchoPersonalizado()) || 0, alto: Number(this.etiquetaAltoPersonalizado()) || 0 };
    }
    return ETIQUETA_MM[t];
  });

  // ── C. Tipo de código ────────────────────────────────────────────────────
  protected readonly formato = signal<FormatoEtiqueta>('barras');

  /** Códigos (sin duplicados) que no se pueden dibujar como Code128 --
   *  vacío si el formato elegido es QR (QR acepta cualquier texto). */
  protected readonly codigosInvalidosParaBarras = computed<string[]>(() => {
    if (this.formato() !== 'barras') return [];
    const unicos = new Set<string>();
    for (const p of this.productos) {
      if (!PATRON_CODE128_VALIDO.test(p.codigo)) unicos.add(p.codigo);
    }
    return Array.from(unicos);
  });

  usarQrParaTodos(): void {
    this.formato.set('qr');
    this.toast.info('Cambiado a código QR para toda esta impresión.');
  }

  // ── D. Distribución (columnas) ───────────────────────────────────────────
  protected readonly columnasModo = signal<ColumnasModo>('auto');

  // ── Información en la etiqueta ───────────────────────────────────────────
  protected readonly mostrarNombre = signal(true);
  protected readonly mostrarSku = signal(true);
  protected readonly mostrarPrecio = signal(true);

  // ── Cálculo de distribución (MISMO cálculo que usa la impresión real) ───
  protected readonly margenMm = computed(() => margenMmPara(this.papel()));

  protected readonly distribucion = computed<ResultadoDistribucion>(() =>
    calcularDistribucion({
      papelAnchoMm: this.papelMmActual().ancho,
      papelAltoMm: this.papelMmActual().alto,
      margenMm: this.margenMm(),
      etiquetaAnchoMm: this.etiquetaMmActual().ancho,
      etiquetaAltoMm: this.etiquetaMmActual().alto,
      separacionMm: SEPARACION_MM,
      columnasModo: this.columnasModo(),
      totalEtiquetas: this.totalEtiquetas(),
    }),
  );

  protected columnasGrid(): number {
    return Math.max(1, Math.min(this.distribucion().columnas, TOPE_COLUMNAS_PREVIEW));
  }

  // ── Vista previa (muestra limitada -- ver TOPE_MUESTRA_PREVIA) ───────────
  protected readonly muestraPreview = computed<ProductoParaImprimir[]>(() => this.productos.slice(0, TOPE_MUESTRA_PREVIA));

  protected readonly svgPorCodigo = signal<Map<string, SafeHtml>>(new Map());
  private secuenciaPreview = 0;

  constructor() {
    // Misma técnica que la vista previa histórica de ImprimirEtiquetasComponent
    // (secuencia de vigencia para descartar una respuesta vieja), pero ahora
    // sobre un lote chico de productos (la muestra) en vez de uno solo --
    // el QR es async (librería `qrcode`), el código de barras es síncrono.
    effect(() => {
      const muestra = this.muestraPreview();
      const formato = this.formato();
      const miSecuencia = ++this.secuenciaPreview;
      const codigosUnicos = Array.from(new Set(muestra.map((p) => p.codigo)));
      if (codigosUnicos.length === 0) {
        this.svgPorCodigo.set(new Map());
        return;
      }
      Promise.all(codigosUnicos.map(async (codigo) => [codigo, await this.generarSvg(codigo, formato)] as const))
        .then((pares) => {
          if (miSecuencia !== this.secuenciaPreview) return; // vista previa vieja, se descarta
          const mapa = new Map<string, SafeHtml>();
          for (const [codigo, svg] of pares) mapa.set(codigo, this.sanitizer.bypassSecurityTrustHtml(svg));
          this.svgPorCodigo.set(mapa);
        })
        .catch((error) => {
          if (miSecuencia !== this.secuenciaPreview) return;
          console.error('No se pudo generar la vista previa de etiquetas:', error);
          this.svgPorCodigo.set(new Map());
        });
    });
  }

  // ── Generación del código (barras/QR) -- MISMO mecanismo histórico, sin
  // cambios de comportamiento (ver comentario de clase). ──────────────────
  private dibujarCodigoBarras(codigo: string): string {
    const dibujar: typeof JsBarcode =
      typeof JsBarcode === 'function' ? JsBarcode : (window as unknown as { JsBarcode?: typeof JsBarcode }).JsBarcode!;
    if (typeof dibujar !== 'function') {
      throw new Error('No se pudo cargar el generador de códigos de barras (JsBarcode).');
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    dibujar(svg, codigo, { format: 'CODE128', width: 1.6, height: 42, displayValue: false, margin: 0 });
    return new XMLSerializer().serializeToString(svg);
  }

  private async generarSvgQr(codigo: string): Promise<string> {
    return QRCode.toString(codigo, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  }

  private async generarSvg(codigo: string, formato: FormatoEtiqueta): Promise<string> {
    return formato === 'qr' ? this.generarSvgQr(codigo) : this.dibujarCodigoBarras(codigo);
  }

  private escaparHtml(texto: string): string {
    const div = document.createElement('div');
    div.textContent = texto;
    return div.innerHTML;
  }

  // ── Impresión real ───────────────────────────────────────────────────────
  protected readonly imprimiendo = signal(false);

  async imprimirAhora(): Promise<void> {
    if (this.imprimiendo()) return; // doble clic.
    const d = this.distribucion();
    if (d.columnas === 0 || (d.etiquetasPorPagina === 0 && this.totalEtiquetas() > 0)) {
      this.toast.error(d.advertencia ?? 'Esta combinación de papel y tamaño de etiqueta no es válida.');
      return;
    }
    if (this.formato() === 'barras' && this.codigosInvalidosParaBarras().length > 0) {
      this.toast.error('Hay códigos que no se pueden imprimir como código de barras. Cambia a código QR o corrige esos códigos.');
      return;
    }

    this.imprimiendo.set(true);
    try {
      await this.imprimir();
      const total = this.totalEtiquetas();
      this.toast.exito(`${total} etiqueta${total === 1 ? '' : 's'} enviada${total === 1 ? '' : 's'} a imprimir.`);
      this.cerrar.emit();
    } catch {
      // imprimir() ya avisó el motivo específico por toast.
    } finally {
      this.imprimiendo.set(false);
    }
  }

  /** Genera el documento a imprimir con el papel/tamaño/distribución/
   *  información elegidos y lo envía al diálogo de impresión del
   *  navegador -- mismo mecanismo histórico (iframe oculto, nunca
   *  window.open() ni una pestaña nueva), con el CSS de impresión real
   *  parametrizado: @page con el tamaño de papel exacto (para rollo
   *  continuo, el alto calculado -- nunca una longitud fija asumida),
   *  CSS Grid con las columnas ya calculadas, y break-inside:avoid para
   *  que una etiqueta nunca se corte entre hojas. */
  private async imprimir(): Promise<void> {
    const formato = this.formato();
    const d = this.distribucion();
    const papelMm = this.papelMmActual();
    const etiquetaMm = this.etiquetaMmActual();
    const margen = this.margenMm();
    // Rollo continuo: el alto de @page es justo el calculado (contenido +
    // márgenes) -- nunca se asume una longitud de rollo fija (sección 7).
    const altoPaginaMm = papelMm.alto ?? d.altoImprimibleMm + 2 * margen;

    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.position = 'fixed';
    iframe.style.left = '-10000px';
    iframe.style.top = '0';
    iframe.style.width = '900px';
    iframe.style.height = '700px';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const quitarIframe = () => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    };

    try {
      const doc = iframe.contentDocument;
      if (!doc) throw new Error('El navegador no permitió preparar el documento de impresión.');

      // Un SVG por CÓDIGO único, nunca por copia -- mismo criterio histórico.
      const cache = new Map<string, string>();
      const codigosUnicos = Array.from(new Set(this.productos.map((p) => p.codigo)));
      await Promise.all(
        codigosUnicos.map(async (codigo) => {
          cache.set(codigo, await this.generarSvg(codigo, formato));
        }),
      );

      const esQr = formato === 'qr';
      const mostrarNombre = this.mostrarNombre();
      const mostrarSku = this.mostrarSku();
      const mostrarPrecio = this.mostrarPrecio();

      const htmlEtiquetas = this.productos
        .flatMap((p) => Array.from({ length: p.copias }, () => p))
        .map((p) => {
          const svg = cache.get(p.codigo) ?? '';
          const nombre = mostrarNombre ? `<div class="nombre">${this.escaparHtml(p.nombre)}</div>` : '';
          const sku = mostrarSku ? `<div class="sku">${this.escaparHtml(p.codigo)}</div>` : '';
          const precio = mostrarPrecio ? `<div class="precio">${this.escaparHtml(formatMoneda(p.precioUnitario))}</div>` : '';
          return `
        <div class="etiqueta${esQr ? ' formato-qr' : ''}">
          ${svg}
          ${nombre}
          ${sku}
          ${precio}
        </div>`;
        })
        .join('');

      doc.open();
      doc.write(`<!doctype html>
      <html lang="es">
        <head>
          <meta charset="utf-8" />
          <title>Etiquetas</title>
          <style>
            * { box-sizing: border-box; }
            body { margin: 0; font-family: Arial, Helvetica, sans-serif; }
            @page { size: ${papelMm.ancho}mm ${altoPaginaMm}mm; margin: ${margen}mm; }
            .etiquetas-grid {
              display: grid;
              grid-template-columns: repeat(${Math.max(d.columnas, 1)}, ${etiquetaMm.ancho}mm);
              gap: ${SEPARACION_MM}mm;
              justify-content: center;
            }
            .etiqueta {
              width: ${etiquetaMm.ancho}mm; height: ${etiquetaMm.alto}mm; padding: 2mm; overflow: hidden;
              display: flex; flex-direction: column; align-items: center; justify-content: center;
              border: 1px dashed #999; text-align: center;
              break-inside: avoid; page-break-inside: avoid;
            }
            .etiqueta svg { width: 100%; height: 55%; }
            /* QR: proporción cuadrada propia (nunca estirado) -- el margen
               de seguridad ya lo trae el propio SVG (ver generarSvgQr). */
            .etiqueta.formato-qr svg { width: 55%; height: 55%; }
            .etiqueta .nombre { font-size: 9px; font-weight: 700; line-height: 1.2; max-width: 100%; overflow: hidden; margin-top: 1mm; }
            .etiqueta .sku { font-size: 7px; color: #555; line-height: 1.1; margin-top: 0.3mm; max-width: 100%; overflow: hidden; }
            .etiqueta .precio { font-size: 11px; font-weight: 800; margin-top: 1mm; }
            @media print { .etiqueta { border: none; } }
          </style>
        </head>
        <body>
          <div class="etiquetas-grid">${htmlEtiquetas}</div>
        </body>
      </html>`);
      doc.close();

      const ventana = iframe.contentWindow;
      if (!ventana) throw new Error('El navegador no permitió preparar la ventana de impresión.');

      try {
        ventana.focus();
        ventana.print();
      } catch (errPrint) {
        console.error('Error al imprimir:', errPrint);
      } finally {
        setTimeout(quitarIframe, 1000);
      }
    } catch (error) {
      console.error('Error al generar las etiquetas de impresión:', error);
      quitarIframe();
      const motivo = error instanceof Error ? error.message : String(error);
      this.toast.error(`No se pudieron generar las etiquetas: ${motivo}`);
      throw error; // imprimirAhora() ya no debe mostrar el toast de éxito.
    }
  }
}

import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  forwardRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import Quill from 'quill';
import QuillTableBetter from 'quill-table-better';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import plaintext from 'highlight.js/lib/languages/plaintext';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import sql from 'highlight.js/lib/languages/sql';
import xml from 'highlight.js/lib/languages/xml';
import { ToastService } from '../../services/toast.service';

// Los nombres registrados deben coincidir con las `key` que Quill usa en
// modules/syntax.js (Syntax.DEFAULTS.languages) para su selector de lenguaje
// dentro de cada bloque de código — 'cs' y 'plain' son las claves de Quill,
// no los nombres internos de highlight.js ('csharp'/'plaintext').
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('cs', csharp);
hljs.registerLanguage('css', css);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('java', java);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('php', php);
hljs.registerLanguage('plain', plaintext);
hljs.registerLanguage('python', python);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('sql', sql);

// Tablas reales en el editor (insertar/borrar filas y columnas, combinar
// celdas, redimensionar) — Quill no las trae de fábrica. La librería no
// incluye español entre sus idiomas predefinidos (language: 'en_US' por
// default), así que se registra un diccionario propio con las mismas
// claves que su en_US.ts para que la barra de acciones de la tabla salga
// en español en vez de en inglés.
Quill.register({ 'modules/table-better': QuillTableBetter }, true);

const IDIOMA_TABLA_ES = {
  name: 'es_MX',
  content: {
    col: 'Columna',
    insColL: 'Insertar columna a la izquierda',
    insColR: 'Insertar columna a la derecha',
    delCol: 'Eliminar columna',
    selCol: 'Seleccionar columna',
    row: 'Fila',
    headerRow: 'Fila de encabezado',
    insRowAbv: 'Insertar fila arriba',
    insRowBlw: 'Insertar fila abajo',
    delRow: 'Eliminar fila',
    selRow: 'Seleccionar fila',
    mCells: 'Combinar celdas',
    sCell: 'Dividir celda',
    tblProps: 'Propiedades de la tabla',
    cellProps: 'Propiedades de la celda',
    insParaOTbl: 'Insertar párrafo fuera de la tabla',
    insB4: 'Insertar antes',
    insAft: 'Insertar después',
    copyTable: 'Copiar tabla',
    delTable: 'Eliminar tabla',
    border: 'Borde',
    color: 'Color',
    width: 'Ancho',
    background: 'Fondo',
    dims: 'Dimensiones',
    height: 'Alto',
    padding: 'Relleno',
    tblCellTxtAlm: 'Alineación del texto de la celda',
    alCellTxtL: 'Alinear texto a la izquierda',
    alCellTxtC: 'Centrar texto',
    alCellTxtR: 'Alinear texto a la derecha',
    jusfCellTxt: 'Justificar texto',
    alCellTxtT: 'Alinear texto arriba',
    alCellTxtM: 'Alinear texto al medio',
    alCellTxtB: 'Alinear texto abajo',
    dimsAlm: 'Dimensiones y alineación',
    alTblL: 'Alinear tabla a la izquierda',
    tblC: 'Centrar tabla',
    alTblR: 'Alinear tabla a la derecha',
    save: 'Guardar',
    cancel: 'Cancelar',
    colorMsg: 'El color no es válido. Prueba "#FF0000", "rgb(255,0,0)" o "red".',
    dimsMsg: 'El valor no es válido. Prueba "10px", "2em", "2%" o solo "2".',
    colorPicker: 'Selector de color',
    removeColor: 'Quitar color',
    black: 'Negro',
    dimGrey: 'Gris oscuro',
    grey: 'Gris',
    lightGrey: 'Gris claro',
    white: 'Blanco',
    red: 'Rojo',
    orange: 'Naranja',
    yellow: 'Amarillo',
    lightGreen: 'Verde claro',
    green: 'Verde',
    aquamarine: 'Aguamarina',
    turquoise: 'Turquesa',
    lightBlue: 'Azul claro',
    blue: 'Azul',
    purple: 'Morado',
  },
};

// Línea divisoria (➖) — Quill no trae un botón para insertar una <hr>, así
// que se registra un blot de bloque propio ('divider') que renderiza una
// <hr> real; el estilo (línea negra) vive en `.ql-editor hr` / `.page-body
// hr` dentro de styles.scss, para que se vea igual al editar y al ver.
const BlockEmbedBlot = Quill.import('blots/block/embed') as any;
class DividerBlot extends BlockEmbedBlot {
  static blotName = 'divider';
  static tagName = 'hr';
}
Quill.register(DividerBlot);

// Tamaño de letra por LÍNEA (no solo del texto seleccionado) — el 'size'
// que trae Quill de fábrica es un formato de ALCANCE INLINE (clase sobre
// un <span>, ver node_modules/quill/formats/size.js): agranda el texto
// pero no la propia etiqueta <li>/<p> de la línea. El "1." de una lista
// numerada lo dibuja Quill con un ::before sobre un <span class="ql-ui">
// hermano — fuera de ese <span> de texto — así que nunca heredaba el
// tamaño inline (por eso "Grande"/"Enorme" agrandaba el texto pero el
// número se quedaba normal). Se reemplaza por un formato de ALCANCE DE
// BLOQUE (mismo criterio que usa el propio 'align' de Quill, ver
// formats/align.js): se aplica como `style="font-size:…"` directo sobre
// la etiqueta de la línea, así que el número — descendiente de esa
// etiqueta — hereda el tamaño igual que el texto.
const { StyleAttributor, Scope } = Quill.import('parchment');
const TamanoLineaStyle = new StyleAttributor('size', 'font-size', {
  scope: Scope.BLOCK,
  whitelist: ['0.85em', '1.5em', '2.5em'],
});
Quill.register({ 'formats/size': TamanoLineaStyle }, true);

const PESO_MAXIMO_ARCHIVO = 4 * 1024 * 1024; // 4 MB — mismo límite que app-adjuntos-panel.

/** Documento enlazable desde el botón "🔖 Enlazar documento" del editor —
 *  a propósito solo trae id/título (no el modelo `Documento` completo) para
 *  que este componente compartido no dependa de WikiDocs ni de
 *  `DataClientService`; quien lo usa decide qué lista de documentos pasar. */
export interface EnlaceDocumentoOpcion {
  id: number;
  titulo: string;
}

function leerComoDataUrl(archivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(lector.result as string);
    lector.onerror = () => reject(lector.error);
    lector.readAsDataURL(archivo);
  });
}

function abrirSelectorArchivo(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

/**
 * Editor de texto enriquecido (WYSIWYG) reutilizable, envolviendo la
 * librería `quill`. Se usa como cualquier otro control de un formulario
 * reactivo vía `formControlName` (implementa `ControlValueAccessor`,
 * mismo criterio que el resto de controles de la app) y guarda/lee el
 * valor como HTML.
 *
 * Botones propios agregados sobre la barra de Quill:
 *  - Imagen: sube un archivo de imagen y la inserta incrustada (data URL,
 *    igual que `app-adjuntos-panel`), tope de 4 MB.
 *  - Archivo (📎): sube cualquier archivo y lo inserta como un enlace de
 *    descarga con el nombre del archivo como texto, para poder referenciar
 *    documentos directo dentro de la redacción (no solo en la pestaña de
 *    Adjuntos aparte). Mismo tope de 4 MB.
 *  - Enlace: es el botón nativo de Quill (ya pide la URL solo).
 *  - Enlazar documento (🔖): solo aparece con utilidad si el consumidor pasa
 *    `[documentosEnlace]`; abre un buscador y arma un enlace interno tipo
 *    `#wikidoc-<id>` (a propósito un simple fragmento, no un esquema
 *    inventado — el formato `link` de Quill solo acepta
 *    http/https/mailto/tel/sms y sanea cualquier otro esquema a
 *    "about:blank", así que un `wikidoc:5` se perdería silenciosamente).
 *    Quien muestra el documento (`DocumentosListComponent`) intercepta el
 *    click sobre ese enlace y navega al documento en vez de dejar que el
 *    navegador intente resolver el fragmento.
 */
@Component({
  selector: 'app-editor-texto',
  standalone: true,
  templateUrl: './editor-texto.component.html',
  styleUrl: './editor-texto.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => EditorTextoComponent),
      multi: true,
    },
  ],
})
export class EditorTextoComponent implements ControlValueAccessor, AfterViewInit, OnDestroy {
  private readonly toast = inject(ToastService);

  @ViewChild('contenedor', { static: true }) private contenedorRef!: ElementRef<HTMLDivElement>;

  /** Documentos disponibles para el botón "Enlazar documento" — vacío por
   *  default, así que en cualquier otro uso del editor (Comercio, etc.) el
   *  botón simplemente avisa que no hay nada que enlazar en vez de fallar. */
  readonly documentosEnlace = input<EnlaceDocumentoOpcion[]>([]);

  protected readonly deshabilitado = signal(false);

  protected readonly mostrarPickerEnlace = signal(false);
  protected readonly filtroEnlace = signal('');
  protected readonly documentosFiltrados = computed(() => {
    const texto = this.filtroEnlace().trim().toLowerCase();
    const lista = this.documentosEnlace();
    if (!texto) return lista;
    return lista.filter((documento) => documento.titulo.toLowerCase().includes(texto));
  });

  private quill?: Quill;
  private valorPendiente = '';
  private aplicandoValorInterno = false;
  private onChange: (valor: string) => void = () => {};
  private onTouched: () => void = () => {};

  /** Selección guardada al abrir el picker (Quill la pierde al perder foco
   *  el editor mientras se escribe en el buscador del modal). */
  private rangoEnlaceGuardado: { index: number; length: number } | null = null;

  ngAfterViewInit(): void {
    this.quill = new Quill(this.contenedorRef.nativeElement, {
      theme: 'snow',
      placeholder: 'Escribe el contenido del documento…',
      modules: {
        toolbar: {
          container: [
            [{ header: [1, 2, 3, false] }],
            [{ size: ['0.85em', false, '1.5em', '2.5em'] }],
            ['bold', 'italic', 'underline', 'strike'],
            [{ color: [] }, { background: [] }],
            [{ align: [] }],
            [{ list: 'ordered' }, { list: 'bullet' }],
            ['blockquote', 'code-block'],
            ['divider'],
            ['link', 'image', 'archivo', 'wikidoc'],
            ['table-better'],
            ['clean'],
          ],
          handlers: {
            image: () => this.insertarImagen(),
            archivo: () => this.insertarArchivo(),
            wikidoc: () => this.abrirPickerEnlace(),
            divider: () => this.insertarLineaDivisoria(),
          },
        },
        // Colorea los bloques de código (botón </> de la barra) según el
        // lenguaje — cada bloque trae su propio selector de lenguaje (incluye
        // SQL) y se recolorea solo mientras se escribe.
        syntax: { hljs },
        // El formato de tabla básico que trae Quill de fábrica (solo
        // renderiza, sin UI para editar) se desactiva a favor del módulo
        // 'table-better' de abajo, que sí la trae completa.
        table: false,
        'table-better': {
          language: IDIOMA_TABLA_ES,
          menus: ['column', 'row', 'merge', 'table', 'cell', 'wrap', 'delete'],
          toolbarTable: true,
        },
        // 'table-better' necesita estos atajos de teclado propios para que
        // las flechas/Tab/Enter se comporten bien dentro de una tabla.
        keyboard: {
          bindings: QuillTableBetter.keyboardBindings,
        },
      },
    });

    if (this.valorPendiente) {
      this.aplicandoValorInterno = true;
      this.cargarHtml(this.valorPendiente);
      this.aplicandoValorInterno = false;
    }

    this.quill.on('text-change', () => {
      if (this.aplicandoValorInterno) return;
      this.onChange(this.quill!.root.innerHTML);
    });
    this.quill.on('selection-change', (rango) => {
      if (!rango) this.onTouched();
    });

    if (this.deshabilitado()) this.quill.disable();
  }

  ngOnDestroy(): void {
    this.quill = undefined;
  }

  writeValue(valor: string | null): void {
    this.valorPendiente = valor || '';
    if (!this.quill) return;
    this.aplicandoValorInterno = true;
    this.quill.setText('');
    this.cargarHtml(this.valorPendiente);
    this.aplicandoValorInterno = false;
  }

  /** Carga HTML guardado dentro del editor. A propósito NO usa
   *  `quill.clipboard.dangerouslyPasteHTML(html)` (la forma de un solo
   *  argumento) porque esa variante llama a `quill.setContents()` por
   *  dentro (ver node_modules/quill/modules/clipboard.js), y el propio
   *  README de `quill-table-better` advierte que `setContents` deja las
   *  tablas mal renderizadas — es justo el bug de "al editar/ver no se ve
   *  la tabla que guardé". La forma de dos argumentos
   *  (`dangerouslyPasteHTML(index, html)`) usa `quill.updateContents()`
   *  en vez de `setContents()`, que sí reconstruye las tablas bien; con
   *  `index: 0` sobre un editor recién vaciado equivale a "reemplazar todo
   *  el contenido", el mismo efecto que se buscaba con la forma de un
   *  argumento. */
  private cargarHtml(html: string): void {
    this.quill!.clipboard.dangerouslyPasteHTML(0, html, 'silent');
  }

  registerOnChange(fn: (valor: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(deshabilitado: boolean): void {
    this.deshabilitado.set(deshabilitado);
    this.quill?.enable(!deshabilitado);
  }

  private async insertarImagen(): Promise<void> {
    const archivo = await abrirSelectorArchivo('image/*');
    if (!archivo || !this.quill) return;
    if (archivo.size > PESO_MAXIMO_ARCHIVO) {
      this.toast.advertencia('La imagen no puede pesar más de 4 MB.');
      return;
    }
    try {
      const dataUrl = await leerComoDataUrl(archivo);
      const rango = this.quill.getSelection(true);
      this.quill.insertEmbed(rango.index, 'image', dataUrl, 'user');
      this.quill.setSelection(rango.index + 1, 0, 'user');
    } catch {
      this.toast.error('No se pudo leer la imagen.');
    }
  }

  private async insertarArchivo(): Promise<void> {
    const archivo = await abrirSelectorArchivo('*/*');
    if (!archivo || !this.quill) return;
    if (archivo.size > PESO_MAXIMO_ARCHIVO) {
      this.toast.advertencia('El archivo no puede pesar más de 4 MB.');
      return;
    }
    try {
      const dataUrl = await leerComoDataUrl(archivo);
      const rango = this.quill.getSelection(true);
      this.quill.insertText(rango.index, archivo.name, { link: dataUrl }, 'user');
      this.quill.setSelection(rango.index + archivo.name.length, 0, 'user');
    } catch {
      this.toast.error('No se pudo leer el archivo.');
    }
  }

  /** Inserta una línea divisoria horizontal (<hr>) en la posición del
   *  cursor — botón propio "➖" de la barra (ver blot 'divider' arriba). */
  private insertarLineaDivisoria(): void {
    if (!this.quill) return;
    const rango = this.quill.getSelection(true);
    const indice = rango ? rango.index : this.quill.getLength();
    this.quill.insertEmbed(indice, 'divider', true, 'user');
    this.quill.setSelection(indice + 1, 0, 'user');
  }

  protected abrirPickerEnlace(): void {
    if (!this.quill) return;
    if (this.documentosEnlace().length === 0) {
      this.toast.advertencia('No hay otros documentos para enlazar todavía.');
      return;
    }
    this.rangoEnlaceGuardado = this.quill.getSelection(true);
    this.filtroEnlace.set('');
    this.mostrarPickerEnlace.set(true);
  }

  protected elegirDocumentoEnlace(documento: EnlaceDocumentoOpcion): void {
    const rango = this.rangoEnlaceGuardado;
    if (!this.quill || !rango) {
      this.cerrarPickerEnlace();
      return;
    }
    // Fragmento simple (no un esquema propio) — ver el comentario de la
    // clase sobre por qué el sanitizador de Quill exige esto.
    const href = `#wikidoc-${documento.id}`;
    if (rango.length > 0) {
      // Ya había texto seleccionado al abrir el picker: se conserva tal
      // cual y solo se le agrega el enlace.
      this.quill.formatText(rango.index, rango.length, 'link', href, 'user');
      this.quill.setSelection(rango.index + rango.length, 0, 'user');
    } else {
      this.quill.insertText(rango.index, documento.titulo, { link: href }, 'user');
      this.quill.setSelection(rango.index + documento.titulo.length, 0, 'user');
    }
    this.cerrarPickerEnlace();
  }

  protected cerrarPickerEnlace(): void {
    this.mostrarPickerEnlace.set(false);
    this.rangoEnlaceGuardado = null;
  }
}

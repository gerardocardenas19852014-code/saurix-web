import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  forwardRef,
  inject,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import Quill from 'quill';
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

const PESO_MAXIMO_ARCHIVO = 4 * 1024 * 1024; // 4 MB — mismo límite que app-adjuntos-panel.

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

  protected readonly deshabilitado = signal(false);

  private quill?: Quill;
  private valorPendiente = '';
  private aplicandoValorInterno = false;
  private onChange: (valor: string) => void = () => {};
  private onTouched: () => void = () => {};

  ngAfterViewInit(): void {
    this.quill = new Quill(this.contenedorRef.nativeElement, {
      theme: 'snow',
      placeholder: 'Escribe el contenido del documento…',
      modules: {
        toolbar: {
          container: [
            [{ header: [1, 2, 3, false] }],
            ['bold', 'italic', 'underline', 'strike'],
            [{ color: [] }, { background: [] }],
            [{ list: 'ordered' }, { list: 'bullet' }],
            ['blockquote', 'code-block'],
            ['link', 'image', 'archivo'],
            ['clean'],
          ],
          handlers: {
            image: () => this.insertarImagen(),
            archivo: () => this.insertarArchivo(),
          },
        },
        // Colorea los bloques de código (botón </> de la barra) según el
        // lenguaje — cada bloque trae su propio selector de lenguaje (incluye
        // SQL) y se recolorea solo mientras se escribe.
        syntax: { hljs },
      },
    });

    if (this.valorPendiente) {
      this.aplicandoValorInterno = true;
      this.quill.clipboard.dangerouslyPasteHTML(this.valorPendiente);
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
    this.quill.clipboard.dangerouslyPasteHTML(this.valorPendiente);
    this.aplicandoValorInterno = false;
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
}

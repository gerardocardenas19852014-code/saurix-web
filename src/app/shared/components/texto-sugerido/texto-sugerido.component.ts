import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  Input,
  Output,
  EventEmitter,
  ViewChild,
  computed,
  effect,
  signal,
} from '@angular/core';

/** Una sugerencia devuelta por el origen remoto — `sistema` es opcional y
 *  sirve para desambiguar visualmente dos valores iguales que pertenecen a
 *  sistemas distintos (p.ej. "cliente" en SIIF vs. "cliente" en SAF). */
export interface SugerenciaTexto {
  valor: string;
  sistema?: string | null;
}

/**
 * Campo de texto libre con sugerencias remotas opcionales — a diferencia de
 * `SelectBuscableComponent` (que SIEMPRE exige elegir una opción existente),
 * este componente nunca bloquea al usuario: puede escribir cualquier valor
 * nuevo, las sugerencias son solo una ayuda de captura. Pensado para
 * "Mandato 89: WikiDocs — referencias universales" (nov-2026) — Sistema,
 * Tabla, Proceso, Módulo y Pantalla/funcionalidad de la pestaña Referencias,
 * todos texto libre con autocompletado desde `wikidocs.fn_referencias_sugerencias`.
 *
 * Reglas de rendimiento ya incorporadas aquí (no hace falta repetirlas en
 * cada pantalla que lo use): sin consulta con el campo vacío, mínimo
 * `minCaracteres` antes de llamar, debounce de `debounceMs`, se descartan
 * respuestas que ya no corresponden al texto actual (secuencia), y no se
 * vuelve a consultar al elegir una sugerencia (la lista se cierra sola).
 */
@Component({
  selector: 'app-texto-sugerido',
  standalone: true,
  imports: [],
  templateUrl: './texto-sugerido.component.html',
  styleUrl: './texto-sugerido.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TextoSugeridoComponent {
  @Input() placeholder = '';
  @Input() debounceMs = 300;
  @Input() minCaracteres = 2;
  /** Función que trae las sugerencias (normalmente una llamada a
   *  `wikidocs.fn_referencias_sugerencias`) — si se omite, el campo se
   *  comporta como un `<input>` de texto libre normal, sin dropdown. */
  @Input() busquedaRemota?: (texto: string) => Promise<SugerenciaTexto[]>;

  @Output() readonly valueChange = new EventEmitter<string>();

  @ViewChild('campo') private campoRef?: ElementRef<HTMLInputElement>;

  protected readonly texto = signal('');
  protected readonly sugerencias = signal<SugerenciaTexto[]>([]);
  protected readonly cargando = signal(false);
  protected readonly abierto = signal(false);
  protected readonly indiceActivo = signal(-1);
  private readonly yaConsultado = signal(false);

  private secuencia = 0;
  private temporizador: ReturnType<typeof setTimeout> | null = null;

  @Input()
  set value(v: string | null | undefined) {
    this.texto.set(v ?? '');
  }

  protected readonly mostrarVacio = computed(
    () => this.abierto() && this.yaConsultado() && !this.cargando() && this.sugerencias().length === 0,
  );

  constructor() {
    // Un solo effect reactivo al texto escrito — dispara la búsqueda
    // debounced en vez de requerir que cada consumidor llame algo en
    // (input). Se reinicia solo cuando el texto realmente cambia.
    let anterior = '';
    effect(() => {
      const actual = this.texto();
      if (actual === anterior) return;
      anterior = actual;
      this.programarBusqueda(actual);
    });
  }

  private programarBusqueda(texto: string): void {
    if (this.temporizador) clearTimeout(this.temporizador);
    if (!this.busquedaRemota || texto.trim().length < this.minCaracteres) {
      this.sugerencias.set([]);
      this.yaConsultado.set(false);
      this.cargando.set(false);
      return;
    }
    this.temporizador = setTimeout(() => void this.ejecutarBusqueda(texto), this.debounceMs);
  }

  private async ejecutarBusqueda(texto: string): Promise<void> {
    const miSecuencia = ++this.secuencia;
    this.cargando.set(true);
    const resultado = await this.busquedaRemota!(texto).catch(() => [] as SugerenciaTexto[]);
    if (miSecuencia !== this.secuencia) return; // respuesta obsoleta, se descarta
    this.cargando.set(false);
    this.yaConsultado.set(true);
    this.sugerencias.set(resultado);
    this.indiceActivo.set(-1);
  }

  protected onInput(valor: string): void {
    this.texto.set(valor);
    this.abierto.set(true);
    this.valueChange.emit(valor);
  }

  protected onFocus(): void {
    if (this.texto().trim().length >= this.minCaracteres) this.abierto.set(true);
  }

  @HostListener('document:click', ['$event'])
  protected onClickFuera(evento: MouseEvent): void {
    const host = this.campoRef?.nativeElement.closest('.texto-sugerido');
    if (host && !host.contains(evento.target as Node)) this.abierto.set(false);
  }

  protected elegir(sugerencia: SugerenciaTexto): void {
    this.texto.set(sugerencia.valor);
    this.valueChange.emit(sugerencia.valor);
    this.abierto.set(false);
    this.sugerencias.set([]);
    this.campoRef?.nativeElement.focus();
  }

  protected onKeydown(evento: KeyboardEvent): void {
    const lista = this.sugerencias();
    if (!this.abierto() || lista.length === 0) return;

    if (evento.key === 'ArrowDown') {
      evento.preventDefault();
      this.indiceActivo.update((i) => Math.min(lista.length - 1, i + 1));
    } else if (evento.key === 'ArrowUp') {
      evento.preventDefault();
      this.indiceActivo.update((i) => Math.max(0, i - 1));
    } else if (evento.key === 'Enter') {
      const i = this.indiceActivo();
      if (i >= 0 && i < lista.length) {
        evento.preventDefault();
        this.elegir(lista[i]);
      }
    } else if (evento.key === 'Escape') {
      this.abierto.set(false);
    }
  }
}

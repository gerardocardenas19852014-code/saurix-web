import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  Output,
  ViewChild,
  computed,
  forwardRef,
  signal,
} from '@angular/core';
import { NG_VALUE_ACCESSOR, ControlValueAccessor } from '@angular/forms';

export interface OpcionBuscable {
  valor: number | string;
  etiqueta: string;
  /** Encabezado bajo el que se agrupa (igual que un <optgroup>). Opcional: sin
   *  grupo, la opción se lista suelta (p.ej. la fila "Todas"/"Sin categoría"). */
  grupo?: string;
}

/**
 * Reemplazo "buscable" de un <select> con muchas opciones (Cuenta, Categoría…):
 * en vez de desplazar una lista larga con el mouse, se escribe y la lista se
 * filtra en vivo. Soporta agrupar opciones (como <optgroup>) y funciona tanto
 * con [(value)] simple (filtros con signals) como con formControlName
 * (implementa ControlValueAccessor), y también de forma imperativa vía
 * referencia de plantilla (#combo, igual que se leía/limpiaba un <select>
 * nativo antes: combo.value, combo.value = 0).
 *
 * El panel de opciones se dibuja con position:fixed y su posición se calcula
 * al abrir a partir del <input> (getBoundingClientRect) — así no lo recorta
 * un modal con overflow-y:auto (el problema clásico de un dropdown dentro de
 * un contenedor con scroll). Si la página hace scroll mientras está abierto,
 * simplemente se cierra (como un <select> nativo) en vez de perseguir la
 * posición del input.
 *
 * MODO REMOTO (27-oct, ver Movimientos entre bodegas → Historial → Producto):
 * si se pasa [busquedaRemota], el componente deja de filtrar [opciones] en
 * memoria (pensado para catálogos chicos) y en su lugar llama a esa función
 * con debounce cada vez que el usuario escribe, mostrando lo que devuelva
 * (pensado para catálogos de 200,000+ filas, donde nunca se puede traer todo
 * de un jalón) — mismo panel/estilos/navegación por teclado de siempre, cero
 * cambio de comportamiento para los usos existentes (que no pasan este
 * input). La etiqueta del valor seleccionado, en este modo, es la del último
 * producto elegido (no se puede "buscar" en una lista que no existe en
 * memoria) — se limpia junto con el valor en limpiar().
 */
@Component({
  selector: 'app-select-buscable',
  standalone: true,
  templateUrl: './select-buscable.component.html',
  styleUrl: './select-buscable.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => SelectBuscableComponent),
      multi: true,
    },
  ],
})
export class SelectBuscableComponent implements ControlValueAccessor, OnDestroy {
  @Input() placeholder = 'Buscar…';

  /** true solo en filtros opcionales (p.ej. categoría/bodega en un listado):
   *  muestra una "✕" para volver al estado en blanco (sin selección = sin
   *  filtrar) sin tener que agregar una opción artificial como "Todas las
   *  categorías" a la lista. false por defecto para no cambiar nada en los
   *  usos existentes (campos obligatorios de formulario, donde no aplica). */
  @Input() permiteLimpiar = false;

  /** Ver comentario de clase ("MODO REMOTO"). undefined = comportamiento de
   *  siempre (filtra [opciones] en memoria). */
  @Input() busquedaRemota?: (texto: string) => Promise<OpcionBuscable[]>;
  /** Espera antes de llamar a busquedaRemota tras la última tecla — evita
   *  una petición por cada letra. Solo aplica en modo remoto. */
  @Input() debounceMs = 300;

  /** En modo remoto, sirve para mostrar la etiqueta de un valor preseleccionado
   *  programáticamente (p.ej. un formulario que precarga un productoId con
   *  reset()/patchValue()) — en ese modo el componente no tiene el catálogo
   *  completo para resolverla por sí solo (ver etiquetaSeleccion()). undefined
   *  = no se toca la etiqueta actual. */
  @Input()
  set etiquetaValorExterno(v: string | null | undefined) {
    if (v !== undefined) this.etiquetaManualRemota.set(v);
  }


  @Input()
  set opciones(v: OpcionBuscable[] | null) {
    this._opciones.set(v ?? []);
  }
  get opciones(): OpcionBuscable[] {
    return this._opciones();
  }
  private readonly _opciones = signal<OpcionBuscable[]>([]);

  @Input()
  set value(v: number | string | null) {
    this._value.set(v ?? null);
  }
  get value(): number | string | null {
    return this._value();
  }
  private readonly _value = signal<number | string | null>(null);

  @Input()
  set disabled(v: boolean) {
    this._disabled.set(v);
  }
  get disabled(): boolean {
    return this._disabled();
  }
  private readonly _disabled = signal(false);

  @Output() readonly valueChange = new EventEmitter<number | string | null>();

  @ViewChild('inputBuscable') private inputRef?: ElementRef<HTMLInputElement>;

  protected readonly abierta = signal(false);
  protected readonly texto = signal('');
  protected readonly indiceActivo = signal(0);
  protected readonly panelRect = signal<{ top: number; left: number; width: number } | null>(null);

  // ── Modo remoto ───────────────────────────────────────────────────────
  private readonly opcionesRemotas = signal<OpcionBuscable[]>([]);
  protected readonly cargandoRemoto = signal(false);
  /** Etiqueta del último producto elegido en modo remoto (ver comentario de
   *  clase) — independiente de [opciones], que en ese modo nunca contiene
   *  el catálogo completo. */
  private readonly etiquetaManualRemota = signal<string | null>(null);
  private debounceHandle: ReturnType<typeof setTimeout> | null = null;
  private secuenciaBusquedaRemota = 0;

  private onChange: ((v: number | string | null) => void) | null = null;
  private onTouched: (() => void) | null = null;
  // El panel de opciones tiene su propia lista con overflow-y:auto (para
  // categorías largas, como en la captura que reportó el usuario): hacer
  // scroll ADENTRO de esa lista disparaba este mismo listener (está en fase
  // de captura, así que ve el scroll de cualquier descendiente) y cerraba
  // el combo en cuanto se quería bajar para ver más opciones. Por eso acá
  // se ignora el scroll cuyo target cae dentro de este mismo componente
  // (el <input> + el panel, aunque el panel sea position:fixed sigue
  // siendo hijo del host en el DOM) — solo cierra cuando el scroll viene
  // de afuera (la página o un modal con overflow-y:auto).
  private readonly manejarScrollGlobal = (evento: Event) => {
    if (!this.abierta()) return;
    const objetivo = evento.target as Node | null;
    if (objetivo && this.elementRef.nativeElement.contains(objetivo)) return;
    this.cerrar();
  };

  protected readonly etiquetaSeleccion = computed(() => {
    const v = this._value();
    if (v === null || v === undefined || v === '') return '';
    if (this.busquedaRemota) return this.etiquetaManualRemota() ?? '';
    const opcion = this._opciones().find((o) => String(o.valor) === String(v));
    return opcion?.etiqueta ?? '';
  });

  protected readonly textoMostrado = computed(() => (this.abierta() ? this.texto() : this.etiquetaSeleccion()));

  /** La "✕" solo se ve si permiteLimpiar y hay algo que limpiar (si no,
   *  estorbaría sobre el placeholder vacío). Se basa en si hay una etiqueta
   *  visible, no en el valor crudo — así "0 sin opción en la lista" (el caso
   *  de categoría/bodega aquí) se trata igual que null. */
  protected readonly mostrarBotonLimpiar = computed(
    () => this.permiteLimpiar && this.etiquetaSeleccion() !== '' && !this.abierta(),
  );

  /** En modo remoto, el servidor ya filtró — no se vuelve a filtrar en
   *  memoria (y no habría nada que filtrar: opcionesRemotas() es justo lo
   *  que ya coincide con el texto buscado). */
  private readonly opcionesFiltradas = computed(() => {
    if (this.busquedaRemota) return this.opcionesRemotas();
    const termino = this.normalizar(this.texto());
    const todas = this._opciones();
    if (!termino) return todas;
    return todas.filter((o) => this.normalizar(`${o.grupo ?? ''} ${o.etiqueta}`).includes(termino));
  });

  protected readonly gruposFiltrados = computed(() => {
    const sinGrupo: OpcionBuscable[] = [];
    const grupos: { grupo: string; opciones: OpcionBuscable[] }[] = [];
    const indicePorGrupo = new Map<string, number>();
    for (const o of this.opcionesFiltradas()) {
      if (!o.grupo) {
        sinGrupo.push(o);
        continue;
      }
      let indice = indicePorGrupo.get(o.grupo);
      if (indice === undefined) {
        indice = grupos.length;
        indicePorGrupo.set(o.grupo, indice);
        grupos.push({ grupo: o.grupo, opciones: [] });
      }
      grupos[indice].opciones.push(o);
    }
    return { sinGrupo, grupos };
  });

  protected readonly listaPlanaFiltrada = computed(() => {
    const { sinGrupo, grupos } = this.gruposFiltrados();
    return [...sinGrupo, ...grupos.flatMap((g) => g.opciones)];
  });

  ngOnDestroy(): void {
    document.removeEventListener('scroll', this.manejarScrollGlobal, true);
    if (this.debounceHandle) clearTimeout(this.debounceHandle);
  }

  private normalizar(texto: string): string {
    return texto
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
  }

  protected esActiva(opcion: OpcionBuscable): boolean {
    const activa = this.listaPlanaFiltrada()[this.indiceActivo()];
    return !!activa && activa.valor === opcion.valor;
  }

  protected onFocus(): void {
    if (this.disabled) return;
    const rect = this.inputRef?.nativeElement.getBoundingClientRect();
    if (rect) {
      this.panelRect.set({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    this.texto.set('');
    this.indiceActivo.set(0);
    this.abierta.set(true);
    document.addEventListener('scroll', this.manejarScrollGlobal, true);
    // Precarga las primeras coincidencias (texto vacío = "top N") para que
    // el panel no se vea vacío nada más abrir — solo la primera vez.
    if (this.busquedaRemota && this.opcionesRemotas().length === 0) this.dispararBusquedaRemota('');
  }

  protected onInput(v: string): void {
    this.texto.set(v);
    this.indiceActivo.set(0);
    if (!this.abierta()) this.onFocus();
    if (this.busquedaRemota) this.dispararBusquedaRemota(v);
  }

  /** Debounce manual (sin RxJS, para no agregarle una dependencia a un
   *  componente compartido en ~15 pantallas) — ver [debounceMs]. Ignora
   *  respuestas que lleguen después de una búsqueda más nueva (el usuario
   *  pudo seguir escribiendo mientras la petición anterior seguía en
   *  vuelo). */
  private dispararBusquedaRemota(texto: string): void {
    const resolver = this.busquedaRemota;
    if (!resolver) return;
    if (this.debounceHandle) clearTimeout(this.debounceHandle);
    this.debounceHandle = setTimeout(() => {
      const miSecuencia = ++this.secuenciaBusquedaRemota;
      this.cargandoRemoto.set(true);
      resolver(texto.trim())
        .then((resultado) => {
          if (miSecuencia !== this.secuenciaBusquedaRemota) return;
          this.opcionesRemotas.set(resultado);
        })
        .finally(() => {
          if (miSecuencia === this.secuenciaBusquedaRemota) this.cargandoRemoto.set(false);
        });
    }, texto ? this.debounceMs : 0);
  }

  protected seleccionar(opcion: OpcionBuscable): void {
    this._value.set(opcion.valor);
    this.etiquetaManualRemota.set(opcion.etiqueta);
    this.valueChange.emit(opcion.valor);
    this.onChange?.(opcion.valor);
    this.cerrar();
  }

  /** Botón "✕": vuelve al estado en blanco sin abrir el panel. mousedown
   *  (no click) + preventDefault, igual que seleccionar(), para que no se
   *  dispare primero el (focus) del input y reabra el panel. */
  protected limpiar(evento: Event): void {
    evento.preventDefault();
    evento.stopPropagation();
    this._value.set(null);
    this.etiquetaManualRemota.set(null);
    this.valueChange.emit(null);
    this.onChange?.(null);
    this.onTouched?.();
  }

  protected cerrar(): void {
    this.abierta.set(false);
    this.texto.set('');
    this.onTouched?.();
    document.removeEventListener('scroll', this.manejarScrollGlobal, true);
  }

  @HostListener('document:mousedown', ['$event'])
  protected onDocumentMousedown(evento: MouseEvent): void {
    if (!this.abierta()) return;
    if (!this.elementRef.nativeElement.contains(evento.target as Node)) {
      this.cerrar();
    }
  }

  @HostListener('window:resize')
  protected onResize(): void {
    if (this.abierta()) this.cerrar();
  }

  @HostListener('keydown', ['$event'])
  protected onKeydown(evento: KeyboardEvent): void {
    if (evento.key === 'Escape') {
      evento.stopPropagation();
      this.cerrar();
      return;
    }
    if (evento.key === 'ArrowDown') {
      evento.preventDefault();
      if (!this.abierta()) {
        this.onFocus();
        return;
      }
      const total = this.listaPlanaFiltrada().length;
      this.indiceActivo.update((i) => Math.min(i + 1, total - 1));
      return;
    }
    if (evento.key === 'ArrowUp') {
      evento.preventDefault();
      this.indiceActivo.update((i) => Math.max(i - 1, 0));
      return;
    }
    if (evento.key === 'Enter') {
      const opcion = this.listaPlanaFiltrada()[this.indiceActivo()];
      if (this.abierta() && opcion) {
        evento.preventDefault();
        this.seleccionar(opcion);
      }
      return;
    }
    if (evento.key === 'Tab') {
      this.cerrar();
    }
  }

  constructor(private readonly elementRef: ElementRef<HTMLElement>) {}

  // ControlValueAccessor — permite usar formControlName="..." igual que un <select>.
  writeValue(v: number | string | null): void {
    this._value.set(v ?? null);
  }
  registerOnChange(fn: (v: number | string | null) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this._disabled.set(isDisabled);
  }
}

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
  signal,
} from '@angular/core';

/** Una etiqueta seleccionada/capturada en el chip-selector. `id` solo se
 *  conoce cuando proviene de una sugerencia ya existente en el catálogo
 *  (`wikidocs.fn_etiquetas_sugerencias`); queda en `null` cuando el
 *  usuario escribió un nombre libre que todavía no existe — se resuelve
 *  server-side (get-or-create atómico, nunca duplica) al guardar el
 *  documento, ver `wikidocs.fn_documento_etiquetas_sincronizar` /
 *  `fn_etiqueta_obtener_o_crear`. En el filtro de búsqueda
 *  (permitirNuevas=false) siempre viene con `id` — ahí nunca se admite
 *  texto libre. */
export interface EtiquetaChip {
  id: number | null;
  nombre: string;
}

/**
 * Selector de etiquetas en forma de chips removibles, con autocompletado
 * remoto opcional — Mandato 90 (nov-2026, "WikiDocs: etiquetas y
 * duplicación de documentos"). A diferencia de `TextoSugeridoComponent`
 * (un solo valor de texto libre), este componente administra una LISTA de
 * valores, y admite dos modos según `permitirNuevas`:
 *  - true  (formulario de alta/edición de Documento): el usuario puede
 *    agregar nombres que todavía no existen en el catálogo de la empresa
 *    (se resuelven al guardar — nunca se crea la etiqueta antes de
 *    guardar el documento, todo ocurre en una sola transacción server-side).
 *  - false (filtro de búsqueda por etiquetas): solo admite elegir una
 *    sugerencia ya existente — Enter sobre texto que no coincide con
 *    ninguna no agrega nada (no tendría con qué filtrar).
 *
 * 100% estado local (señales) — nunca dispara una búsqueda ni un guardado
 * por su cuenta; el padre lee `valor`/escucha `valorChange` y decide qué
 * hacer con eso (persistir al guardar el documento, o esperar a que se
 * presione "Buscar" para aplicar el filtro — SAURIX-CAT-001 v1.1, igual
 * que el resto de los filtros de esta pantalla: ningún cambio aquí
 * dispara nada por sí solo).
 *
 * Enter/coma dentro del campo de texto SIEMPRE se detiene con
 * preventDefault/stopPropagation (ver onKeydown) — nunca debe disparar el
 * submit del formulario que lo rodee (mismo motivo que motivó agregar
 * FormsModule a este archivo, Corrección 01 al Mandato 89: un `<input>`
 * dentro de un `<form>`, tenga o no `[formGroup]`, interpreta Enter como
 * intento de submit) ni la búsqueda principal de la cuadrícula.
 */
@Component({
  selector: 'app-chips-etiquetas',
  standalone: true,
  imports: [],
  templateUrl: './chips-etiquetas.component.html',
  styleUrl: './chips-etiquetas.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChipsEtiquetasComponent {
  @Input() placeholder = 'Agregar etiqueta…';
  @Input() permitirNuevas = true;
  @Input() maximo = 30;
  @Input() maxCaracteres = 60;
  @Input() debounceMs = 300;
  @Input() minCaracteres = 2;
  /** Trae las sugerencias (normalmente `wikidocs.fn_etiquetas_sugerencias`)
   *  — si se omite, el campo no ofrece autocompletado (solo tiene sentido
   *  combinado con permitirNuevas=true en ese caso: un campo de texto
   *  libre sin ayuda). */
  @Input() busquedaRemota?: (texto: string) => Promise<EtiquetaChip[]>;

  @Output() readonly valorChange = new EventEmitter<EtiquetaChip[]>();

  @ViewChild('campo') private campoRef?: ElementRef<HTMLInputElement>;

  protected readonly seleccionadas = signal<EtiquetaChip[]>([]);
  protected readonly texto = signal('');
  protected readonly sugerencias = signal<EtiquetaChip[]>([]);
  protected readonly cargando = signal(false);
  protected readonly abierto = signal(false);
  protected readonly indiceActivo = signal(-1);
  private readonly yaConsultado = signal(false);

  private secuencia = 0;
  private temporizador: ReturnType<typeof setTimeout> | null = null;

  @Input()
  set valor(v: EtiquetaChip[] | null | undefined) {
    this.seleccionadas.set(v ?? []);
  }

  protected readonly alTope = computed(() => this.seleccionadas().length >= this.maximo);

  /** Oculta de la lista las sugerencias que ya están elegidas (no tiene
   *  caso ofrecer agregar dos veces la misma etiqueta). */
  protected readonly sugerenciasFiltradas = computed(() => {
    const yaElegidas = new Set(this.seleccionadas().map((e) => this.normalizar(e.nombre)));
    return this.sugerencias().filter((s) => !yaElegidas.has(this.normalizar(s.nombre)));
  });

  protected readonly mostrarVacio = computed(
    () => this.abierto() && this.yaConsultado() && !this.cargando() && this.sugerenciasFiltradas().length === 0,
  );

  private normalizar(texto: string): string {
    return texto.trim().toLowerCase();
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
    const resultado = await this.busquedaRemota!(texto).catch(() => [] as EtiquetaChip[]);
    if (miSecuencia !== this.secuencia) return; // respuesta obsoleta, se descarta
    this.cargando.set(false);
    this.yaConsultado.set(true);
    this.sugerencias.set(resultado);
    this.indiceActivo.set(-1);
  }

  protected onInput(valorTexto: string): void {
    this.texto.set(valorTexto);
    this.abierto.set(true);
    this.programarBusqueda(valorTexto);
  }

  protected onFocus(): void {
    if (this.texto().trim().length >= this.minCaracteres) this.abierto.set(true);
  }

  @HostListener('document:click', ['$event'])
  protected onClickFuera(evento: MouseEvent): void {
    const host = this.campoRef?.nativeElement.closest('.chips-etiquetas');
    if (host && !host.contains(evento.target as Node)) this.abierto.set(false);
  }

  /** Agrega (si pasa las validaciones) y limpia el campo — usado tanto al
   *  elegir una sugerencia del dropdown como, cuando permitirNuevas=true,
   *  al presionar Enter/coma sobre texto libre que no coincidió con
   *  ninguna sugerencia. */
  private agregar(candidato: EtiquetaChip): void {
    const nombre = candidato.nombre.trim();
    if (!nombre || this.alTope() || nombre.length > this.maxCaracteres) return;
    const normalizado = this.normalizar(nombre);
    if (this.seleccionadas().some((e) => this.normalizar(e.nombre) === normalizado)) return;

    this.seleccionadas.update((lista) => [...lista, { id: candidato.id, nombre }]);
    this.valorChange.emit(this.seleccionadas());
    this.texto.set('');
    this.sugerencias.set([]);
    this.yaConsultado.set(false);
    this.abierto.set(false);
    this.indiceActivo.set(-1);
  }

  protected elegirSugerencia(sugerencia: EtiquetaChip): void {
    this.agregar(sugerencia);
    this.campoRef?.nativeElement.focus();
  }

  protected quitar(etiqueta: EtiquetaChip): void {
    const normalizado = this.normalizar(etiqueta.nombre);
    this.seleccionadas.update((lista) => lista.filter((e) => this.normalizar(e.nombre) !== normalizado));
    this.valorChange.emit(this.seleccionadas());
  }

  protected onKeydown(evento: KeyboardEvent): void {
    const lista = this.sugerenciasFiltradas();

    if (evento.key === 'ArrowDown' && this.abierto() && lista.length > 0) {
      evento.preventDefault();
      this.indiceActivo.update((i) => Math.min(lista.length - 1, i + 1));
      return;
    }
    if (evento.key === 'ArrowUp' && this.abierto() && lista.length > 0) {
      evento.preventDefault();
      this.indiceActivo.update((i) => Math.max(0, i - 1));
      return;
    }
    if (evento.key === 'Escape') {
      this.abierto.set(false);
      return;
    }
    if (evento.key === 'Enter' || evento.key === ',') {
      // Se detiene SIEMPRE aquí, haya o no algo que agregar — ver el
      // comentario de la clase sobre por qué Enter nunca debe propagarse.
      evento.preventDefault();
      evento.stopPropagation();

      const i = this.indiceActivo();
      if (i >= 0 && i < lista.length) {
        this.agregar(lista[i]);
        return;
      }
      if (this.permitirNuevas) {
        this.agregar({ id: null, nombre: this.texto() });
      }
      // permitirNuevas=false y sin sugerencia activa: no hace nada (el
      // filtro solo admite etiquetas que ya existen en el catálogo).
      return;
    }
    if (evento.key === 'Backspace' && this.texto() === '') {
      const ultima = this.seleccionadas().at(-1);
      if (ultima) this.quitar(ultima);
    }
  }
}

import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { DataClientService, FiltroBusqueda, FILTRO_BUSQUEDA } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { TicketPrioridad } from './ticket-prioridad.model';

/** Columnas de texto sobre las que busca la caja de búsqueda (clave o
 *  nombre) — Mandato 87, homologación a SAURIX-CAT-001 v1.1. */
const COLUMNAS_BUSQUEDA: (keyof TicketPrioridad & string)[] = ['clave', 'nombre'];

/**
 * Mandato 87 (homologación a SAURIX-CAT-001 v1.1, mismo patrón ya aplicado
 * en Bodegas/Proveedores/Categorías de producto). IMPORTANTE — a
 * diferencia de los otros 3 catálogos homologados en este mismo mandato:
 * esta pantalla es la ÚNICA consumidora de este archivo. Otras 7 pantallas
 * (Kanban, Backlog, Balanceo, Dashboard, Gantt, Reportes ejecutivos,
 * Resumen ejecutivo) llaman DIRECTAMENTE `data.list('TicketPrioridad')`
 * SIN filtro desde sus propios archivos — esa llamada vive fuera de este
 * componente y no se toca aquí; migrar el `cargar()` de ESTA pantalla
 * administrativa a `listarPagina()` con filtro de servidor no les afecta
 * en absoluto (ver auditoría Fase A, Mandato 87, sección 3.5/3.7).
 */
@Component({
  selector: 'app-ticket-prioridades',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent],
  templateUrl: './ticket-prioridades.component.html',
  styleUrl: './ticket-prioridades.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TicketPrioridadesComponent implements OnInit, OnDestroy {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);
  private readonly fb = inject(FormBuilder);

  // ── Listado paginado en servidor ───────────────────────────────────────
  protected readonly prioridadesPagina = signal<TicketPrioridad[]>([]);
  protected readonly totalFiltrado = signal(0);
  protected readonly paginaActual = signal(1);
  protected readonly cargando = signal(false);
  /** Gatea el grid: no se consulta nada hasta que el usuario pulse Buscar
   *  — Mandato 87, elimina la auto-consulta al abrir la pantalla
   *  (incumplimiento crítico detectado en Fase A). */
  protected readonly haBuscado = signal(false);

  protected readonly busquedaEnEdicion = signal('');
  protected readonly mostrarInactivasEnEdicion = signal(false);
  private busquedaAplicada = '';
  private mostrarInactivasAplicado = false;

  private secuencia = 0;

  // ── Modal Nuevo/Editar ──────────────────────────────────────────────────
  protected readonly modalAbierto = signal(false);
  protected readonly prioridadEnEdicion = signal<TicketPrioridad | null>(null);
  protected readonly guardando = signal(false);
  protected readonly avisoCierreVisible = signal(false);

  private valoresOriginales = '';
  private elementoDisparador: HTMLElement | null = null;

  protected readonly prioridadAEliminar = signal<TicketPrioridad | null>(null);

  private readonly primerCampo = viewChild<ElementRef<HTMLInputElement>>('primerCampo');

  protected readonly columnas: ColumnaTabla<TicketPrioridad>[] = [
    { campo: 'clave', etiqueta: 'Clave' },
    { campo: 'nombre', etiqueta: 'Nombre' },
    { campo: 'codigoHex', etiqueta: 'Color', formatear: () => '', colorHex: (fila) => fila.codigoHex },
    { campo: 'vigenciaHoras', etiqueta: 'SLA (hrs)' },
    { campo: 'avisoHoras', etiqueta: 'Aviso (hrs antes)' },
    {
      campo: 'activo',
      etiqueta: 'Activa',
      formatear: (fila) => (fila.activo !== false ? 'Sí' : 'No'),
      claseValor: (fila) => (fila.activo !== false ? 'grid-badge-success' : 'grid-badge-muted'),
    },
    {
      campo: 'critica',
      etiqueta: 'Crítica',
      formatear: (fila) => (fila.critica ? '🚨 Sí' : 'No'),
      claseValor: (fila) => (fila.critica ? 'grid-badge-danger' : 'grid-badge-muted'),
    },
  ];

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    nombre: ['', Validators.required],
    clave: ['', Validators.required],
    codigoHex: ['#ff4f4f', Validators.required],
    // Mínimo 1: con 0 o negativos, el "deadline" del ticket queda en el
    // pasado desde el instante en que se crea (siempre se ve "🔥 Vencido").
    vigenciaHoras: [24, [Validators.required, Validators.min(1)]],
    avisoHoras: [4, [Validators.required, Validators.min(1)]],
    activo: [true],
    critica: [false],
  });

  /** Texto de ayuda "≈ X d Y h" bajo cada campo de horas — sin cambios de
   *  lógica, solo envuelto en el patrón estándar. */
  private readonly vigenciaHorasEnVivo = toSignal(this.form.controls.vigenciaHoras.valueChanges, {
    initialValue: this.form.controls.vigenciaHoras.value,
  });
  protected readonly equivalenciaVigencia = computed(() => this.equivalenciaEnDias(this.vigenciaHorasEnVivo()));

  private readonly avisoHorasEnVivo = toSignal(this.form.controls.avisoHoras.valueChanges, {
    initialValue: this.form.controls.avisoHoras.value,
  });
  protected readonly equivalenciaAviso = computed(() => this.equivalenciaEnDias(this.avisoHorasEnVivo()));

  private equivalenciaEnDias(horas: number): string {
    if (!horas || horas < 24) return '';
    const dias = Math.floor(horas / 24);
    const resto = horas % 24;
    return resto > 0 ? `≈ ${dias} d ${resto} h` : `≈ ${dias} d`;
  }

  constructor() {
    effect(() => {
      if (!this.modalAbierto()) return;
      queueMicrotask(() => this.primerCampo()?.nativeElement.focus());
    });
  }

  ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid'); // ancho completo
  }

  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  // ── Búsqueda y paginación ───────────────────────────────────────────────

  private filtroActual(): Record<string, unknown> {
    const filtro: Record<string, unknown> = {};
    const texto = this.busquedaAplicada.trim();
    if (texto) {
      filtro[FILTRO_BUSQUEDA] = { columnas: COLUMNAS_BUSQUEDA, texto } satisfies FiltroBusqueda;
    }
    if (!this.mostrarInactivasAplicado) filtro['activo'] = true;
    return filtro;
  }

  /** Carga SOLO la página actual de ESTA pantalla administrativa — no debe
   *  confundirse con la llamada `data.list('TicketPrioridad')` SIN filtro
   *  que usan los 7 consumidores externos (ver comentario de la clase):
   *  esa llamada vive en otros archivos y sigue intacta. */
  private cargar(): void {
    this.cargando.set(true);
    const miSecuencia = ++this.secuencia;
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActual() - 1) * tamanio;

    this.data.listarPagina<TicketPrioridad>('TicketPrioridad', this.filtroActual(), desde, tamanio).subscribe({
      next: ({ filas, total }) => {
        if (miSecuencia !== this.secuencia) return;
        this.prioridadesPagina.set(filas);
        this.totalFiltrado.set(total);
        this.cargando.set(false);
      },
      error: () => {
        if (miSecuencia !== this.secuencia) return;
        this.cargando.set(false);
      },
    });
  }

  private reiniciarYCargar(): void {
    this.paginaActual.set(1);
    this.cargar();
  }

  protected buscar(): void {
    this.busquedaAplicada = this.busquedaEnEdicion();
    this.mostrarInactivasAplicado = this.mostrarInactivasEnEdicion();
    this.haBuscado.set(true);
    this.reiniciarYCargar();
  }

  protected limpiarFiltros(): void {
    this.busquedaEnEdicion.set('');
    this.mostrarInactivasEnEdicion.set(false);
  }

  protected onPaginaCambio(pagina: number): void {
    this.paginaActual.set(pagina);
    this.cargar();
  }

  // ── Alta / edición ──────────────────────────────────────────────────────

  nueva(): void {
    this.elementoDisparador = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.prioridadEnEdicion.set(null);
    this.form.reset({
      id: 0,
      nombre: '',
      clave: '',
      codigoHex: '#ff4f4f',
      vigenciaHoras: 24,
      avisoHoras: 4,
      activo: true,
      critica: false,
    });
    this.valoresOriginales = JSON.stringify(this.form.getRawValue());
    this.modalAbierto.set(true);
  }

  editar(prioridad: TicketPrioridad): void {
    this.elementoDisparador = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.prioridadEnEdicion.set(prioridad);
    this.form.reset({
      id: prioridad.id,
      nombre: prioridad.nombre,
      clave: prioridad.clave,
      codigoHex: prioridad.codigoHex,
      vigenciaHoras: prioridad.vigenciaHoras,
      avisoHoras: prioridad.avisoHoras,
      activo: prioridad.activo !== false,
      critica: prioridad.critica === true,
    });
    this.valoresOriginales = JSON.stringify(this.form.getRawValue());
    this.modalAbierto.set(true);
  }

  private hayCambiosSinGuardar(): boolean {
    return JSON.stringify(this.form.getRawValue()) !== this.valoresOriginales;
  }

  private cerrarModal(): void {
    this.modalAbierto.set(false);
    const elemento = this.elementoDisparador;
    this.elementoDisparador = null;
    if (elemento) queueMicrotask(() => elemento.focus());
  }

  protected onClicFondoModal(evento: MouseEvent): void {
    if (evento.isTrusted) return;
    this.cerrarModal();
  }

  protected cancelar(): void {
    if (!this.hayCambiosSinGuardar()) {
      this.cerrarModal();
      return;
    }
    this.avisoCierreVisible.set(true);
  }

  protected confirmarCierreSinGuardar(): void {
    this.avisoCierreVisible.set(false);
    this.cerrarModal();
  }

  protected cancelarCierreSinGuardar(): void {
    this.avisoCierreVisible.set(false);
  }

  protected onTabDentroDelModal(evento: Event): void {
    if (!(evento instanceof KeyboardEvent) || evento.key !== 'Tab') return;
    const contenedor = evento.currentTarget as HTMLElement | null;
    if (!contenedor) return;
    const enfocables = Array.from(
      contenedor.querySelectorAll<HTMLElement>(
        'input, textarea, select, button, [href], [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.hasAttribute('disabled'));
    if (enfocables.length === 0) return;

    const primero = enfocables[0];
    const ultimo = enfocables[enfocables.length - 1];
    const activo = document.activeElement;

    if (evento.shiftKey && activo === primero) {
      evento.preventDefault();
      ultimo.focus();
    } else if (!evento.shiftKey && activo === ultimo) {
      evento.preventDefault();
      primero.focus();
    }
  }

  @HostListener('keydown', ['$event'])
  protected onAtajoTeclado(evento: KeyboardEvent): void {
    if (evento.altKey && !evento.ctrlKey && !evento.metaKey && !this.modalAbierto()) {
      const tecla = evento.key.toLowerCase();
      if (tecla === 'n') {
        evento.preventDefault();
        this.nueva();
        return;
      }
      if (tecla === 'b') {
        evento.preventDefault();
        this.buscar();
        return;
      }
      if (tecla === 'l') {
        evento.preventDefault();
        this.limpiarFiltros();
        return;
      }
    }

    if (evento.ctrlKey && evento.key === 'Enter' && this.modalAbierto()) {
      if (this.form.invalid || this.guardando()) return;
      evento.preventDefault();
      this.guardar();
    }
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    if (this.guardando()) return;

    const valor = this.form.getRawValue();
    const esEdicion = this.prioridadEnEdicion() !== null;
    this.guardando.set(true);
    const peticion = esEdicion
      ? this.data.modificacion<TicketPrioridad>('TicketPrioridad', valor)
      : this.data.alta<TicketPrioridad>('TicketPrioridad', valor);

    peticion.subscribe({
      next: () => {
        this.guardando.set(false);
        this.toast.exito(esEdicion ? 'Prioridad actualizada.' : 'Prioridad creada.');
        this.cerrarModal();
        if (this.haBuscado()) this.cargar();
      },
      error: () => {
        this.guardando.set(false);
        this.toast.error('No se pudo guardar la prioridad. Intenta de nuevo.');
      },
    });
  }

  // ── Eliminación ───────────────────────────────────────────────────────

  pedirEliminar(prioridad: TicketPrioridad): void {
    // Verificación de dependencias antes de borrar — ya cumplía el
    // estándar (Fase A); FK real ya bloquea con NO ACTION, este chequeo
    // solo mejora el mensaje de error. Sin cambios de lógica.
    this.data.list<{ id: number }>('Ticket', { ticketPrioridadId: prioridad.id }).subscribe((tickets) => {
      if (tickets.length > 0) {
        this.toast.advertencia(
          `No se puede eliminar: ${tickets.length} ticket${tickets.length === 1 ? '' : 's'} usa${tickets.length === 1 ? '' : 'n'} esta prioridad.`,
        );
        return;
      }
      this.prioridadAEliminar.set(prioridad);
    });
  }

  confirmarEliminar(): void {
    const prioridad = this.prioridadAEliminar();
    if (!prioridad) return;

    this.data.baja('TicketPrioridad', prioridad.id).subscribe({
      next: () => {
        this.toast.exito('Prioridad eliminada.');
        this.prioridadAEliminar.set(null);
        if (this.prioridadesPagina().length === 1 && this.paginaActual() > 1) {
          this.paginaActual.update((p) => p - 1);
        }
        if (this.haBuscado()) this.cargar();
      },
    });
  }
}

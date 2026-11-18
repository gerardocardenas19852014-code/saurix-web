import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { DataClientService, FiltroBusqueda, FILTRO_BUSQUEDA } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { TicketTipo } from './ticket-tipo.model';

/** Columnas de texto sobre las que busca la caja de búsqueda (clave o
 *  nombre) — Mandato 87, homologación a SAURIX-CAT-001 v1.1. Resuelto
 *  server-side vía FILTRO_BUSQUEDA. */
const COLUMNAS_BUSQUEDA: (keyof TicketTipo & string)[] = ['clave', 'nombre'];

/**
 * Mandato 87 (homologación a SAURIX-CAT-001 v1.1, mismo patrón ya aplicado
 * en Bodegas/Proveedores/Categorías de producto): deja de descargar el
 * catálogo completo (`list()`) y filtrar en memoria — ahora usa
 * `listarPagina()` (paginación real en servidor) y separa el filtro "en
 * edición" del "aplicado": la búsqueda solo se dispara al presionar Buscar
 * o Enter, nunca en cada tecla ni al abrir la pantalla.
 */
@Component({
  selector: 'app-ticket-tipos',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent],
  templateUrl: './ticket-tipos.component.html',
  styleUrl: './ticket-tipos.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TicketTiposComponent implements OnInit, OnDestroy {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);
  private readonly fb = inject(FormBuilder);

  // ── Listado paginado en servidor ───────────────────────────────────────
  protected readonly tiposPagina = signal<TicketTipo[]>([]);
  protected readonly totalFiltrado = signal(0);
  protected readonly paginaActual = signal(1);
  protected readonly cargando = signal(false);
  /** Gatea el grid: no se consulta nada hasta que el usuario pulse Buscar
   *  — Mandato 87, elimina la auto-consulta al abrir la pantalla
   *  (incumplimiento crítico detectado en Fase A). */
  protected readonly haBuscado = signal(false);

  protected readonly busquedaEnEdicion = signal('');
  protected readonly mostrarInactivosEnEdicion = signal(false);
  private busquedaAplicada = '';
  private mostrarInactivosAplicado = false;

  private secuencia = 0;

  // ── Modal Nuevo/Editar ──────────────────────────────────────────────────
  protected readonly modalAbierto = signal(false);
  protected readonly tipoEnEdicion = signal<TicketTipo | null>(null);
  protected readonly guardando = signal(false);
  protected readonly avisoCierreVisible = signal(false);

  private valoresOriginales = '';
  private elementoDisparador: HTMLElement | null = null;

  protected readonly tipoAEliminar = signal<TicketTipo | null>(null);

  private readonly primerCampo = viewChild<ElementRef<HTMLInputElement>>('primerCampo');

  protected readonly columnas: ColumnaTabla<TicketTipo>[] = [
    { campo: 'clave', etiqueta: 'Clave' },
    { campo: 'nombre', etiqueta: 'Nombre' },
    { campo: 'icono', etiqueta: 'Icono' },
    {
      campo: 'activo',
      etiqueta: 'Activo',
      formatear: (fila) => (fila.activo !== false ? 'Sí' : 'No'),
      claseValor: (fila) => (fila.activo !== false ? 'grid-badge-success' : 'grid-badge-muted'),
    },
  ];

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    nombre: ['', Validators.required],
    clave: ['', Validators.required],
    icono: [''],
    activo: [true],
  });

  /** Emojis sugeridos para no dejar la elección del ícono a adivinar un
   *  nombre o código — sin cambios, fuera del alcance del estándar. */
  protected readonly iconosSugeridos: string[] = [
    '🐛', '✨', '🔧', '📋', '❓', '⚠️', '🚀', '🔔', '✅', '🧩', '📌', '🛠️',
  ];

  elegirIcono(icono: string): void {
    this.form.controls.icono.setValue(icono);
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
    if (!this.mostrarInactivosAplicado) filtro['activo'] = true;
    return filtro;
  }

  private cargar(): void {
    this.cargando.set(true);
    const miSecuencia = ++this.secuencia;
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActual() - 1) * tamanio;

    this.data.listarPagina<TicketTipo>('TicketTipo', this.filtroActual(), desde, tamanio).subscribe({
      next: ({ filas, total }) => {
        if (miSecuencia !== this.secuencia) return;
        this.tiposPagina.set(filas);
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
    this.mostrarInactivosAplicado = this.mostrarInactivosEnEdicion();
    this.haBuscado.set(true);
    this.reiniciarYCargar();
  }

  protected limpiarFiltros(): void {
    this.busquedaEnEdicion.set('');
    this.mostrarInactivosEnEdicion.set(false);
  }

  protected onPaginaCambio(pagina: number): void {
    this.paginaActual.set(pagina);
    this.cargar();
  }

  // ── Alta / edición ──────────────────────────────────────────────────────

  nuevo(): void {
    this.elementoDisparador = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.tipoEnEdicion.set(null);
    this.form.reset({ id: 0, nombre: '', clave: '', icono: '', activo: true });
    this.valoresOriginales = JSON.stringify(this.form.getRawValue());
    this.modalAbierto.set(true);
  }

  editar(tipo: TicketTipo): void {
    this.elementoDisparador = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.tipoEnEdicion.set(tipo);
    this.form.reset({
      id: tipo.id,
      nombre: tipo.nombre,
      clave: tipo.clave,
      icono: tipo.icono ?? '',
      activo: tipo.activo !== false,
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
        this.nuevo();
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
    const payload = { ...valor, icono: valor.icono || null };
    const esEdicion = this.tipoEnEdicion() !== null;
    this.guardando.set(true);
    const peticion = esEdicion
      ? this.data.modificacion<TicketTipo>('TicketTipo', payload)
      : this.data.alta<TicketTipo>('TicketTipo', payload);

    peticion.subscribe({
      next: () => {
        this.guardando.set(false);
        this.toast.exito(esEdicion ? 'Tipo actualizado.' : 'Tipo creado.');
        this.cerrarModal();
        if (this.haBuscado()) this.cargar();
      },
      error: () => this.guardando.set(false),
    });
  }

  // ── Eliminación ───────────────────────────────────────────────────────

  pedirEliminar(tipo: TicketTipo): void {
    // Verificación de dependencias antes de borrar — ya cumplía el
    // estándar (Fase A); FK real ya bloquea con NO ACTION, este chequeo
    // solo mejora el mensaje de error. Sin cambios de lógica.
    this.data.list<{ id: number }>('Ticket', { ticketTipoId: tipo.id }).subscribe((tickets) => {
      if (tickets.length > 0) {
        this.toast.advertencia(
          `No se puede eliminar: ${tickets.length} ticket${tickets.length === 1 ? '' : 's'} usa${tickets.length === 1 ? '' : 'n'} este tipo.`,
        );
        return;
      }
      this.tipoAEliminar.set(tipo);
    });
  }

  confirmarEliminar(): void {
    const tipo = this.tipoAEliminar();
    if (!tipo) return;

    this.data.baja('TicketTipo', tipo.id).subscribe({
      next: () => {
        this.toast.exito('Tipo eliminado.');
        this.tipoAEliminar.set(null);
        if (this.tiposPagina().length === 1 && this.paginaActual() > 1) {
          this.paginaActual.update((p) => p - 1);
        }
        if (this.haBuscado()) this.cargar();
      },
    });
  }
}

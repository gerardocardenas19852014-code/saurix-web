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
import { forkJoin } from 'rxjs';
import { DataClientService, FiltroBusqueda, FILTRO_BUSQUEDA } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { Proyecto } from './proyecto.model';

/** Columnas de texto sobre las que busca la caja de búsqueda (clave o
 *  nombre — Mandato 87, homologación a SAURIX-CAT-001 v1.1). Antes la
 *  búsqueda solo cubría `nombre`; `clave` (el prefijo real de folio de
 *  ticket, ej. "SAU") nunca se podía buscar aunque es la columna que el
 *  usuario reconoce. Resuelto server-side, mismo mecanismo FILTRO_BUSQUEDA
 *  que ya usan Usuarios/Categorías de producto. */
const COLUMNAS_BUSQUEDA: (keyof Proyecto & string)[] = ['clave', 'nombre'];

/**
 * Mandato 87 (homologación a SAURIX-CAT-001 v1.1, siguiendo el patrón
 * validado en categorias-producto.component.ts): deja de descargar el
 * catálogo completo (`list()`) y filtrar/paginar en memoria — ahora usa
 * `listarPagina()` (paginación real en servidor) y separa el filtro "en
 * edición" del filtro "aplicado": la búsqueda solo se dispara al presionar
 * Buscar o Enter, nunca en cada tecla ni al abrir la pantalla.
 */
@Component({
  selector: 'app-proyectos-lista',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent],
  templateUrl: './proyectos-lista.component.html',
  styleUrl: './proyectos-lista.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProyectosListaComponent implements OnInit, OnDestroy {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);
  private readonly fb = inject(FormBuilder);

  // ── Listado paginado en servidor ───────────────────────────────────────
  protected readonly proyectosPagina = signal<Proyecto[]>([]);
  protected readonly totalFiltrado = signal(0);
  protected readonly paginaActual = signal(1);
  protected readonly cargando = signal(false);
  /** Gatea el grid: no se consulta ni se muestra nada hasta que el usuario
   *  pulse Buscar (o Alt+B/Ctrl+Enter/Enter en el campo) — Mandato 87,
   *  elimina la auto-consulta al abrir la pantalla (incumplimiento crítico
   *  detectado en Fase A). */
  protected readonly haBuscado = signal(false);

  /** Filtro "en edición" — lo que el usuario está escribiendo/marcando
   *  todavía, sin aplicar. */
  protected readonly busquedaEnEdicion = signal('');
  protected readonly mostrarInactivosEnEdicion = signal(false);
  /** Filtro realmente consultado al servidor — solo cambia al presionar
   *  Buscar/Enter; Limpiar filtros NO lo toca, solo limpia "en edición". */
  private busquedaAplicada = '';
  private mostrarInactivosAplicado = false;

  /** Contador de secuencia anti-respuestas-tardías. */
  private secuencia = 0;

  // ── Modal Nuevo/Editar ──────────────────────────────────────────────────
  protected readonly modalAbierto = signal(false);
  protected readonly proyectoEnEdicion = signal<Proyecto | null>(null);
  protected readonly guardando = signal(false);
  protected readonly avisoCierreVisible = signal(false);

  private valoresOriginales = '';
  private elementoDisparador: HTMLElement | null = null;

  protected readonly proyectoAEliminar = signal<Proyecto | null>(null);

  private readonly primerCampo = viewChild<ElementRef<HTMLInputElement>>('primerCampo');

  protected readonly columnas: ColumnaTabla<Proyecto>[] = [
    { campo: 'clave', etiqueta: 'Clave' },
    { campo: 'nombre', etiqueta: 'Nombre' },
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
    clave: ['', [Validators.required, Validators.maxLength(6)]],
    codigoHex: ['#4f8cff', Validators.required],
    activo: [true],
  });

  constructor() {
    // Autofocus en el primer campo (Nombre) apenas el modal aparece en el DOM.
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

  /** Carga SOLO la página actual con el filtro ya aplicado — nunca el
   *  catálogo completo. */
  private cargar(): void {
    this.cargando.set(true);
    const miSecuencia = ++this.secuencia;
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActual() - 1) * tamanio;

    this.data.listarPagina<Proyecto>('Proyecto', this.filtroActual(), desde, tamanio).subscribe({
      next: ({ filas, total }) => {
        if (miSecuencia !== this.secuencia) return; // respuesta vieja, se descarta
        this.proyectosPagina.set(filas);
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

  /** Dispara la búsqueda real — solo se llama al presionar "Buscar" o Enter
   *  dentro del campo de búsqueda (nunca en cada tecla). */
  protected buscar(): void {
    this.busquedaAplicada = this.busquedaEnEdicion();
    this.mostrarInactivosAplicado = this.mostrarInactivosEnEdicion();
    this.haBuscado.set(true);
    this.reiniciarYCargar();
  }

  /** Solo restablece los campos "en edición" — a propósito NO dispara
   *  ninguna consulta: el listado sigue mostrando lo último realmente
   *  buscado hasta que se presione Buscar de nuevo, ya con los campos
   *  limpios. */
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
    this.proyectoEnEdicion.set(null);
    this.form.reset({ id: 0, nombre: '', clave: '', codigoHex: '#4f8cff', activo: true });
    this.valoresOriginales = JSON.stringify(this.form.getRawValue());
    this.modalAbierto.set(true);
  }

  editar(proyecto: Proyecto): void {
    this.elementoDisparador = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.proyectoEnEdicion.set(proyecto);
    this.form.reset({
      id: proyecto.id,
      nombre: proyecto.nombre,
      clave: proyecto.clave,
      codigoHex: proyecto.codigoHex,
      activo: proyecto.activo !== false,
    });
    this.valoresOriginales = JSON.stringify(this.form.getRawValue());
    this.modalAbierto.set(true);
  }

  private hayCambiosSinGuardar(): boolean {
    return JSON.stringify(this.form.getRawValue()) !== this.valoresOriginales;
  }

  /** Único punto de cierre real del modal — restaura el foco al elemento
   *  que lo abrió. */
  private cerrarModal(): void {
    this.modalAbierto.set(false);
    const elemento = this.elementoDisparador;
    this.elementoDisparador = null;
    if (elemento) queueMicrotask(() => elemento.focus());
  }

  /** Clic en el fondo del modal: se ignora cualquier clic real del usuario
   *  (`isTrusted`) — lo único que llega a ejecutar un cierre es un clic
   *  SINTÉTICO ya decidido en otro lado (Escape sin cambios, o la
   *  confirmación del aviso global "Cambios sin guardar" de
   *  ShellComponent, que ya cubre clic-afuera/Escape CON cambios
   *  pendientes para todos los modales de Saurix). */
  protected onClicFondoModal(evento: MouseEvent): void {
    if (evento.isTrusted) return;
    this.cerrarModal();
  }

  /** Botón Cancelar: ShellComponent no protege este camino — se repite
   *  aquí el mismo criterio de forma local. */
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

  /** Trampa de foco: mientras el modal está abierto, Tab/Shift+Tab nunca
   *  debe sacar el foco hacia el resto de la página. */
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

  /** Atajos de teclado del estándar — Alt+N/B/L para la barra (modal
   *  cerrado) y Ctrl+Enter para guardar (modal abierto). Escape ya queda
   *  cubierto sin código adicional por el mecanismo global de
   *  ShellComponent. */
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
    if (this.guardando()) return; // evita doble envío (doble click/doble Enter)

    const valor = this.form.getRawValue();
    const payload = { ...valor, clave: valor.clave.toUpperCase() };

    // Ticket.numeroTicket se arma con Proyecto.clave como prefijo
    // (folioSugerido() en KanbanComponent) — dos proyectos con la misma
    // clave pueden terminar generando el mismo folio de ticket sin que
    // nadie lo note. Validación client-side preservada tal cual (Mandato
    // 87 no la toca); en carrera, el constraint real UNIQUE(empresa_id,
    // clave) de BD la respalda.
    const claveDuplicada = this.proyectosPagina().some(
      (p) => p.clave.toUpperCase() === payload.clave && Number(p.id) !== Number(payload.id),
    );
    if (claveDuplicada) {
      this.toast.advertencia(`Ya existe un proyecto con la clave "${payload.clave}".`);
      return;
    }

    const esEdicion = this.proyectoEnEdicion() !== null;
    this.guardando.set(true);
    const peticion = esEdicion
      ? this.data.modificacion<Proyecto>('Proyecto', payload)
      : this.data.alta<Proyecto>('Proyecto', payload);

    peticion.subscribe({
      next: () => {
        this.guardando.set(false);
        this.toast.exito(esEdicion ? 'Proyecto actualizado.' : 'Proyecto creado.');
        this.cerrarModal();
        // No recargar si todavía no se ha ejecutado ninguna búsqueda
        // (evita una carga implícita que violaría la regla de "solo
        // consultar al pulsar Buscar").
        if (this.haBuscado()) this.cargar();
      },
      error: () => this.guardando.set(false),
    });
  }

  // ── Eliminación ───────────────────────────────────────────────────────

  pedirEliminar(proyecto: Proyecto): void {
    // Verificación de dependencias antes de borrar: Ticket y
    // TableroColumna ya se revisaban; Mandato 87 Fase B añade Sprint (las
    // 3 tienen ON DELETE CASCADE real en BD — ver auditoría Fase A — así
    // que sin este chequeo, borrar un proyecto con sprints creados pero
    // sin tickets/columnas cascadearía esos sprints en silencio).
    forkJoin([
      this.data.list<{ id: number }>('Ticket', { proyectoId: proyecto.id }),
      this.data.list<{ id: number }>('TableroColumna', { proyectoId: proyecto.id }),
      this.data.list<{ id: number }>('Sprint', { proyectoId: proyecto.id }),
    ]).subscribe(([tickets, columnas, sprints]) => {
      if (tickets.length > 0) {
        this.toast.advertencia(
          `No se puede eliminar: el proyecto tiene ${tickets.length} ticket${tickets.length === 1 ? '' : 's'}. Elimínalos primero.`,
        );
        return;
      }
      if (columnas.length > 0) {
        this.toast.advertencia(
          `No se puede eliminar: el proyecto tiene ${columnas.length} columna${columnas.length === 1 ? '' : 's'} configurada${columnas.length === 1 ? '' : 's'} en su tablero. Elimínalas primero en Gestor de Estados.`,
        );
        return;
      }
      if (sprints.length > 0) {
        this.toast.advertencia(
          `No se puede eliminar: el proyecto tiene ${sprints.length} sprint${sprints.length === 1 ? '' : 's'} creado${sprints.length === 1 ? '' : 's'}. Elimínalo${sprints.length === 1 ? '' : 's'} primero.`,
        );
        return;
      }
      this.proyectoAEliminar.set(proyecto);
    });
  }

  confirmarEliminar(): void {
    const proyecto = this.proyectoAEliminar();
    if (!proyecto) return;

    this.data.baja('Proyecto', proyecto.id).subscribe({
      next: () => {
        this.toast.exito('Proyecto eliminado.');
        this.proyectoAEliminar.set(null);
        if (this.proyectosPagina().length === 1 && this.paginaActual() > 1) {
          this.paginaActual.update((p) => p - 1);
        }
        if (this.haBuscado()) this.cargar();
      },
    });
  }
}

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
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import {
  DataClientService,
  FiltroBusqueda,
  FILTRO_BUSQUEDA,
} from '../../../core/services/data-client.service';
import { BitacoraComponent } from '../../../shared/components/bitacora/bitacora.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { BitacoraService } from '../../../shared/services/bitacora.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { ToastService } from '../../../shared/services/toast.service';
import { exportarCsv } from '../../../shared/utils/csv.util';
import { TipoSistema } from './tipo-sistema.model';

const MODULO_BITACORA = 'WikiDocs / Tipo de sistema';
const ENTIDAD = 'TipoSistema';
const COLUMNAS_BUSQUEDA: (keyof TipoSistema & string)[] = ['nombre'];
/** Mismo tamaño de lote que exportarUsuariosCsv() (usuarios-list.component.ts)
 *  y exportarCsvHistorial() (movimientos-bodega.component.ts) — exportar
 *  trae TODO lo que cumple el filtro aplicado en lotes, nunca una sola
 *  petición gigante ni solo la página visible. */
const TAMANO_LOTE_EXPORTAR = 1000;
/** Tope razonable para la verificación de nombre duplicado (ver
 *  existeDuplicado() más abajo) — un catálogo de "tipos de sistema" nunca
 *  debería acercarse a esta cifra; si algún día la superara, el chequeo
 *  simplemente dejaría de examinar el resto (no es un límite de guardado,
 *  solo de la verificación previa). */
const TOPE_VERIFICACION_DUPLICADO = 1000;

/**
 * Catálogo "Tipo de sistema" (raíz de la jerarquía documental de WikiDocs:
 * TipoSistema → Categoria → Sección → Documento).
 *
 * Fase B de homologación SAURIX-CAT-001 v1.1 (mandato "WikiDocs:
 * estandarización y organización del menú", nov-2026) — mismo estándar que
 * Bodegas/Categorías de producto: paginación/orden real en servidor, sin
 * auto-consulta al abrir (`haBuscado`), filtros en-edición/aplicados,
 * protecciones completas de modal, atajos de teclado y columna "Activo" +
 * "Mostrar inactivos". Se conservan intactas las dos funcionalidades propias
 * de este catálogo que NO son parte del estándar: exportar CSV y
 * `<app-bitacora>` (registro de auditoría).
 *
 * Validación de nombre duplicado: no existe ningún índice único real en
 * `wikidocs.tipo_sistema` que la respalde (verificado contra producción en
 * la auditoría de Fase A) y este mandato no autoriza crear uno — por eso se
 * mantiene una verificación previa en el cliente (ver existeDuplicado()),
 * ahora hecha con una consulta dedicada en vez de mirar el arreglo en
 * memoria (que con paginación real ya no contiene el catálogo completo).
 * Sigue siendo no atómica (mismo riesgo residual ya documentado para otros
 * catálogos de Saurix sin índice único de respaldo), pero preserva el
 * comportamiento que el usuario ya conocía.
 */
@Component({
  selector: 'app-tipo-sistema-list',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, BitacoraComponent],
  templateUrl: './tipo-sistema-list.component.html',
  styleUrl: './tipo-sistema-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TipoSistemaListComponent implements OnInit, OnDestroy {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly bitacora = inject(BitacoraService);
  private readonly auth = inject(AuthService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);

  // ── Listado paginado en servidor ─────────────────────────────────────────
  protected readonly registrosPagina = signal<TipoSistema[]>([]);
  protected readonly totalFiltrado = signal(0);
  protected readonly paginaActual = signal(1);
  protected readonly cargando = signal(false);
  /** false hasta la primera búsqueda — nunca se consulta nada al abrir la
   *  pantalla (ver ngOnInit()). */
  protected readonly haBuscado = signal(false);

  protected readonly columnaOrden = signal<keyof TipoSistema & string>('nombre');
  protected readonly direccionOrden = signal<'asc' | 'desc'>('asc');

  protected readonly busquedaEnEdicion = signal('');
  protected readonly mostrarInactivosEnEdicion = signal(false);
  private busquedaAplicada = '';
  private mostrarInactivosAplicado = false;

  /** Guardia de secuencia anti-respuestas-tardías. */
  private secuencia = 0;

  // ── Modal Nuevo/Editar ────────────────────────────────────────────────────
  protected readonly modalAbierto = signal(false);
  protected readonly registroEnEdicion = signal<TipoSistema | null>(null);
  protected readonly guardando = signal(false);
  protected readonly avisoCierreVisible = signal(false);

  private valoresOriginales = '';
  private elementoDisparador: HTMLElement | null = null;

  protected readonly registroAEliminar = signal<TipoSistema | null>(null);

  private readonly primerCampo = viewChild<ElementRef<HTMLInputElement>>('primerCampo');

  protected readonly columnas: ColumnaTabla<TipoSistema>[] = [
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
    nombre: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(60)]],
    activo: [true],
  });

  constructor() {
    effect(() => {
      if (!this.modalAbierto()) return;
      queueMicrotask(() => this.primerCampo()?.nativeElement.focus());
    });
  }

  ngOnInit(): void {
    // Pantallas de WikiDocs (menos "Inicio"): ancho ampliado, igual que
    // antes — ver comentario histórico en kanban/categorias-producto.
    document.documentElement.setAttribute('data-wide', 'grid');
    // Fase B: no se consulta nada al abrir la pantalla (antes, cargar() se
    // llamaba aquí directo — ver auditoría de Fase A). La cuadrícula
    // arranca vacía con la invitación a buscar (ver plantilla) hasta que el
    // usuario presione "Buscar" o Enter.
  }

  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  // ── Búsqueda, orden y paginación ─────────────────────────────────────────

  private filtroActual(): Record<string, unknown> {
    const filtro: Record<string, unknown> = {};
    const texto = this.busquedaAplicada.trim();
    if (texto) {
      filtro[FILTRO_BUSQUEDA] = { columnas: COLUMNAS_BUSQUEDA, texto } satisfies FiltroBusqueda;
    }
    // Desmarcado = solo activos; marcado = activos e inactivos juntos.
    if (!this.mostrarInactivosAplicado) filtro['activo'] = true;
    return filtro;
  }

  private cargar(): void {
    this.cargando.set(true);
    const miSecuencia = ++this.secuencia;
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActual() - 1) * tamanio;

    this.data
      .listarPagina<TipoSistema>(ENTIDAD, this.filtroActual(), desde, tamanio, {
        columna: this.columnaOrden(),
        direccion: this.direccionOrden(),
      })
      .subscribe({
        next: ({ filas, total }) => {
          if (miSecuencia !== this.secuencia) return;
          this.registrosPagina.set(filas);
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
    this.haBuscado.set(true);
    this.busquedaAplicada = this.busquedaEnEdicion();
    this.mostrarInactivosAplicado = this.mostrarInactivosEnEdicion();
    this.reiniciarYCargar();
  }

  /** Solo restablece los campos "en edición" — no dispara ninguna consulta. */
  protected limpiarFiltros(): void {
    this.busquedaEnEdicion.set('');
    this.mostrarInactivosEnEdicion.set(false);
  }

  protected onPaginaCambio(pagina: number): void {
    this.paginaActual.set(pagina);
    this.cargar();
  }

  protected onOrdenCambio(evento: { campo: keyof TipoSistema & string; direccion: 'asc' | 'desc' }): void {
    this.columnaOrden.set(evento.campo);
    this.direccionOrden.set(evento.direccion);
    this.reiniciarYCargar();
  }

  // ── Exportar CSV ─────────────────────────────────────────────────────────

  /** Exporta TODO lo que cumple el filtro aplicado (no solo la página
   *  visible), pidiéndolo en lotes — mismo mecanismo que
   *  exportarUsuariosCsv() en usuarios-list.component.ts. */
  async exportarCsvArchivo(): Promise<void> {
    const filtro = this.filtroActual();
    const orden = { columna: this.columnaOrden(), direccion: this.direccionOrden() };
    const todas: TipoSistema[] = [];
    let desde = 0;
    let total = Infinity;
    while (desde < total) {
      const { filas, total: totalReal } = await firstValueFrom(
        this.data.listarPagina<TipoSistema>(ENTIDAD, filtro, desde, TAMANO_LOTE_EXPORTAR, orden),
      );
      if (filas.length === 0) break;
      todas.push(...filas);
      total = totalReal;
      desde += TAMANO_LOTE_EXPORTAR;
    }

    exportarCsv(
      'tipos-de-sistema.csv',
      [
        { clave: 'nombre', etiqueta: 'Nombre' },
        { clave: 'activo', etiqueta: 'Activo' },
      ],
      todas.map((f) => ({ nombre: f.nombre, activo: f.activo !== false ? 'Sí' : 'No' })),
    );
    this.toast.exito(`Se descargó tipos-de-sistema.csv (${todas.length} registro${todas.length === 1 ? '' : 's'}).`);
  }

  // ── Alta / edición ───────────────────────────────────────────────────────

  nuevo(): void {
    this.elementoDisparador = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.registroEnEdicion.set(null);
    this.form.reset({ id: 0, nombre: '', activo: true });
    this.valoresOriginales = JSON.stringify(this.form.getRawValue());
    this.modalAbierto.set(true);
  }

  editar(registro: TipoSistema): void {
    this.elementoDisparador = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.registroEnEdicion.set(registro);
    this.form.reset({ id: registro.id, nombre: registro.nombre, activo: registro.activo !== false });
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

  /** Verificación previa de nombre duplicado — no hay índice único real que
   *  la respalde en la base de datos (ver comentario de clase), así que se
   *  hace con una consulta dedicada (no con el arreglo en memoria, que con
   *  paginación real ya no contiene el catálogo completo). No atómica. */
  private async existeDuplicado(nombre: string, idActual: number): Promise<boolean> {
    const { filas } = await firstValueFrom(
      this.data.listarPagina<TipoSistema>(ENTIDAD, {}, 0, TOPE_VERIFICACION_DUPLICADO),
    );
    const nombreNuevo = nombre.trim().toLowerCase();
    return filas.some((r) => r.nombre.trim().toLowerCase() === nombreNuevo && r.id !== idActual);
  }

  async guardar(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    if (this.guardando()) return;

    const valor = this.form.getRawValue();
    const nombre = valor.nombre.trim();

    this.guardando.set(true);
    if (await this.existeDuplicado(nombre, valor.id)) {
      this.guardando.set(false);
      this.toast.error('Ya existe un tipo de sistema con ese nombre.');
      return;
    }

    const registroPrevio = this.registroEnEdicion();
    const esEdicion = registroPrevio !== null;
    const usuarioActual = this.auth.usuarioActual()?.nombreUsuario ?? 'Sistema';
    const payload = { ...valor, nombre };

    const peticion = esEdicion
      ? this.data.modificacion<TipoSistema>(ENTIDAD, payload)
      : this.data.alta<TipoSistema>(ENTIDAD, payload);

    peticion.subscribe({
      next: (resultado) => {
        this.bitacora
          .registrar({
            modulo: MODULO_BITACORA,
            entidad: ENTIDAD,
            accion: esEdicion ? 'Modificación' : 'Alta',
            usuario: usuarioActual,
            registroId: resultado.id,
            anterior: registroPrevio as unknown as Record<string, unknown> | null,
            actual: resultado as unknown as Record<string, unknown>,
          })
          .subscribe();
        this.guardando.set(false);
        this.toast.exito(esEdicion ? 'Tipo de sistema actualizado.' : 'Tipo de sistema creado.');
        this.cerrarModal();
        // Fase B, mismo criterio que Bodegas: no recargar si todavía no se
        // ha ejecutado ninguna búsqueda (evita una carga implícita que el
        // usuario no pidió).
        if (this.haBuscado()) this.cargar();
      },
      error: () => {
        this.guardando.set(false);
        this.toast.error('No se pudo guardar el tipo de sistema. Intenta de nuevo.');
      },
    });
  }

  // ── Eliminación ──────────────────────────────────────────────────────────

  /** No deja eliminar un tipo de sistema que ya tenga categorías apuntándole
   *  (evita dejar categorías huérfanas con un tipoSistemaId inexistente) —
   *  cuenta TODAS las categorías (activas e inactivas), igual que antes. */
  pedirEliminar(registro: TipoSistema): void {
    this.data.listarPagina<{ id: number }>('Categoria', { tipoSistemaId: registro.id }, 0, 1).subscribe(({ total }) => {
      if (total > 0) {
        this.toast.advertencia(
          `No se puede eliminar: ${total} categoría${total === 1 ? '' : 's'} usa${total === 1 ? '' : 'n'} este tipo de sistema.`,
        );
        return;
      }
      this.registroAEliminar.set(registro);
    });
  }

  confirmarEliminar(): void {
    const registro = this.registroAEliminar();
    if (!registro) return;

    this.data.baja(ENTIDAD, registro.id).subscribe({
      next: () => {
        this.bitacora
          .registrar({
            modulo: MODULO_BITACORA,
            entidad: ENTIDAD,
            accion: 'Baja',
            usuario: this.auth.usuarioActual()?.nombreUsuario ?? 'Sistema',
            registroId: registro.id,
            anterior: registro as unknown as Record<string, unknown>,
            actual: null,
          })
          .subscribe();
        this.toast.exito('Tipo de sistema eliminado.');
        this.registroAEliminar.set(null);
        if (this.registrosPagina().length === 1 && this.paginaActual() > 1) {
          this.paginaActual.update((p) => p - 1);
        }
        if (this.haBuscado()) this.cargar();
      },
      error: () => this.toast.error('No se pudo eliminar el tipo de sistema. Intenta de nuevo.'),
    });
  }
}

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
import { TipoSistema } from '../tipo-sistema/tipo-sistema.model';
import { Categoria } from './categoria.model';

const MODULO_BITACORA = 'WikiDocs / Categoría';
const ENTIDAD = 'Categoria';
const COLUMNAS_BUSQUEDA: (keyof Categoria & string)[] = ['nombre'];
const TAMANO_LOTE_EXPORTAR = 1000;
const TOPE_VERIFICACION_DUPLICADO = 1000;

/**
 * Catálogo "Categoría" (WikiDocs) — Categoria exige el Id del Tipo de
 * sistema padre para listar (FK padre obligatorio, igual que TableroColumna
 * en Proyectos): primero se elige el tipo de sistema y solo entonces se
 * cargan/crean sus categorías. El tipoSistemaId NO se pide en el formulario
 * del modal — se toma del selector de arriba.
 *
 * Fase B de homologación SAURIX-CAT-001 v1.1 (mandato "WikiDocs:
 * estandarización y organización del menú", nov-2026). Se conserva el
 * selector de Tipo de sistema EXACTAMENTE como antes: sigue listando TODOS
 * los tipos de sistema, activos e inactivos (decisión explícita — no se
 * filtra por activo para no afectar la posibilidad de seguir administrando
 * categorías bajo un tipo de sistema ya desactivado; ver informe de esta
 * fase). Cargar ese selector al abrir NO es "cargar resultados" (solo llena
 * un combo, mismo criterio que el catálogo de vendedores en Reporte de
 * comisiones).
 *
 * Corrección del Mandato 90.2: la Fase B original SÍ eliminó la
 * auto-carga de la cuadrícula al ABRIR la pantalla, pero dejó que elegir
 * un tipo de sistema (por defecto el primero, o a mano) siguiera
 * disparando la carga de inmediato -- una auto-consulta real, detectada en
 * pruebas visuales. Ahora el selector de Tipo de sistema es un filtro "en
 * edición" más: `tipoSistemaSeleccionadoId` es el valor que el usuario ve
 * en el `<select>`, y `tipoSistemaIdAplicado` es el que realmente usa la
 * consulta -- solo se sincronizan al presionar "Buscar" (o Enter), igual
 * que el texto de búsqueda y "Mostrar inactivas". El selector SÍ se
 * preselecciona (primer tipo de sistema) al abrir, pero esa preselección
 * nunca dispara una consulta por sí sola.
 * Se conservan CSV y `<app-bitacora>`.
 */
@Component({
  selector: 'app-categoria-list',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, BitacoraComponent],
  templateUrl: './categoria-list.component.html',
  styleUrl: './categoria-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategoriaListComponent implements OnInit, OnDestroy {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly bitacora = inject(BitacoraService);
  private readonly auth = inject(AuthService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);

  protected readonly tiposSistema = signal<TipoSistema[]>([]);
  protected readonly tipoSistemaSeleccionadoId = signal<number>(0);

  protected readonly registrosPagina = signal<Categoria[]>([]);
  protected readonly totalFiltrado = signal(0);
  protected readonly paginaActual = signal(1);
  protected readonly cargando = signal(false);
  protected readonly haBuscado = signal(false);

  protected readonly columnaOrden = signal<keyof Categoria & string>('nombre');
  protected readonly direccionOrden = signal<'asc' | 'desc'>('asc');

  protected readonly busquedaEnEdicion = signal('');
  protected readonly mostrarInactivasEnEdicion = signal(false);
  private busquedaAplicada = '';
  private mostrarInactivasAplicado = false;
  /** Tipo de sistema realmente usado en la última búsqueda ejecutada --
   *  independiente del valor "en edición" del selector de arriba (Mandato
   *  90.2: cambiar el selector nunca debe disparar una consulta por sí
   *  solo). */
  private tipoSistemaIdAplicado = 0;
  /** Tipo de sistema congelado para el formulario actualmente abierto
   *  (Mandato 90.2 - verificación de contexto): se fija al abrir el modal
   *  (nuevo() toma el selector en edición; editar() toma el padre REAL del
   *  registro) y nunca se recalcula mientras el modal sigue abierto -- así
   *  guardar()/existeDuplicado() nunca heredan un cambio posterior del
   *  selector en edición, que ahora puede diverger libremente del registro
   *  que se está editando. */
  private tipoSistemaIdFormulario = 0;

  private secuencia = 0;

  protected readonly modalAbierto = signal(false);
  protected readonly registroEnEdicion = signal<Categoria | null>(null);
  protected readonly guardando = signal(false);
  protected readonly avisoCierreVisible = signal(false);

  private valoresOriginales = '';
  private elementoDisparador: HTMLElement | null = null;

  protected readonly registroAEliminar = signal<Categoria | null>(null);

  private readonly primerCampo = viewChild<ElementRef<HTMLInputElement>>('primerCampo');

  protected readonly columnas: ColumnaTabla<Categoria>[] = [
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
    nombre: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
    activo: [true],
  });

  constructor() {
    effect(() => {
      if (!this.modalAbierto()) return;
      queueMicrotask(() => this.primerCampo()?.nativeElement.focus());
    });
  }

  ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid');
    // Llena el selector de Tipo de sistema (no es "cargar resultados" de
    // esta pantalla, solo un combo) y, si hay alguno, selecciona el primero
    // y dispara la carga de SU cuadrícula -- acción equivalente a que el
    // usuario mismo lo eligiera, no una auto-consulta "al abrir" en el
    // sentido que prohíbe la Fase B (ver comentario de clase).
    this.data.list<TipoSistema>('TipoSistema').subscribe({
      next: (tipos) => {
        this.tiposSistema.set(tipos);
        // Mandato 90.2: preseleccionar el primer tipo de sistema en el
        // selector es solo una comodidad visual -- NUNCA dispara la carga
        // de la cuadrícula. El grid arranca vacío (ver plantilla) hasta
        // que el usuario presione "Buscar" o Enter.
        if (tipos.length) this.tipoSistemaSeleccionadoId.set(tipos[0].id);
      },
      error: () => this.toast.error('No se pudieron cargar los tipos de sistema.'),
    });
  }

  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  // ── Selector de padre ────────────────────────────────────────────────────

  /** Mandato 90.2: solo actualiza el selector "en edición" -- nunca
   *  dispara la carga de la cuadrícula. Los resultados ya mostrados (si
   *  los hay) se quedan como estaban hasta que el usuario presione
   *  "Buscar" de nuevo, igual que cualquier otro filtro en edición. */
  cambiarTipoSistema(idTexto: string): void {
    this.tipoSistemaSeleccionadoId.set(Number(idTexto));
  }

  // ── Búsqueda, orden y paginación ─────────────────────────────────────────

  private filtroActual(): Record<string, unknown> {
    const filtro: Record<string, unknown> = { tipoSistemaId: this.tipoSistemaIdAplicado };
    const texto = this.busquedaAplicada.trim();
    if (texto) {
      filtro[FILTRO_BUSQUEDA] = { columnas: COLUMNAS_BUSQUEDA, texto } satisfies FiltroBusqueda;
    }
    if (!this.mostrarInactivasAplicado) filtro['activo'] = true;
    return filtro;
  }

  private cargar(): void {
    const tipoSistemaId = this.tipoSistemaIdAplicado;
    if (!tipoSistemaId) {
      this.registrosPagina.set([]);
      this.totalFiltrado.set(0);
      return;
    }

    this.cargando.set(true);
    const miSecuencia = ++this.secuencia;
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActual() - 1) * tamanio;

    this.data
      .listarPagina<Categoria>(ENTIDAD, this.filtroActual(), desde, tamanio, {
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
    this.tipoSistemaIdAplicado = this.tipoSistemaSeleccionadoId();
    this.busquedaAplicada = this.busquedaEnEdicion();
    this.mostrarInactivasAplicado = this.mostrarInactivasEnEdicion();
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

  protected onOrdenCambio(evento: { campo: keyof Categoria & string; direccion: 'asc' | 'desc' }): void {
    this.columnaOrden.set(evento.campo);
    this.direccionOrden.set(evento.direccion);
    this.reiniciarYCargar();
  }

  // ── Exportar CSV ─────────────────────────────────────────────────────────

  async exportarCsvArchivo(): Promise<void> {
    const filtro = this.filtroActual();
    const orden = { columna: this.columnaOrden(), direccion: this.direccionOrden() };
    const tipoNombre = this.tiposSistema().find((t) => t.id === this.tipoSistemaIdAplicado)?.nombre ?? '';
    const todas: Categoria[] = [];
    let desde = 0;
    let total = Infinity;
    while (desde < total) {
      const { filas, total: totalReal } = await firstValueFrom(
        this.data.listarPagina<Categoria>(ENTIDAD, filtro, desde, TAMANO_LOTE_EXPORTAR, orden),
      );
      if (filas.length === 0) break;
      todas.push(...filas);
      total = totalReal;
      desde += TAMANO_LOTE_EXPORTAR;
    }

    exportarCsv(
      'categorias.csv',
      [
        { clave: 'nombre', etiqueta: 'Nombre' },
        { clave: 'tipoSistemaNombre', etiqueta: 'Tipo de sistema' },
        { clave: 'activo', etiqueta: 'Activo' },
      ],
      todas.map((f) => ({ nombre: f.nombre, tipoSistemaNombre: tipoNombre, activo: f.activo !== false ? 'Sí' : 'No' })),
    );
    this.toast.exito(`Se descargó categorias.csv (${todas.length} registro${todas.length === 1 ? '' : 's'}).`);
  }

  // ── Alta / edición ───────────────────────────────────────────────────────

  nuevo(): void {
    this.elementoDisparador = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.registroEnEdicion.set(null);
    // Mandato 90.2 (verificación): el alta usa el tipo de sistema
    // seleccionado AL ABRIR el formulario, congelado aquí -- si el usuario
    // cambia el selector de arriba mientras el modal sigue abierto, el
    // alta sigue yendo al tipo con el que se abrió.
    this.tipoSistemaIdFormulario = this.tipoSistemaSeleccionadoId();
    this.form.reset({ id: 0, nombre: '', activo: true });
    this.valoresOriginales = JSON.stringify(this.form.getRawValue());
    this.modalAbierto.set(true);
  }

  editar(registro: Categoria): void {
    this.elementoDisparador = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.registroEnEdicion.set(registro);
    // Mandato 90.2 (verificación): la edición conserva el padre REAL del
    // registro (el que ya tenía en la base de datos), nunca el selector en
    // edición -- que puede haber cambiado a otro tipo de sistema sin que
    // el usuario haya vuelto a buscar, mientras la cuadrícula sigue
    // mostrando resultados del tipo anterior.
    this.tipoSistemaIdFormulario = registro.tipoSistemaId;
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

  private async existeDuplicado(nombre: string, idActual: number): Promise<boolean> {
    const { filas } = await firstValueFrom(
      this.data.listarPagina<Categoria>(
        ENTIDAD,
        { tipoSistemaId: this.tipoSistemaIdFormulario },
        0,
        TOPE_VERIFICACION_DUPLICADO,
      ),
    );
    const nombreNuevo = nombre.trim().toLowerCase();
    return filas.some((r) => r.nombre.trim().toLowerCase() === nombreNuevo && r.id !== idActual);
  }

  async guardar(): Promise<void> {
    const tipoSistemaId = this.tipoSistemaIdFormulario;
    if (this.form.invalid || !tipoSistemaId) {
      this.form.markAllAsTouched();
      this.toast.error('Captura el nombre y selecciona un tipo de sistema.');
      return;
    }
    if (this.guardando()) return;

    const valor = this.form.getRawValue();
    const nombre = valor.nombre.trim();

    this.guardando.set(true);
    if (await this.existeDuplicado(nombre, valor.id)) {
      this.guardando.set(false);
      this.toast.error('Ya existe una categoría con ese nombre en este tipo de sistema.');
      return;
    }

    const registroPrevio = this.registroEnEdicion();
    const esEdicion = registroPrevio !== null;
    const usuarioActual = this.auth.usuarioActual()?.nombreUsuario ?? 'Sistema';
    const dto: Categoria = { ...valor, nombre, tipoSistemaId };

    const peticion = esEdicion
      ? this.data.modificacion<Categoria>(ENTIDAD, dto)
      : this.data.alta<Categoria>(ENTIDAD, dto);

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
        this.toast.exito(esEdicion ? 'Categoría actualizada.' : 'Categoría creada.');
        this.cerrarModal();
        if (this.haBuscado()) this.cargar();
      },
      error: () => {
        this.guardando.set(false);
        this.toast.error('No se pudo guardar la categoría. Intenta de nuevo.');
      },
    });
  }

  // ── Eliminación ──────────────────────────────────────────────────────────

  /** No deja eliminar una categoría que ya tenga secciones apuntándole --
   *  cuenta TODAS las secciones (activas e inactivas), igual que antes. */
  pedirEliminar(registro: Categoria): void {
    this.data.listarPagina<{ id: number }>('Seccion', { categoriaId: registro.id }, 0, 1).subscribe(({ total }) => {
      if (total > 0) {
        this.toast.advertencia(
          `No se puede eliminar: ${total} sección${total === 1 ? '' : 'es'} usa${total === 1 ? '' : 'n'} esta categoría.`,
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
        this.toast.exito('Categoría eliminada.');
        this.registroAEliminar.set(null);
        if (this.registrosPagina().length === 1 && this.paginaActual() > 1) {
          this.paginaActual.update((p) => p - 1);
        }
        if (this.haBuscado()) this.cargar();
      },
      error: () => this.toast.error('No se pudo eliminar la categoría. Intenta de nuevo.'),
    });
  }
}

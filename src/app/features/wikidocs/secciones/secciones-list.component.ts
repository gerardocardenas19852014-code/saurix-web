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
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom, forkJoin } from 'rxjs';
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
import { Categoria } from '../categoria/categoria.model';
import { TipoSistema } from '../tipo-sistema/tipo-sistema.model';
import { Seccion } from './seccion.model';

const MODULO_BITACORA = 'WikiDocs / Secciones';
const ENTIDAD = 'Seccion';
const COLUMNAS_BUSQUEDA: (keyof Seccion & string)[] = ['nombre'];
const TAMANO_LOTE_EXPORTAR = 1000;
const TOPE_VERIFICACION_DUPLICADO = 1000;

/**
 * Catálogo "Secciones" (WikiDocs) — Sección exige el Id de la Categoría
 * padre para listar (FK padre obligatorio), y Categoría a su vez exige el
 * Id del Tipo de sistema. Por eso la pantalla encadena dos selectores
 * (Tipo de sistema → Categoría) antes de mostrar/administrar sus
 * secciones, igual que TablerosComponent con su selector de Proyecto.
 * Incluye un acceso directo "Ver documentos" hacia el listado de
 * documentos de esa sección (se conserva exactamente igual que antes).
 *
 * Fase B de homologación SAURIX-CAT-001 v1.1 (mandato "WikiDocs:
 * estandarización y organización del menú", nov-2026). Ambos selectores
 * (Tipo de sistema y Categoría) se conservan SIN filtrar por `activo` —
 * misma decisión que en Categoría — para no impedir seguir administrando
 * secciones bajo un padre ya desactivado.
 *
 * Corrección de la condición de carrera (requerida explícitamente por el
 * mandato): el código original lanzaba dos subscribe() independientes
 * (TipoSistema y Categoria) y el segundo, al resolver, calculaba la
 * categoría por defecto usando tipoSistemaSeleccionadoId() -- un valor que
 * el PRIMER subscribe pudo o no haber terminado de asignar todavía, según
 * cuál petición respondiera primero. Aquí ambas cargas se combinan con
 * forkJoin() en un único callback: la selección de valores por defecto
 * (tipo de sistema y categoría iniciales) solo se calcula cuando AMBAS
 * respuestas ya están disponibles, eliminando la dependencia del orden de
 * llegada.
 */
@Component({
  selector: 'app-secciones-list',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, BitacoraComponent],
  templateUrl: './secciones-list.component.html',
  styleUrl: './secciones-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SeccionesListComponent implements OnInit, OnDestroy {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly bitacora = inject(BitacoraService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);

  protected readonly tiposSistema = signal<TipoSistema[]>([]);
  protected readonly tipoSistemaSeleccionadoId = signal<number>(0);
  protected readonly categoriasTodas = signal<Categoria[]>([]);
  protected readonly categoriaSeleccionadaId = signal<number>(0);

  protected readonly categoriasDelTipo = computed(() =>
    this.categoriasTodas().filter((c) => c.tipoSistemaId === this.tipoSistemaSeleccionadoId()),
  );

  protected readonly registrosPagina = signal<Seccion[]>([]);
  protected readonly totalFiltrado = signal(0);
  protected readonly paginaActual = signal(1);
  protected readonly cargando = signal(false);
  protected readonly haBuscado = signal(false);

  protected readonly columnaOrden = signal<keyof Seccion & string>('nombre');
  protected readonly direccionOrden = signal<'asc' | 'desc'>('asc');

  protected readonly busquedaEnEdicion = signal('');
  protected readonly mostrarInactivasEnEdicion = signal(false);
  private busquedaAplicada = '';
  private mostrarInactivasAplicado = false;

  private secuencia = 0;

  protected readonly modalAbierto = signal(false);
  protected readonly registroEnEdicion = signal<Seccion | null>(null);
  protected readonly guardando = signal(false);
  protected readonly avisoCierreVisible = signal(false);

  private valoresOriginales = '';
  private elementoDisparador: HTMLElement | null = null;

  protected readonly registroAEliminar = signal<Seccion | null>(null);

  private readonly primerCampo = viewChild<ElementRef<HTMLInputElement>>('primerCampo');

  protected readonly columnas: ColumnaTabla<Seccion>[] = [
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
    nombre: ['', [Validators.required, Validators.minLength(1), Validators.maxLength(120)]],
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
    // Corrección de la condición de carrera Tipo de sistema / Categoría
    // (ver comentario de clase): ambas cargas de los selectores se esperan
    // juntas con forkJoin antes de calcular cualquier selección por
    // defecto. Igual que en Categoría, esto es "llenar combos", no
    // "cargar resultados" -- lo que la Fase B elimina es la auto-carga de
        // la CUADRÍCULA de secciones, que solo ocurre dentro de
    // seleccionarCategoria() más abajo.
    forkJoin({
      tipos: this.data.list<TipoSistema>('TipoSistema'),
      categorias: this.data.list<Categoria>('Categoria'),
    }).subscribe({
      next: ({ tipos, categorias }) => {
        this.tiposSistema.set(tipos);
        this.categoriasTodas.set(categorias);
        if (!tipos.length) return;
        this.tipoSistemaSeleccionadoId.set(tipos[0].id);
        const primeraDelTipo = categorias.find((c) => c.tipoSistemaId === tipos[0].id);
        if (primeraDelTipo) this.seleccionarCategoria(primeraDelTipo.id);
      },
      error: () => this.toast.error('No se pudieron cargar los tipos de sistema y categorías.'),
    });
  }

  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  // ── Selectores de padres ─────────────────────────────────────────────────

  cambiarTipoSistema(idTexto: string): void {
    const tipoSistemaId = Number(idTexto);
    this.tipoSistemaSeleccionadoId.set(tipoSistemaId);
    const primeraDelTipo = this.categoriasTodas().find((c) => c.tipoSistemaId === tipoSistemaId);
    if (primeraDelTipo) {
      this.seleccionarCategoria(primeraDelTipo.id);
    } else {
      this.categoriaSeleccionadaId.set(0);
      this.haBuscado.set(false);
      this.registrosPagina.set([]);
      this.totalFiltrado.set(0);
    }
  }

  cambiarCategoria(idTexto: string): void {
    this.seleccionarCategoria(Number(idTexto));
  }

  /** Centraliza el cambio de categoría (desde el selector o desde el
   *  autoselect inicial): resetea los filtros propios de esta pantalla y
   *  dispara la carga de inmediato -- acción equivalente a que el usuario
   *  mismo la eligiera, no una auto-consulta "al abrir". */
  private seleccionarCategoria(categoriaId: number): void {
    this.categoriaSeleccionadaId.set(categoriaId);
    this.busquedaEnEdicion.set('');
    this.mostrarInactivasEnEdicion.set(false);
    this.busquedaAplicada = '';
    this.mostrarInactivasAplicado = false;
    this.haBuscado.set(true);
    this.paginaActual.set(1);
    this.cargar();
  }

  // ── Búsqueda, orden y paginación ─────────────────────────────────────────

  private filtroActual(): Record<string, unknown> {
    const filtro: Record<string, unknown> = { categoriaId: this.categoriaSeleccionadaId() };
    const texto = this.busquedaAplicada.trim();
    if (texto) {
      filtro[FILTRO_BUSQUEDA] = { columnas: COLUMNAS_BUSQUEDA, texto } satisfies FiltroBusqueda;
    }
    if (!this.mostrarInactivasAplicado) filtro['activo'] = true;
    return filtro;
  }

  private cargar(): void {
    const categoriaId = this.categoriaSeleccionadaId();
    if (!categoriaId) {
      this.registrosPagina.set([]);
      this.totalFiltrado.set(0);
      return;
    }

    this.cargando.set(true);
    const miSecuencia = ++this.secuencia;
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActual() - 1) * tamanio;

    this.data
      .listarPagina<Seccion>(ENTIDAD, this.filtroActual(), desde, tamanio, {
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

  protected onOrdenCambio(evento: { campo: keyof Seccion & string; direccion: 'asc' | 'desc' }): void {
    this.columnaOrden.set(evento.campo);
    this.direccionOrden.set(evento.direccion);
    this.reiniciarYCargar();
  }

  // ── Ver documentos ───────────────────────────────────────────────────────

  verDocumentos(registro: Seccion): void {
    this.router.navigate(['/wikidocs/secciones', registro.id, 'documentos']);
  }

  // ── Exportar CSV ─────────────────────────────────────────────────────────

  async exportarCsvArchivo(): Promise<void> {
    const filtro = this.filtroActual();
    const orden = { columna: this.columnaOrden(), direccion: this.direccionOrden() };
    const todas: Seccion[] = [];
    let desde = 0;
    let total = Infinity;
    while (desde < total) {
      const { filas, total: totalReal } = await firstValueFrom(
        this.data.listarPagina<Seccion>(ENTIDAD, filtro, desde, TAMANO_LOTE_EXPORTAR, orden),
      );
      if (filas.length === 0) break;
      todas.push(...filas);
      total = totalReal;
      desde += TAMANO_LOTE_EXPORTAR;
    }

    exportarCsv(
      'secciones.csv',
      [
        { clave: 'nombre', etiqueta: 'Nombre' },
        { clave: 'activo', etiqueta: 'Activo' },
      ],
      todas.map((f) => ({ nombre: f.nombre, activo: f.activo !== false ? 'Sí' : 'No' })),
    );
    this.toast.exito(`Se descargó secciones.csv (${todas.length} registro${todas.length === 1 ? '' : 's'}).`);
  }

  // ── Alta / edición ───────────────────────────────────────────────────────

  nuevo(): void {
    this.elementoDisparador = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.registroEnEdicion.set(null);
    this.form.reset({ id: 0, nombre: '', activo: true });
    this.valoresOriginales = JSON.stringify(this.form.getRawValue());
    this.modalAbierto.set(true);
  }

  editar(registro: Seccion): void {
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

  private async existeDuplicado(nombre: string, idActual: number): Promise<boolean> {
    const { filas } = await firstValueFrom(
      this.data.listarPagina<Seccion>(
        ENTIDAD,
        { categoriaId: this.categoriaSeleccionadaId() },
        0,
        TOPE_VERIFICACION_DUPLICADO,
      ),
    );
    const nombreNuevo = nombre.trim().toLowerCase();
    return filas.some((r) => r.nombre.trim().toLowerCase() === nombreNuevo && r.id !== idActual);
  }

  async guardar(): Promise<void> {
    const categoriaId = this.categoriaSeleccionadaId();
    if (this.form.invalid || !categoriaId) {
      this.form.markAllAsTouched();
      this.toast.error('Captura el nombre y selecciona una categoría.');
      return;
    }
    if (this.guardando()) return;

    const valor = this.form.getRawValue();
    const nombre = valor.nombre.trim();

    this.guardando.set(true);
    if (await this.existeDuplicado(nombre, valor.id)) {
      this.guardando.set(false);
      this.toast.error('Ya existe una sección con ese nombre en esta categoría.');
      return;
    }

    const registroPrevio = this.registroEnEdicion();
    const esEdicion = registroPrevio !== null;
    const usuarioActual = this.auth.usuarioActual()?.nombreUsuario ?? 'Sistema';
    const dto: Seccion = { ...valor, nombre, categoriaId };

    const peticion = esEdicion
      ? this.data.modificacion<Seccion>(ENTIDAD, dto)
      : this.data.alta<Seccion>(ENTIDAD, dto);

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
        this.toast.exito(esEdicion ? 'Sección actualizada.' : 'Sección creada.');
        this.cerrarModal();
        if (this.haBuscado()) this.cargar();
      },
      error: () => {
        this.guardando.set(false);
        this.toast.error('No se pudo guardar la sección. Intenta de nuevo.');
      },
    });
  }

  // ── Eliminación ──────────────────────────────────────────────────────────

  /** No deja eliminar una sección que ya tenga documentos apuntándole
   *  (evita dejar documentos huérfanos con un seccionId inexistente) --
   *  cuenta TODOS los documentos (activos e inactivos), igual que antes. */
  pedirEliminar(registro: Seccion): void {
    this.data.listarPagina<{ id: number }>('Documento', { seccionId: registro.id }, 0, 1).subscribe(({ total }) => {
      if (total > 0) {
        this.toast.advertencia(
          `No se puede eliminar: ${total} documento${total === 1 ? '' : 's'} usa${total === 1 ? '' : 'n'} esta sección.`,
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
        this.toast.exito('Sección eliminada.');
        this.registroAEliminar.set(null);
        if (this.registrosPagina().length === 1 && this.paginaActual() > 1) {
          this.paginaActual.update((p) => p - 1);
        }
        if (this.haBuscado()) this.cargar();
      },
      error: () => this.toast.error('No se pudo eliminar la sección. Intenta de nuevo.'),
    });
  }
}

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
import { EditorTextoComponent } from '../../../shared/components/editor-texto/editor-texto.component';
import { BitacoraService } from '../../../shared/services/bitacora.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { ToastService } from '../../../shared/services/toast.service';
import { exportarCsv } from '../../../shared/utils/csv.util';
import { PlantillaDocumento } from './plantilla.model';

const MODULO_BITACORA = 'WikiDocs / Plantillas';
const ENTIDAD = 'PlantillaDocumento';
const COLUMNAS_BUSQUEDA: (keyof PlantillaDocumento & string)[] = ['nombre'];
const TAMANO_LOTE_EXPORTAR = 1000;
const TOPE_VERIFICACION_DUPLICADO = 1000;

/**
 * Catálogo de plantillas de documento — mismo estándar de modal que Tipo
 * de sistema/Categoría/Secciones, solo que además del nombre pide el
 * contenido de partida con el mismo editor visual (app-editor-texto) que
 * usan los documentos reales. Documentos ofrece "Usar plantilla" al crear
 * uno nuevo, precargando este contenido en el formulario.
 *
 * Fase B de homologación SAURIX-CAT-001 v1.1 (mandato "WikiDocs:
 * continuación de Fase B", nov-2026) — mismo estándar que Tipo de
 * sistema/Categoría/Secciones: paginación/orden real en servidor, sin
 * auto-consulta al abrir (`haBuscado`), filtros en-edición/aplicados,
 * protecciones completas de modal, atajos de teclado y "Mostrar
 * inactivas" (el campo `activo` ya existía en modelo/formulario/grid
 * desde antes de esta fase — es el único de los tres catálogos previos
 * que ya lo tenía). Se conservan intactas CSV y `<app-bitacora>`.
 *
 * Sin verificación de dependencias antes de eliminar: a diferencia de los
 * otros catálogos de WikiDocs, Documento NO guarda ningún `plantillaId`
 * (confirmado en documento.model.ts) — "Usar plantilla" solo copia el
 * contenido una vez al crear, así que borrar una plantilla nunca deja
 * nada huérfano (ver auditoría previa).
 *
 * Validación de nombre duplicado: tampoco existe un índice único real que
 * la respalde (misma situación que los otros tres) — se mantiene la
 * verificación previa en el cliente con una consulta dedicada, no
 * atómica, por las mismas razones ya documentadas ahí.
 */
@Component({
  selector: 'app-plantillas-list',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, BitacoraComponent, EditorTextoComponent],
  templateUrl: './plantillas-list.component.html',
  styleUrl: './plantillas-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlantillasListComponent implements OnInit, OnDestroy {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly bitacora = inject(BitacoraService);
  private readonly auth = inject(AuthService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);

  protected readonly registrosPagina = signal<PlantillaDocumento[]>([]);
  protected readonly totalFiltrado = signal(0);
  protected readonly paginaActual = signal(1);
  protected readonly cargando = signal(false);
  protected readonly haBuscado = signal(false);

  protected readonly columnaOrden = signal<keyof PlantillaDocumento & string>('nombre');
  protected readonly direccionOrden = signal<'asc' | 'desc'>('asc');

  protected readonly busquedaEnEdicion = signal('');
  protected readonly mostrarInactivasEnEdicion = signal(false);
  private busquedaAplicada = '';
  private mostrarInactivasAplicado = false;

  private secuencia = 0;

  protected readonly modalAbierto = signal(false);
  protected readonly registroEnEdicion = signal<PlantillaDocumento | null>(null);
  protected readonly guardando = signal(false);
  protected readonly avisoCierreVisible = signal(false);

  private valoresOriginales = '';
  private elementoDisparador: HTMLElement | null = null;

  protected readonly registroAEliminar = signal<PlantillaDocumento | null>(null);

  private readonly primerCampo = viewChild<ElementRef<HTMLInputElement>>('primerCampo');

  protected readonly columnas: ColumnaTabla<PlantillaDocumento>[] = [
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
    contenido: [''],
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
    // Fase B: no se consulta nada al abrir la pantalla (ver auditoría
    // previa) -- la cuadrícula arranca vacía con la invitación a buscar
    // hasta que el usuario presione "Buscar" o Enter.
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
    if (!this.mostrarInactivasAplicado) filtro['activo'] = true;
    return filtro;
  }

  private cargar(): void {
    this.cargando.set(true);
    const miSecuencia = ++this.secuencia;
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActual() - 1) * tamanio;

    this.data
      .listarPagina<PlantillaDocumento>(ENTIDAD, this.filtroActual(), desde, tamanio, {
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

  protected onOrdenCambio(evento: { campo: keyof PlantillaDocumento & string; direccion: 'asc' | 'desc' }): void {
    this.columnaOrden.set(evento.campo);
    this.direccionOrden.set(evento.direccion);
    this.reiniciarYCargar();
  }

  // ── Exportar CSV ─────────────────────────────────────────────────────────

  async exportarCsvArchivo(): Promise<void> {
    const filtro = this.filtroActual();
    const orden = { columna: this.columnaOrden(), direccion: this.direccionOrden() };
    const todas: PlantillaDocumento[] = [];
    let desde = 0;
    let total = Infinity;
    while (desde < total) {
      const { filas, total: totalReal } = await firstValueFrom(
        this.data.listarPagina<PlantillaDocumento>(ENTIDAD, filtro, desde, TAMANO_LOTE_EXPORTAR, orden),
      );
      if (filas.length === 0) break;
      todas.push(...filas);
      total = totalReal;
      desde += TAMANO_LOTE_EXPORTAR;
    }

    exportarCsv(
      'plantillas-de-documento.csv',
      [
        { clave: 'nombre', etiqueta: 'Nombre' },
        { clave: 'activo', etiqueta: 'Activo' },
      ],
      todas.map((f) => ({ nombre: f.nombre, activo: f.activo !== false ? 'Sí' : 'No' })),
    );
    this.toast.exito(`Se descargó plantillas-de-documento.csv (${todas.length} registro${todas.length === 1 ? '' : 's'}).`);
  }

  // ── Alta / edición ───────────────────────────────────────────────────────

  nuevo(): void {
    this.elementoDisparador = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.registroEnEdicion.set(null);
    this.form.reset({ id: 0, nombre: '', contenido: '', activo: true });
    this.valoresOriginales = JSON.stringify(this.form.getRawValue());
    this.modalAbierto.set(true);
  }

  editar(registro: PlantillaDocumento): void {
    this.elementoDisparador = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.registroEnEdicion.set(registro);
    this.form.reset({
      id: registro.id,
      nombre: registro.nombre,
      contenido: registro.contenido,
      activo: registro.activo !== false,
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

  private async existeDuplicado(nombre: string, idActual: number): Promise<boolean> {
    const { filas } = await firstValueFrom(
      this.data.listarPagina<PlantillaDocumento>(ENTIDAD, {}, 0, TOPE_VERIFICACION_DUPLICADO),
    );
    const nombreNuevo = nombre.trim().toLowerCase();
    return filas.some((r) => r.nombre.trim().toLowerCase() === nombreNuevo && r.id !== idActual);
  }

  async guardar(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toast.error('Captura un nombre de al menos 2 caracteres.');
      return;
    }
    if (this.guardando()) return;

    const valor = this.form.getRawValue();
    const nombre = valor.nombre.trim();

    this.guardando.set(true);
    if (await this.existeDuplicado(nombre, valor.id)) {
      this.guardando.set(false);
      this.toast.error('Ya existe una plantilla con ese nombre.');
      return;
    }

    const registroPrevio = this.registroEnEdicion();
    const esEdicion = registroPrevio !== null;
    const usuarioActual = this.auth.usuarioActual()?.nombreUsuario ?? 'Sistema';
    const payload = { ...valor, nombre };

    const peticion = esEdicion
      ? this.data.modificacion<PlantillaDocumento>(ENTIDAD, payload)
      : this.data.alta<PlantillaDocumento>(ENTIDAD, payload);

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
        this.toast.exito(esEdicion ? 'Plantilla actualizada.' : 'Plantilla creada.');
        this.cerrarModal();
        if (this.haBuscado()) this.cargar();
      },
      error: () => {
        this.guardando.set(false);
        this.toast.error('No se pudo guardar la plantilla. Intenta de nuevo.');
      },
    });
  }

  // ── Eliminación ──────────────────────────────────────────────────────────

  /** Sin verificación de dependencias: Documento no guarda ningún
   *  `plantillaId` (ver comentario de clase), así que eliminar una
   *  plantilla nunca deja nada huérfano. */
  pedirEliminar(registro: PlantillaDocumento): void {
    this.registroAEliminar.set(registro);
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
        this.toast.exito('Plantilla eliminada.');
        this.registroAEliminar.set(null);
        if (this.registrosPagina().length === 1 && this.paginaActual() > 1) {
          this.paginaActual.update((p) => p - 1);
        }
        if (this.haBuscado()) this.cargar();
      },
      error: () => this.toast.error('No se pudo eliminar la plantilla. Intenta de nuevo.'),
    });
  }
}

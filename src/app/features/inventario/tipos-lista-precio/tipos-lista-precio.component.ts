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
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { DataClientService, FiltroBusqueda, FILTRO_BUSQUEDA } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { TipoListaPrecio } from './tipo-lista-precio.model';

const COLUMNAS_BUSQUEDA: (keyof TipoListaPrecio & string)[] = ['clave', 'nombre'];

/**
 * Mandato 84 (homologación SAURIX-CAT-001): catálogo "Tipo de lista de
 * precio" llevado al mismo estándar que Categorías de producto. Conserva
 * intacto el botón extra "Ver precios" (accionExtra) hacia la pantalla de
 * Listas de Precios.
 *
 * Chequeo de dependencias antes de eliminar: se verifica PrecioLista
 * (precios ya asignados a esta lista) y Cliente (clientes que la tienen
 * como lista predeterminada). A diferencia de Unidades de medida, el FK
 * `precio_lista_tipo_lista_precio_id_fkey` es ON DELETE CASCADE en la base
 * de datos (confirmado contra producción) — es decir, la base de datos NO
 * rechaza el DELETE por sí sola: si un precio se insertara justo entre este
 * chequeo y la eliminación (condición de carrera), se borraría en cascada
 * sin aviso. Este chequeo cubre el caso real (hoy ambas tablas están
 * vacías en producción), pero cerrar esa ventana por completo requeriría
 * cambiar esa regla a RESTRICT/NO ACTION o envolver el chequeo+borrado en
 * una función transaccional de Supabase — ninguna de las dos se hace aquí
 * sin autorización explícita separada (Mandato 84, restricciones), así que
 * se reporta como riesgo residual pendiente en vez de modificarse.
 */
@Component({
  selector: 'app-tipos-lista-precio',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent],
  templateUrl: './tipos-lista-precio.component.html',
  styleUrl: './tipos-lista-precio.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TiposListaPrecioComponent implements OnInit, OnDestroy {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);

  protected readonly tiposPagina = signal<TipoListaPrecio[]>([]);
  protected readonly totalFiltrado = signal(0);
  protected readonly paginaActual = signal(1);
  protected readonly cargando = signal(false);
  /** false hasta que el usuario presione "Buscar" por primera vez -- nunca
   *  arranca en true: ya no se consulta nada al abrir la pantalla (ver
   *  ngOnInit() más abajo, Mandato 84 "corrección de carga automática
   *  inicial"). Antes de eso la cuadrícula no debe mostrar la tabla vacía
   *  sino una invitación a buscar. */
  protected readonly haBuscado = signal(false);

  protected readonly busquedaEnEdicion = signal('');
  protected readonly mostrarInactivasEnEdicion = signal(false);
  private busquedaAplicada = '';
  private mostrarInactivasAplicado = false;

  private secuencia = 0;

  protected readonly modalAbierto = signal(false);
  protected readonly tipoEnEdicion = signal<TipoListaPrecio | null>(null);
  protected readonly guardando = signal(false);
  protected readonly avisoCierreVisible = signal(false);

  private valoresOriginales = '';
  private elementoDisparador: HTMLElement | null = null;

  protected readonly tipoAEliminar = signal<TipoListaPrecio | null>(null);

  private readonly primerCampo = viewChild<ElementRef<HTMLInputElement>>('primerCampo');

  protected readonly columnas: ColumnaTabla<TipoListaPrecio>[] = [
    { campo: 'clave', etiqueta: 'Clave' },
    { campo: 'nombre', etiqueta: 'Nombre' },
    { campo: 'descripcion', etiqueta: 'Descripción', formatear: (fila) => fila.descripcion ?? '—' },
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
    descripcion: [''],
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
    // Mandato 84: no se consulta nada al abrir la pantalla. La cuadrícula
    // arranca vacía con la invitación a buscar (ver plantilla) hasta que el
    // usuario presione "Buscar" o Enter -- ver buscar() más abajo.
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

  private cargar(): void {
    this.cargando.set(true);
    const miSecuencia = ++this.secuencia;
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActual() - 1) * tamanio;

    this.data.listarPagina<TipoListaPrecio>('TipoListaPrecio', this.filtroActual(), desde, tamanio).subscribe({
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

  // ── Alta / edición ──────────────────────────────────────────────────────

  nuevo(): void {
    this.elementoDisparador = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.tipoEnEdicion.set(null);
    this.form.reset({ id: 0, nombre: '', clave: '', descripcion: '', activo: true });
    this.valoresOriginales = JSON.stringify(this.form.getRawValue());
    this.modalAbierto.set(true);
  }

  editar(tipo: TipoListaPrecio): void {
    this.elementoDisparador = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.tipoEnEdicion.set(tipo);
    this.form.reset({
      id: tipo.id,
      nombre: tipo.nombre,
      clave: tipo.clave,
      descripcion: tipo.descripcion ?? '',
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
    const payload = {
      ...valor,
      nombre: valor.nombre.trim(),
      clave: valor.clave.trim(),
      descripcion: valor.descripcion.trim() || null,
    };
    const esEdicion = this.tipoEnEdicion() !== null;
    this.guardando.set(true);
    const peticion = esEdicion
      ? this.data.modificacion<TipoListaPrecio>('TipoListaPrecio', payload)
      : this.data.alta<TipoListaPrecio>('TipoListaPrecio', payload);

    peticion.subscribe({
      next: () => {
        this.guardando.set(false);
        this.toast.exito(esEdicion ? 'Tipo actualizado.' : 'Tipo creado.');
        this.cerrarModal();
        // Mandato 84, punto 7: no recargar el listado si todavía no se ha
        // ejecutado ninguna búsqueda (evita una carga masiva implícita).
        if (this.haBuscado()) this.cargar();
      },
      error: () => this.guardando.set(false),
    });
  }

  verPrecios(tipo: TipoListaPrecio): void {
    this.router.navigate(['/inventario/listas-precio', tipo.id]);
  }

  // ── Eliminación ───────────────────────────────────────────────────────

  /**
   * Chequeo de dependencias (Mandato 84): PrecioLista.tipoListaPrecioId
   * (precios ya asignados — ON DELETE CASCADE, ver comentario de la
   * clase) y Cliente.listaPrecioPredeterminadaId (ON DELETE SET NULL: un
   * cliente perdería silenciosamente su lista predeterminada). Se bloquea
   * si existe cualquiera de los dos, aunque solo el primero fue pedido
   * explícitamente — el segundo también es una regla de negocio real que
   * esta homologación no debe romper.
   */
  pedirEliminar(tipo: TipoListaPrecio): void {
    forkJoin({
      precios: this.data.listarPagina<{ id: number }>('PrecioLista', { tipoListaPrecioId: tipo.id }, 0, 1),
      clientes: this.data.listarPagina<{ id: number }>('Cliente', { listaPrecioPredeterminadaId: tipo.id }, 0, 1),
    }).subscribe(({ precios, clientes }) => {
      const partes: string[] = [];
      if (precios.total > 0) {
        partes.push(`${precios.total} precio${precios.total === 1 ? '' : 's'} asignado${precios.total === 1 ? '' : 's'}`);
      }
      if (clientes.total > 0) {
        partes.push(`${clientes.total} cliente${clientes.total === 1 ? '' : 's'} con esta lista como predeterminada`);
      }
      if (partes.length > 0) {
        this.toast.advertencia(`No se puede eliminar: tiene ${partes.join(' y ')}.`);
        return;
      }
      this.tipoAEliminar.set(tipo);
    });
  }

  confirmarEliminar(): void {
    const tipo = this.tipoAEliminar();
    if (!tipo) return;
    this.data.baja('TipoListaPrecio', tipo.id).subscribe({
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

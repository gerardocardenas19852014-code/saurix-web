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
import { Bodega } from './bodega.model';

const COLUMNAS_BUSQUEDA: (keyof Bodega & string)[] = ['clave', 'nombre'];

/**
 * Mandato 84 (homologación SAURIX-CAT-001): catálogo "Bodega" llevado al
 * mismo estándar que Categorías de producto.
 *
 * Chequeo de dependencias antes de eliminar — el más amplio de los cuatro
 * catálogos homologados, porque Bodega es la que más tablas reales tiene
 * apuntándole (confirmado contra producción, 9 relaciones en 8 tablas):
 *   - ON DELETE CASCADE (se borrarían filas completas sin aviso):
 *     ExistenciaBodega.bodegaId, ConteoFisico.bodegaId,
 *     NivelMinimoBodega.bodegaId, OrdenCompra.bodegaDestinoId.
 *   - ON DELETE SET NULL (se perdería silenciosamente la referencia a la
 *     bodega en un registro histórico): MovimientoInventario.bodegaOrigenId,
 *     MovimientoInventario.bodegaDestinoId, VentaItem.bodegaId,
 *     DevolucionItem.bodegaId.
 *   - ON DELETE NO ACTION (la propia base de datos ya rechaza el DELETE si
 *     hay filas): LoteProducto.bodegaId.
 * Se bloquea la eliminación si CUALQUIERA de las nueve tiene filas — no
 * solo las que cascadean. Para las que son CASCADE/SET NULL (ocho de las
 * nueve), la base de datos no ofrece ninguna protección propia: este
 * chequeo cubre el caso real, pero — igual que en Proveedores y Tipos de
 * lista de precio — no cierra por completo una condición de carrera
 * teórica (una fila insertada justo entre este chequeo y el borrado se
 * perdería o se desvincularía igual). Cerrar esa ventana por completo
 * requeriría cambiar esas reglas a RESTRICT/NO ACTION o una función
 * transaccional de Supabase — ninguna de las dos se hace aquí sin
 * autorización explícita separada (Mandato 84); se reporta como riesgo
 * residual pendiente, mayor aquí que en los otros tres catálogos por la
 * cantidad de relaciones involucradas.
 */
@Component({
  selector: 'app-bodegas',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent],
  templateUrl: './bodegas.component.html',
  styleUrl: './bodegas.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BodegasComponent implements OnInit, OnDestroy {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);
  private readonly fb = inject(FormBuilder);

  protected readonly bodegasPagina = signal<Bodega[]>([]);
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
  protected readonly bodegaEnEdicion = signal<Bodega | null>(null);
  protected readonly guardando = signal(false);
  protected readonly avisoCierreVisible = signal(false);

  private valoresOriginales = '';
  private elementoDisparador: HTMLElement | null = null;

  protected readonly bodegaAEliminar = signal<Bodega | null>(null);

  private readonly primerCampo = viewChild<ElementRef<HTMLInputElement>>('primerCampo');

  protected readonly columnas: ColumnaTabla<Bodega>[] = [
    { campo: 'clave', etiqueta: 'Clave' },
    { campo: 'nombre', etiqueta: 'Nombre' },
    { campo: 'direccion', etiqueta: 'Dirección', formatear: (fila) => fila.direccion ?? '—' },
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
    direccion: [''],
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

    this.data.listarPagina<Bodega>('Bodega', this.filtroActual(), desde, tamanio).subscribe({
      next: ({ filas, total }) => {
        if (miSecuencia !== this.secuencia) return;
        this.bodegasPagina.set(filas);
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
    this.bodegaEnEdicion.set(null);
    this.form.reset({ id: 0, nombre: '', clave: '', direccion: '', activo: true });
    this.valoresOriginales = JSON.stringify(this.form.getRawValue());
    this.modalAbierto.set(true);
  }

  editar(bodega: Bodega): void {
    this.elementoDisparador = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.bodegaEnEdicion.set(bodega);
    this.form.reset({
      id: bodega.id,
      nombre: bodega.nombre,
      clave: bodega.clave,
      direccion: bodega.direccion ?? '',
      activo: bodega.activo !== false,
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
      direccion: valor.direccion.trim() || null,
    };
    const esEdicion = this.bodegaEnEdicion() !== null;
    this.guardando.set(true);
    const peticion = esEdicion
      ? this.data.modificacion<Bodega>('Bodega', payload)
      : this.data.alta<Bodega>('Bodega', payload);

    peticion.subscribe({
      next: () => {
        this.guardando.set(false);
        this.toast.exito(esEdicion ? 'Bodega actualizada.' : 'Bodega creada.');
        this.cerrarModal();
        // Mandato 84, punto 7: no recargar el listado si todavía no se ha
        // ejecutado ninguna búsqueda (evita una carga masiva implícita).
        if (this.haBuscado()) this.cargar();
      },
      error: () => this.guardando.set(false),
    });
  }

  // ── Eliminación ───────────────────────────────────────────────────────

  pedirEliminar(bodega: Bodega): void {
    const id = bodega.id;
    forkJoin({
      existencias: this.data.listarPagina<{ id: number }>('ExistenciaBodega', { bodegaId: id }, 0, 1),
      conteosFisicos: this.data.listarPagina<{ id: number }>('ConteoFisico', { bodegaId: id }, 0, 1),
      nivelesMinimos: this.data.listarPagina<{ id: number }>('NivelMinimoBodega', { bodegaId: id }, 0, 1),
      ordenesCompraDestino: this.data.listarPagina<{ id: number }>('OrdenCompra', { bodegaDestinoId: id }, 0, 1),
      lotesProducto: this.data.listarPagina<{ id: number }>('LoteProducto', { bodegaId: id }, 0, 1),
      movimientosOrigen: this.data.listarPagina<{ id: number }>('MovimientoInventario', { bodegaOrigenId: id }, 0, 1),
      movimientosDestino: this.data.listarPagina<{ id: number }>(
        'MovimientoInventario',
        { bodegaDestinoId: id },
        0,
        1,
      ),
      ventasConEstaBodega: this.data.listarPagina<{ id: number }>('VentaItem', { bodegaId: id }, 0, 1),
      devolucionesConEstaBodega: this.data.listarPagina<{ id: number }>('DevolucionItem', { bodegaId: id }, 0, 1),
    }).subscribe((resultados) => {
      const etiquetas: [keyof typeof resultados, string][] = [
        ['existencias', 'existencia(s) registrada(s)'],
        ['conteosFisicos', 'conteo(s) físico(s)'],
        ['nivelesMinimos', 'nivel(es) mínimo(s) configurado(s)'],
        ['ordenesCompraDestino', 'orden(es) de compra con destino aquí'],
        ['lotesProducto', 'lote(s) de producto'],
        ['movimientosOrigen', 'movimiento(s) de inventario de origen'],
        ['movimientosDestino', 'movimiento(s) de inventario de destino'],
        ['ventasConEstaBodega', 'venta(s) registrada(s) desde esta bodega'],
        ['devolucionesConEstaBodega', 'devolución(es) registrada(s) con esta bodega'],
      ];
      const partes = etiquetas
        .filter(([clave]) => resultados[clave].total > 0)
        .map(([clave, etiqueta]) => `${resultados[clave].total} ${etiqueta}`);

      if (partes.length > 0) {
        this.toast.advertencia(`No se puede eliminar: tiene ${partes.join(', ')}.`);
        return;
      }
      this.bodegaAEliminar.set(bodega);
    });
  }

  confirmarEliminar(): void {
    const bodega = this.bodegaAEliminar();
    if (!bodega) return;
    this.data.baja('Bodega', bodega.id).subscribe({
      next: () => {
        this.toast.exito('Bodega eliminada.');
        this.bodegaAEliminar.set(null);
        if (this.bodegasPagina().length === 1 && this.paginaActual() > 1) {
          this.paginaActual.update((p) => p - 1);
        }
        if (this.haBuscado()) this.cargar();
      },
    });
  }
}

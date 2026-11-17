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
import { Proveedor } from './proveedor.model';

/** Proveedor no tiene "clave" (ver proveedor.model.ts) — se busca por
 *  nombre y por el contacto capturado. */
const COLUMNAS_BUSQUEDA: (keyof Proveedor & string)[] = ['nombre', 'contacto'];

/**
 * Mandato 84 (homologación SAURIX-CAT-001): catálogo "Proveedor" llevado al
 * mismo estándar que Categorías de producto. Conserva intacto el botón
 * extra "Ver productos" (accionExtra) hacia la pantalla de productos por
 * proveedor.
 *
 * Chequeo de dependencias antes de eliminar: se verifican las tres
 * relaciones reales hacia Proveedor (confirmado contra producción) —
 * Producto.proveedorId (ON DELETE SET NULL), ProductoProveedor.proveedorId
 * (ON DELETE CASCADE) y OrdenCompra.proveedorId (ON DELETE CASCADE). Las
 * dos últimas son especialmente sensibles: sin este chequeo, eliminar un
 * proveedor hoy borraría en cascada, sin aviso, todas sus relaciones de
 * precio/tiempo de entrega por producto Y TODO el historial de órdenes de
 * compra hechas a ese proveedor. Ninguna de las tres tiene ON DELETE
 * RESTRICT/NO ACTION en la base de datos, así que — igual que en Tipos de
 * lista de precio — este chequeo cubre el caso real pero no cierra por
 * completo una condición de carrera teórica (una orden de compra o
 * relación de producto insertada justo entre el chequeo y el borrado se
 * perdería en cascada igual). Cerrar esa ventana requeriría cambiar esas
 * reglas a RESTRICT/NO ACTION o una función transaccional de Supabase —
 * ninguna de las dos se hace aquí sin autorización explícita separada
 * (Mandato 84); se reporta como riesgo residual pendiente.
 */
@Component({
  selector: 'app-proveedores',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent],
  templateUrl: './proveedores.component.html',
  styleUrl: './proveedores.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProveedoresComponent implements OnInit, OnDestroy {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);

  protected readonly proveedoresPagina = signal<Proveedor[]>([]);
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
  protected readonly proveedorEnEdicion = signal<Proveedor | null>(null);
  protected readonly guardando = signal(false);
  protected readonly avisoCierreVisible = signal(false);

  private valoresOriginales = '';
  private elementoDisparador: HTMLElement | null = null;

  protected readonly proveedorAEliminar = signal<Proveedor | null>(null);

  private readonly primerCampo = viewChild<ElementRef<HTMLInputElement>>('primerCampo');

  protected readonly columnas: ColumnaTabla<Proveedor>[] = [
    { campo: 'nombre', etiqueta: 'Nombre' },
    { campo: 'contacto', etiqueta: 'Contacto', formatear: (fila) => fila.contacto ?? '—' },
    { campo: 'telefono', etiqueta: 'Teléfono', formatear: (fila) => fila.telefono ?? '—' },
    { campo: 'correo', etiqueta: 'Correo', formatear: (fila) => fila.correo ?? '—' },
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
    contacto: [''],
    telefono: [''],
    correo: ['', Validators.email],
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

    this.data.listarPagina<Proveedor>('Proveedor', this.filtroActual(), desde, tamanio).subscribe({
      next: ({ filas, total }) => {
        if (miSecuencia !== this.secuencia) return;
        this.proveedoresPagina.set(filas);
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
    this.proveedorEnEdicion.set(null);
    this.form.reset({ id: 0, nombre: '', contacto: '', telefono: '', correo: '', activo: true });
    this.valoresOriginales = JSON.stringify(this.form.getRawValue());
    this.modalAbierto.set(true);
  }

  editar(proveedor: Proveedor): void {
    this.elementoDisparador = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.proveedorEnEdicion.set(proveedor);
    this.form.reset({
      id: proveedor.id,
      nombre: proveedor.nombre,
      contacto: proveedor.contacto ?? '',
      telefono: proveedor.telefono ?? '',
      correo: proveedor.correo ?? '',
      activo: proveedor.activo !== false,
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
      contacto: valor.contacto.trim() || null,
      telefono: valor.telefono.trim() || null,
      correo: valor.correo.trim() || null,
    };
    const esEdicion = this.proveedorEnEdicion() !== null;
    this.guardando.set(true);
    const peticion = esEdicion
      ? this.data.modificacion<Proveedor>('Proveedor', payload)
      : this.data.alta<Proveedor>('Proveedor', payload);

    peticion.subscribe({
      next: () => {
        this.guardando.set(false);
        this.toast.exito(esEdicion ? 'Proveedor actualizado.' : 'Proveedor creado.');
        this.cerrarModal();
        // Mandato 84, punto 7: no recargar el listado si todavía no se ha
        // ejecutado ninguna búsqueda (evita una carga masiva implícita).
        if (this.haBuscado()) this.cargar();
      },
      error: () => this.guardando.set(false),
    });
  }

  verProductos(proveedor: Proveedor): void {
    this.router.navigate(['/inventario/proveedores', proveedor.id]);
  }

  // ── Eliminación ───────────────────────────────────────────────────────

  pedirEliminar(proveedor: Proveedor): void {
    forkJoin({
      comoProveedorDirecto: this.data.listarPagina<{ id: number }>('Producto', { proveedorId: proveedor.id }, 0, 1),
      enRelacionesProductoProveedor: this.data.listarPagina<{ id: number }>(
        'ProductoProveedor',
        { proveedorId: proveedor.id },
        0,
        1,
      ),
      enOrdenesDeCompra: this.data.listarPagina<{ id: number }>('OrdenCompra', { proveedorId: proveedor.id }, 0, 1),
    }).subscribe(({ comoProveedorDirecto, enRelacionesProductoProveedor, enOrdenesDeCompra }) => {
      const partes: string[] = [];
      if (comoProveedorDirecto.total > 0) {
        partes.push(
          `${comoProveedorDirecto.total} producto${comoProveedorDirecto.total === 1 ? '' : 's'} (proveedor directo)`,
        );
      }
      if (enRelacionesProductoProveedor.total > 0) {
        partes.push(
          `${enRelacionesProductoProveedor.total} relación${enRelacionesProductoProveedor.total === 1 ? '' : 'es'} de precio/entrega por producto`,
        );
      }
      if (enOrdenesDeCompra.total > 0) {
        partes.push(
          `${enOrdenesDeCompra.total} orden${enOrdenesDeCompra.total === 1 ? '' : 'es'} de compra`,
        );
      }
      if (partes.length > 0) {
        this.toast.advertencia(`No se puede eliminar: tiene ${partes.join(', ')}.`);
        return;
      }
      this.proveedorAEliminar.set(proveedor);
    });
  }

  confirmarEliminar(): void {
    const proveedor = this.proveedorAEliminar();
    if (!proveedor) return;
    this.data.baja('Proveedor', proveedor.id).subscribe({
      next: () => {
        this.toast.exito('Proveedor eliminado.');
        this.proveedorAEliminar.set(null);
        if (this.proveedoresPagina().length === 1 && this.paginaActual() > 1) {
          this.paginaActual.update((p) => p - 1);
        }
        if (this.haBuscado()) this.cargar();
      },
    });
  }
}

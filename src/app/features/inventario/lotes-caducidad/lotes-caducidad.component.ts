import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { SelectBuscableComponent, OpcionBuscable } from '../../../shared/components/select-buscable/select-buscable.component';
import { ToastService } from '../../../shared/services/toast.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { LoteProducto } from './lote-producto.model';
import { Producto } from '../productos/producto.model';
import { Bodega } from '../bodegas/bodega.model';
import { diasParaCaducar } from './lote-producto.util';

interface FilaLote extends LoteProducto {
  productoNombre: string;
  bodegaNombre: string | null;
  dias: number | null;
}

type FiltroVencimiento = 'todos' | 'proximos' | 'vencidos';

/** Umbral de días para considerar un lote "próximo a vencer" (ver dias en FilaLote). */
const UMBRAL_PROXIMOS_DIAS = 30;

/**
 * Registro de lotes con fecha de caducidad (ver LoteProducto — es un
 * registro INFORMATIVO aparte, no mueve ExistenciaBodega). Solo permite
 * elegir productos con Producto.manejaLotes === true (ver productos.component.ts).
 */
@Component({
  selector: 'app-lotes-caducidad',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, SelectBuscableComponent],
  templateUrl: './lotes-caducidad.component.html',
  styleUrl: './lotes-caducidad.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LotesCaducidadComponent implements OnInit, OnDestroy {
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);
  private readonly fb = inject(FormBuilder);

  protected readonly lotes = signal<LoteProducto[]>([]);
  protected readonly productos = signal<Producto[]>([]);
  protected readonly bodegas = signal<Bodega[]>([]);
  protected readonly cargando = signal(false);
  protected readonly mostrarInactivos = signal(false);
  protected readonly filtroVencimiento = signal<FiltroVencimiento>('todos');

  protected readonly productosConLotes = computed(() => this.productos().filter((p) => p.manejaLotes && p.activo));
  protected readonly bodegasActivas = computed(() => this.bodegas().filter((b) => b.activo !== false));

  protected readonly opcionesProducto = computed<OpcionBuscable[]>(() =>
    this.productosConLotes().map((p) => ({ valor: p.id, etiqueta: p.nombre })),
  );
  protected readonly opcionesBodega = computed<OpcionBuscable[]>(() =>
    this.bodegasActivas().map((b) => ({ valor: b.id, etiqueta: b.nombre })),
  );

  private nombreProducto(id: number): string {
    return this.productos().find((p) => p.id === id)?.nombre ?? '—';
  }
  private nombreBodega(id: number | null): string | null {
    if (id === null) return null;
    return this.bodegas().find((b) => b.id === id)?.nombre ?? '—';
  }

  protected readonly filasLotes = computed<FilaLote[]>(() => {
    const base = this.lotes()
      .filter((l) => this.mostrarInactivos() || l.activo)
      .map((l) => ({
        ...l,
        productoNombre: this.nombreProducto(l.productoId),
        bodegaNombre: this.nombreBodega(l.bodegaId),
        dias: diasParaCaducar(l.fechaCaducidad),
      }));

    const filtro = this.filtroVencimiento();
    if (filtro === 'proximos') return base.filter((f) => f.dias !== null && f.dias >= 0 && f.dias <= UMBRAL_PROXIMOS_DIAS);
    if (filtro === 'vencidos') return base.filter((f) => f.dias !== null && f.dias < 0);
    return base;
  });

  protected readonly totalProximos = computed(
    () => this.lotes().filter((l) => l.activo && (diasParaCaducar(l.fechaCaducidad) ?? Infinity) >= 0 && (diasParaCaducar(l.fechaCaducidad) ?? Infinity) <= UMBRAL_PROXIMOS_DIAS).length,
  );
  protected readonly totalVencidos = computed(
    () => this.lotes().filter((l) => l.activo && (diasParaCaducar(l.fechaCaducidad) ?? 1) < 0).length,
  );

  protected readonly modalAbierto = signal(false);
  protected readonly loteEnEdicion = signal<LoteProducto | null>(null);
  protected readonly loteAEliminar = signal<LoteProducto | null>(null);

  protected readonly columnas: ColumnaTabla<FilaLote>[] = [
    { campo: 'productoNombre', etiqueta: 'Producto' },
    { campo: 'lote', etiqueta: 'Lote' },
    { campo: 'bodegaNombre', etiqueta: 'Bodega', formatear: (fila) => fila.bodegaNombre ?? '—' },
    { campo: 'cantidad', etiqueta: 'Cantidad', formatear: (fila) => (fila.cantidad === null ? '—' : String(fila.cantidad)) },
    { campo: 'fechaCaducidad', etiqueta: 'Caducidad', formatear: (fila) => fila.fechaCaducidad ?? '—' },
    {
      campo: 'dias',
      etiqueta: 'Días',
      formatear: (fila) => (fila.dias === null ? '—' : fila.dias < 0 ? `Vencido (${-fila.dias}d)` : `${fila.dias}d`),
      claseValor: (fila) =>
        fila.dias === null ? '' : fila.dias < 0 ? 'grid-badge-danger' : fila.dias <= UMBRAL_PROXIMOS_DIAS ? 'grid-badge-warning' : 'grid-badge-success',
    },
    {
      campo: 'activo',
      etiqueta: 'Activo',
      formatear: (fila) => (fila.activo ? 'Sí' : 'No'),
      claseValor: (fila) => (fila.activo ? 'grid-badge-success' : 'grid-badge-muted'),
    },
  ];

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    productoId: [0, Validators.required],
    bodegaId: [0],
    lote: ['', Validators.required],
    fechaCaducidad: [''],
    cantidad: [null as number | null],
    notas: [''],
    activo: [true],
  });

  ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid'); // ancho completo
    this.cargar();
  }

  private cargar(): void {
    this.cargando.set(true);
    Promise.all([
      firstValueFrom(this.data.list<LoteProducto>('LoteProducto')),
      firstValueFrom(this.data.list<Producto>('Producto')),
      firstValueFrom(this.data.list<Bodega>('Bodega')),
    ]).then(([lotes, productos, bodegas]) => {
      this.lotes.set(lotes);
      this.productos.set(productos);
      this.bodegas.set(bodegas);
      this.cargando.set(false);
    });
  }

  nuevo(): void {
    this.loteEnEdicion.set(null);
    this.form.reset({ id: 0, productoId: 0, bodegaId: 0, lote: '', fechaCaducidad: '', cantidad: null, notas: '', activo: true });
    this.modalAbierto.set(true);
  }

  editar(lote: LoteProducto): void {
    this.loteEnEdicion.set(lote);
    this.form.reset({
      id: lote.id,
      productoId: lote.productoId,
      bodegaId: lote.bodegaId ?? 0,
      lote: lote.lote,
      fechaCaducidad: lote.fechaCaducidad ?? '',
      cantidad: lote.cantidad,
      notas: lote.notas ?? '',
      activo: lote.activo,
    });
    this.modalAbierto.set(true);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const valor = this.form.getRawValue();
    const payload = {
      ...valor,
      bodegaId: valor.bodegaId || null,
      fechaCaducidad: valor.fechaCaducidad || null,
      notas: valor.notas || null,
    };
    const esEdicion = this.loteEnEdicion() !== null;
    const peticion = esEdicion
      ? this.data.modificacion<LoteProducto>('LoteProducto', payload)
      : this.data.alta<LoteProducto>('LoteProducto', payload);

    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? 'Lote actualizado.' : 'Lote creado.');
        this.modalAbierto.set(false);
        this.cargar();
      },
    });
  }

  pedirEliminar(lote: LoteProducto): void {
    this.loteAEliminar.set(lote);
  }

  confirmarEliminar(): void {
    const lote = this.loteAEliminar();
    if (!lote) return;

    this.data.baja('LoteProducto', lote.id).subscribe({
      next: () => {
        this.toast.exito('Lote eliminado.');
        this.loteAEliminar.set(null);
        this.cargar();
      },
    });
  }
}

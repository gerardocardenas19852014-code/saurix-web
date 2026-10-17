import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { ToastService } from '../../../shared/services/toast.service';
import { SelectBuscableComponent, OpcionBuscable } from '../../../shared/components/select-buscable/select-buscable.component';
import { EscaneoCodigoComponent } from '../../../shared/components/escaneo-codigo/escaneo-codigo.component';
import { Producto } from '../productos/producto.model';
import { Bodega } from '../bodegas/bodega.model';
import { ExistenciaBodega } from './existencia-bodega.model';
import { MovimientoInventario } from './movimiento-inventario.model';
import { MovimientoInventarioService } from './movimiento-inventario.service';
import { exportarCsv } from '../../../shared/utils/csv.util';
import { exportarTablaPdf } from '../../../shared/utils/pdf-tabla.util';

type TipoMovimiento = 'entrada' | 'traspaso' | 'salida';
type TabMovimientosBodega = 'existencia' | 'historial' | 'transito';

interface FilaSinAsignar {
  productoId: number;
  codigo: string;
  nombre: string;
  cantidad: number;
}

interface FilaExistencia {
  id: number;
  productoNombre: string;
  bodegaNombre: string;
  existencia: number;
  ubicacion: string | null;
}

interface FilaHistorial {
  id: number;
  fecha: string;
  productoId: number;
  productoNombre: string;
  bodegaOrigenId: number | null;
  bodegaDestinoId: number | null;
  origenNombre: string | null;
  destinoNombre: string | null;
  tipo: TipoMovimiento;
  cantidad: number;
  nota: string | null;
  /** Ver MovimientoInventario.enTransito/fechaRecepcion — solo aplica a
   *  tipo === 'traspaso'. */
  enTransito: boolean;
  fechaRecepcion: string | null;
}

/**
 * "Opera fácilmente con distintas bodegas": entradas (mercancía nueva, o la
 * asignación inicial de la existencia que un producto ya traía antes de
 * este módulo — ver asignarABodega()), traspasos de cantidad entre
 * bodegas, y salidas/ajustes (mermas, daños, correcciones de conteo), con
 * su historial completo abajo — filtrable por producto, bodega y fecha.
 *
 * La fuente real de "cuánto hay de qué, en dónde" es ExistenciaBodega (ver
 * ese modelo) — Producto.existencia solo se sigue usando como respaldo
 * mientras un producto no tenga todavía ningún registro aquí (ver
 * existenciaTotal() en producto.util.ts). Por eso un traspaso o una salida
 * exigen que el producto YA tenga al menos una bodega asignada: si no, hay
 * que asignarlo primero (ver la sección "sin asignar" de abajo).
 */
@Component({
  selector: 'app-movimientos-bodega',
  standalone: true,
  imports: [ReactiveFormsModule, SelectBuscableComponent, EscaneoCodigoComponent, DatePipe],
  templateUrl: './movimientos-bodega.component.html',
  styleUrl: './movimientos-bodega.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MovimientosBodegaComponent implements OnInit, OnDestroy {
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly movimientoService = inject(MovimientoInventarioService);

  protected readonly productos = signal<Producto[]>([]);
  protected readonly bodegas = signal<Bodega[]>([]);
  protected readonly existenciasBodega = signal<ExistenciaBodega[]>([]);
  protected readonly movimientos = signal<MovimientoInventario[]>([]);
  protected readonly cargando = signal(false);
  protected readonly guardando = signal(false);
  protected readonly tabActiva = signal<TabMovimientosBodega>('existencia');

  seleccionarTab(tab: TabMovimientosBodega): void {
    this.tabActiva.set(tab);
  }

  /** Solo productos físicos (existencia !== null) y activos — mismo criterio
   *  que Valor de stock (ver valor-stock.component.ts). */
  protected readonly productosFisicosActivos = computed(() =>
    this.productos().filter((p) => p.activo && p.existencia !== null),
  );
  protected readonly bodegasActivas = computed(() => this.bodegas().filter((b) => b.activo !== false));

  protected readonly opcionesProducto = computed<OpcionBuscable[]>(() =>
    this.productosFisicosActivos().map((p) => ({ valor: p.id, etiqueta: p.nombre })),
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

  /** Cuánto hay de un producto en una bodega concreta — 0 si no hay registro. */
  protected existenciaEnBodega(productoId: number, bodegaId: number): number {
    return this.existenciasBodega().find((e) => e.productoId === productoId && e.bodegaId === bodegaId)?.existencia ?? 0;
  }

  /** Productos físicos activos con existencia heredada (> 0) pero todavía
   *  SIN ningún registro en ExistenciaBodega — no se pueden traspasar ni
   *  dar de salida hasta asignarlos a una bodega al menos una vez. */
  protected readonly productosSinAsignar = computed<FilaSinAsignar[]>(() => {
    const idsConBodega = new Set(this.existenciasBodega().map((e) => e.productoId));
    return this.productosFisicosActivos()
      .filter((p) => !idsConBodega.has(p.id) && (p.existencia ?? 0) > 0)
      .map((p) => ({ productoId: p.id, codigo: p.codigo ?? '', nombre: p.nombre, cantidad: p.existencia ?? 0 }));
  });

  protected readonly filasExistencia = computed<FilaExistencia[]>(() =>
    this.existenciasBodega()
      .filter((e) => e.existencia > 0)
      .map((e) => ({
        id: e.id,
        productoNombre: this.nombreProducto(e.productoId),
        bodegaNombre: this.nombreBodega(e.bodegaId) ?? '—',
        existencia: e.existencia,
        ubicacion: e.ubicacion ?? null,
      }))
      .sort((a, b) => a.productoNombre.localeCompare(b.productoNombre) || a.bodegaNombre.localeCompare(b.bodegaNombre)),
  );

  /** Guarda la ubicación física (pasillo/anaquel, texto libre) de una fila
   *  de ExistenciaBodega ya existente — se edita inline en la tabla, sin
   *  modal (ver movimientos-bodega.component.html). Puramente informativo:
   *  no afecta cantidades ni movimientos. */
  async actualizarUbicacion(filaId: number, texto: string): Promise<void> {
    const original = this.existenciasBodega().find((e) => e.id === filaId);
    if (!original) return;
    const nuevaUbicacion = texto.trim() || null;
    if (nuevaUbicacion === (original.ubicacion ?? null)) return; // sin cambio real, no gasta una escritura
    await firstValueFrom(
      this.data.modificacion<ExistenciaBodega>('ExistenciaBodega', { ...original, ubicacion: nuevaUbicacion }),
    );
    this.existenciasBodega.update((lista) => lista.map((e) => (e.id === filaId ? { ...e, ubicacion: nuevaUbicacion } : e)));
  }

  protected readonly historial = computed<FilaHistorial[]>(() =>
    this.movimientos()
      .map((m) => {
        const tipo: TipoMovimiento = m.bodegaOrigenId === null ? 'entrada' : m.bodegaDestinoId === null ? 'salida' : 'traspaso';
        return {
          id: m.id,
          fecha: m.fecha,
          productoId: m.productoId,
          productoNombre: this.nombreProducto(m.productoId),
          bodegaOrigenId: m.bodegaOrigenId,
          bodegaDestinoId: m.bodegaDestinoId,
          origenNombre: this.nombreBodega(m.bodegaOrigenId),
          destinoNombre: this.nombreBodega(m.bodegaDestinoId),
          tipo,
          cantidad: m.cantidad,
          nota: m.nota,
          enTransito: m.enTransito ?? false,
          fechaRecepcion: m.fechaRecepcion ?? null,
        };
      })
      .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id),
  );

  // ── Filtros del historial (producto / bodega / rango de fechas) ──
  protected readonly filtroProductoId = signal(0);
  protected readonly filtroBodegaId = signal(0);
  protected readonly filtroDesde = signal('');
  protected readonly filtroHasta = signal('');

  protected readonly hayFiltrosActivos = computed(
    () => this.filtroProductoId() !== 0 || this.filtroBodegaId() !== 0 || this.filtroDesde() !== '' || this.filtroHasta() !== '',
  );

  protected readonly historialFiltrado = computed(() => {
    const productoId = this.filtroProductoId();
    const bodegaId = this.filtroBodegaId();
    const desde = this.filtroDesde();
    const hasta = this.filtroHasta();
    return this.historial().filter((f) => {
      if (productoId && f.productoId !== productoId) return false;
      if (bodegaId && f.bodegaOrigenId !== bodegaId && f.bodegaDestinoId !== bodegaId) return false;
      if (desde && f.fecha.slice(0, 10) < desde) return false;
      if (hasta && f.fecha.slice(0, 10) > hasta) return false;
      return true;
    });
  });

  limpiarFiltros(): void {
    this.filtroProductoId.set(0);
    this.filtroBodegaId.set(0);
    this.filtroDesde.set('');
    this.filtroHasta.set('');
  }

  /** Traspasos enviados pero sin confirmar recepción todavía — ver
   *  MovimientoInventarioService.enviarEnTransito(). Más viejo primero,
   *  para que lo que lleva más tiempo esperando se vea arriba. */
  protected readonly transitosPendientes = computed(() =>
    this.historial()
      .filter((f) => f.tipo === 'traspaso' && f.enTransito)
      .sort((a, b) => a.fecha.localeCompare(b.fecha)),
  );

  protected readonly confirmandoRecepcionId = signal<number | null>(null);

  /** Suma a la bodega destino lo que ya se restó de origen al enviarlo, y
   *  marca el traspaso como recibido (ver confirmarRecepcionTransito()). */
  async confirmarRecepcion(movimientoId: number): Promise<void> {
    this.confirmandoRecepcionId.set(movimientoId);
    await this.movimientoService.confirmarRecepcionTransito(movimientoId);
    this.confirmandoRecepcionId.set(null);
    this.toast.exito('Recepción confirmada — se sumó a la bodega destino.');
    this.cargar();
  }

  protected readonly modalAbierto = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    tipo: ['traspaso' as TipoMovimiento, Validators.required],
    productoId: [0, [Validators.required, Validators.min(1)]],
    bodegaOrigenId: [0],
    bodegaDestinoId: [0],
    cantidad: [1, [Validators.required, Validators.min(1)]],
    nota: [''],
    /** Solo tiene sentido con tipo === 'traspaso' (ver guardar()) — se
     *  oculta y se ignora en cualquier otro tipo. Ver
     *  MovimientoInventario.enTransito. */
    enTransito: [false],
  });

  /** Cuánto hay disponible para traspasar/dar de salida con el producto y la
   *  bodega de origen elegidos AHORA MISMO en el formulario — se muestra
   *  como ayuda junto al campo "Cantidad" y también se vuelve a validar al
   *  guardar (ver guardar()), por si cambiaron desde que se abrió el modal. */
  protected existenciaDisponibleOrigen(): number {
    const { productoId, bodegaOrigenId } = this.form.getRawValue();
    if (!productoId || !bodegaOrigenId) return 0;
    return this.existenciaEnBodega(productoId, bodegaOrigenId);
  }

  ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid'); // ancho completo
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    Promise.all([
      firstValueFrom(this.data.list<Producto>('Producto')),
      firstValueFrom(this.data.list<Bodega>('Bodega')),
      firstValueFrom(this.data.list<ExistenciaBodega>('ExistenciaBodega')),
      firstValueFrom(this.data.list<MovimientoInventario>('MovimientoInventario')),
    ]).then(([productos, bodegas, existencias, movimientos]) => {
      this.productos.set(productos);
      this.bodegas.set(bodegas);
      this.existenciasBodega.set(existencias);
      this.movimientos.set(movimientos);
      this.cargando.set(false);
    });
  }

  /** Busca el producto cuyo código coincida (exacto, sin distinguir
   *  mayúsculas) con lo escaneado/capturado en app-escaneo-codigo y lo
   *  selecciona en el formulario — mismo criterio de "atajo" que
   *  asignarABodega(): el usuario sigue siendo quien revisa el resto del
   *  formulario antes de guardar. Solo busca entre productos físicos
   *  activos (los mismos que ofrece el selector de producto). */
  seleccionarPorCodigo(codigo: string): void {
    const encontrado = this.productosFisicosActivos().find(
      (p) => (p.codigo ?? '').trim().toLowerCase() === codigo.trim().toLowerCase(),
    );
    if (!encontrado) {
      this.toast.advertencia(`No se encontró ningún producto activo con el código "${codigo}".`);
      return;
    }
    this.form.patchValue({ productoId: encontrado.id });
    this.toast.exito(`Producto seleccionado: ${encontrado.nombre}.`);
  }

  nuevoMovimiento(tipo: TipoMovimiento = 'traspaso'): void {
    if (this.productosFisicosActivos().length === 0) {
      this.toast.advertencia('No hay productos físicos activos — da de alta alguno en Productos y servicios.');
      return;
    }
    if (this.bodegasActivas().length === 0) {
      this.toast.advertencia('Antes crea al menos una Bodega activa (Inventario → Bodegas).');
      return;
    }
    this.form.reset({ tipo, productoId: 0, bodegaOrigenId: 0, bodegaDestinoId: 0, cantidad: 1, nota: '', enTransito: false });
    this.modalAbierto.set(true);
  }

  /** Atajo desde la tabla "sin asignar": precarga Entrada con el producto y
   *  la cantidad heredada ya puestos — el usuario solo elige la bodega
   *  destino. */
  asignarABodega(fila: FilaSinAsignar): void {
    if (this.bodegasActivas().length === 0) {
      this.toast.advertencia('Antes crea al menos una Bodega activa (Inventario → Bodegas).');
      return;
    }
    this.form.reset({
      tipo: 'entrada',
      productoId: fila.productoId,
      bodegaOrigenId: 0,
      bodegaDestinoId: 0,
      cantidad: fila.cantidad,
      nota: 'Asignación inicial',
      enTransito: false,
    });
    this.modalAbierto.set(true);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const valor = this.form.getRawValue();

    if (valor.tipo === 'entrada') {
      if (!valor.bodegaDestinoId) {
        this.toast.advertencia('Elige la bodega de destino.');
        return;
      }
    } else {
      // Traspaso o Salida/Ajuste: ambos restan de una bodega de origen.
      if (!valor.bodegaOrigenId) {
        this.toast.advertencia('Elige la bodega de origen.');
        return;
      }
      if (valor.tipo === 'traspaso') {
        if (!valor.bodegaDestinoId) {
          this.toast.advertencia('Elige la bodega de destino.');
          return;
        }
        if (valor.bodegaOrigenId === valor.bodegaDestinoId) {
          this.toast.advertencia('La bodega de origen y destino no pueden ser la misma.');
          return;
        }
      }
      const disponible = this.existenciaEnBodega(valor.productoId, valor.bodegaOrigenId);
      if (valor.cantidad > disponible) {
        this.toast.advertencia(`Esa bodega solo tiene ${disponible} de existencia disponible para ese producto.`);
        return;
      }
    }

    const bodegaOrigenId = valor.tipo === 'traspaso' || valor.tipo === 'salida' ? valor.bodegaOrigenId : null;
    const bodegaDestinoId = valor.tipo === 'salida' ? null : valor.bodegaDestinoId;
    const enTransito = valor.tipo === 'traspaso' && valor.enTransito;

    const registro = {
      productoId: valor.productoId,
      bodegaOrigenId,
      bodegaDestinoId,
      cantidad: valor.cantidad,
      nota: valor.nota || null,
    };

    this.guardando.set(true);
    // "Marcar como en tránsito" solo aplica a Traspaso — resta de origen
    // ahora, pero el destino se abona después al confirmar la recepción
    // (ver MovimientoInventarioService.enviarEnTransito()). Cualquier otro
    // caso sigue igual que siempre, con registrar().
    (enTransito ? this.movimientoService.enviarEnTransito(registro) : this.movimientoService.registrar(registro)).then(() => {
      this.guardando.set(false);
      this.toast.exito(enTransito ? 'Traspaso enviado — pendiente de confirmar recepción.' : 'Movimiento registrado.');
      this.modalAbierto.set(false);
      this.cargar();
    });
  }

  private nombreTipoHistorial(fila: FilaHistorial): string {
    if (fila.tipo === 'traspaso') return fila.enTransito ? 'Traspaso (en tránsito)' : 'Traspaso';
    return fila.tipo === 'entrada' ? 'Entrada' : 'Salida/Ajuste';
  }

  exportarCsvHistorial(): void {
    exportarCsv(
      'movimientos_bodega.csv',
      [
        { clave: 'fecha', etiqueta: 'Fecha' },
        { clave: 'productoNombre', etiqueta: 'Producto' },
        { clave: 'tipo', etiqueta: 'Tipo' },
        { clave: 'origenNombre', etiqueta: 'Origen' },
        { clave: 'destinoNombre', etiqueta: 'Destino' },
        { clave: 'cantidad', etiqueta: 'Cantidad' },
        { clave: 'nota', etiqueta: 'Nota' },
      ],
      this.historialFiltrado().map((f) => ({
        fecha: f.fecha,
        productoNombre: f.productoNombre,
        tipo: this.nombreTipoHistorial(f),
        origenNombre: f.origenNombre ?? '',
        destinoNombre: f.destinoNombre ?? '',
        cantidad: f.cantidad,
        nota: f.nota ?? '',
      })),
    );
  }

  exportarPdfHistorial(): void {
    exportarTablaPdf({
      nombreArchivo: 'movimientos_bodega.pdf',
      titulo: 'Historial de movimientos entre bodegas',
      subtitulo: this.hayFiltrosActivos() ? 'Con filtros aplicados' : undefined,
      columnas: [
        { etiqueta: 'Fecha', ancho: 32 },
        { etiqueta: 'Producto' },
        { etiqueta: 'Tipo', ancho: 38 },
        { etiqueta: 'Origen', ancho: 32 },
        { etiqueta: 'Destino', ancho: 32 },
        { etiqueta: 'Cantidad', ancho: 20 },
        { etiqueta: 'Nota', ancho: 40 },
      ],
      filas: this.historialFiltrado().map((f) => [
        new Date(f.fecha).toLocaleString('es-MX'),
        f.productoNombre,
        this.nombreTipoHistorial(f),
        f.origenNombre ?? '—',
        f.destinoNombre ?? '—',
        String(f.cantidad),
        f.nota ?? '',
      ]),
    });
  }
}

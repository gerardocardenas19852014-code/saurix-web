import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { SelectBuscableComponent, OpcionBuscable } from '../../../shared/components/select-buscable/select-buscable.component';
import { Producto } from '../productos/producto.model';
import { Bodega } from '../bodegas/bodega.model';
import { ExistenciaBodega } from '../movimientos-bodega/existencia-bodega.model';
import { MovimientoInventario } from '../movimientos-bodega/movimiento-inventario.model';
import { existenciaTotal } from '../productos/producto.util';
import { exportarCsv } from '../../../shared/utils/csv.util';
import { exportarTablaPdf } from '../../../shared/utils/pdf-tabla.util';

type TipoMovimiento = 'entrada' | 'traspaso' | 'salida';

interface FilaKardex {
  id: number;
  fecha: string;
  tipo: TipoMovimiento;
  origenNombre: string | null;
  destinoNombre: string | null;
  cantidad: number;
  /** + o - según se suma o resta al saldo que se está mostrando (total del
   *  producto, o de una bodega concreta si hay filtro — ver bodegaFiltroId). */
  delta: number;
  /** Acumulado después de este movimiento, en el orden cronológico real. */
  saldo: number;
  nota: string | null;
}

/**
 * "Estado de cuenta" de un producto: todos sus movimientos (entradas,
 * traspasos, salidas/ajustes — incluye recepciones de Órdenes de compra y
 * ajustes de Conteo físico, porque TODOS pasan por
 * MovimientoInventarioService.registrar(), ver ese archivo) en orden
 * cronológico con saldo acumulado, en vez de tener que filtrar el
 * historial general de Movimientos entre bodegas producto por producto.
 *
 * Sin filtro de bodega, el saldo es el TOTAL del producto (todas las
 * bodegas combinadas) — un traspaso no lo mueve, porque resta de una y
 * suma a otra por la misma cantidad. Con una bodega elegida, el saldo es
 * el de ESA bodega nada más (un traspaso sí la mueve, hacia arriba si es
 * destino, hacia abajo si es origen).
 *
 * Es de solo lectura, igual que Valor de stock: no genera ni modifica
 * ningún movimiento aquí.
 */
@Component({
  selector: 'app-kardex',
  standalone: true,
  imports: [SelectBuscableComponent, DatePipe],
  templateUrl: './kardex.component.html',
  styleUrl: './kardex.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KardexComponent implements OnInit, OnDestroy {
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  private readonly data = inject(DataClientService);

  protected readonly productos = signal<Producto[]>([]);
  protected readonly bodegas = signal<Bodega[]>([]);
  protected readonly existenciasBodega = signal<ExistenciaBodega[]>([]);
  protected readonly movimientos = signal<MovimientoInventario[]>([]);
  protected readonly cargando = signal(false);

  protected readonly productoId = signal(0);
  protected readonly bodegaFiltroId = signal(0);

  protected readonly productosActivos = computed(() => this.productos().filter((p) => p.activo && p.existencia !== null));
  protected readonly bodegasActivas = computed(() => this.bodegas().filter((b) => b.activo !== false));

  protected readonly opcionesProducto = computed<OpcionBuscable[]>(() =>
    this.productosActivos().map((p) => ({ valor: p.id, etiqueta: p.nombre })),
  );
  protected readonly opcionesBodega = computed<OpcionBuscable[]>(() =>
    this.bodegasActivas().map((b) => ({ valor: b.id, etiqueta: b.nombre })),
  );

  private nombreBodega(id: number | null): string | null {
    if (id === null) return null;
    return this.bodegas().find((b) => b.id === id)?.nombre ?? '—';
  }

  protected readonly productoElegido = computed(() => this.productos().find((p) => p.id === this.productoId()) ?? null);

  /** Existencia actual (total, o de la bodega filtrada) — para comparar a
   *  simple vista contra el saldo de la última fila del kardex; deben
   *  coincidir siempre, ya que ambos salen de los mismos datos. */
  protected readonly existenciaActual = computed(() => {
    const producto = this.productoElegido();
    if (!producto) return 0;
    const bodegaFiltroId = this.bodegaFiltroId();
    if (!bodegaFiltroId) return existenciaTotal(producto, this.existenciasBodega());
    return this.existenciasBodega().find((e) => e.productoId === producto.id && e.bodegaId === bodegaFiltroId)?.existencia ?? 0;
  });

  protected readonly kardex = computed<FilaKardex[]>(() => {
    const productoId = this.productoId();
    if (!productoId) return [];
    const bodegaFiltroId = this.bodegaFiltroId();

    const propios = this.movimientos()
      .filter((m) => m.productoId === productoId)
      .filter((m) => !bodegaFiltroId || m.bodegaOrigenId === bodegaFiltroId || m.bodegaDestinoId === bodegaFiltroId)
      .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id);

    let saldo = 0;
    const filas: FilaKardex[] = [];
    for (const m of propios) {
      const tipo: TipoMovimiento = m.bodegaOrigenId === null ? 'entrada' : m.bodegaDestinoId === null ? 'salida' : 'traspaso';
      let delta: number;
      if (!bodegaFiltroId) {
        delta = m.bodegaOrigenId === null ? m.cantidad : m.bodegaDestinoId === null ? -m.cantidad : 0;
      } else {
        const entra = m.bodegaDestinoId === bodegaFiltroId;
        const sale = m.bodegaOrigenId === bodegaFiltroId;
        delta = entra ? m.cantidad : sale ? -m.cantidad : 0;
      }
      saldo += delta;
      filas.push({
        id: m.id,
        fecha: m.fecha,
        tipo,
        origenNombre: this.nombreBodega(m.bodegaOrigenId),
        destinoNombre: this.nombreBodega(m.bodegaDestinoId),
        cantidad: m.cantidad,
        delta,
        saldo,
        nota: m.nota,
      });
    }
    return filas.reverse(); // más reciente primero, aunque el cálculo fue cronológico
  });

  ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid'); // ancho completo
    this.cargar();
  }

  private cargar(): void {
    this.cargando.set(true);
    Promise.all([
      firstValueFrom(this.data.list<Producto>('Producto')),
      firstValueFrom(this.data.list<Bodega>('Bodega')),
      firstValueFrom(this.data.list<ExistenciaBodega>('ExistenciaBodega')),
      firstValueFrom(this.data.list<MovimientoInventario>('MovimientoInventario')),
    ]).then(([productos, bodegas, existenciasBodega, movimientos]) => {
      this.productos.set(productos);
      this.bodegas.set(bodegas);
      this.existenciasBodega.set(existenciasBodega);
      this.movimientos.set(movimientos);
      this.cargando.set(false);
    });
  }

  elegirProducto(productoId: number): void {
    this.productoId.set(productoId);
    this.bodegaFiltroId.set(0);
  }

  private nombreTipo(tipo: TipoMovimiento): string {
    return tipo === 'entrada' ? 'Entrada' : tipo === 'salida' ? 'Salida/Ajuste' : 'Traspaso';
  }

  private nombreArchivoBase(): string {
    const producto = this.productoElegido();
    return `kardex_${(producto?.nombre ?? 'producto').replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`;
  }

  exportarCsv(): void {
    exportarCsv(
      `${this.nombreArchivoBase()}.csv`,
      [
        { clave: 'fecha', etiqueta: 'Fecha' },
        { clave: 'tipo', etiqueta: 'Tipo' },
        { clave: 'origenNombre', etiqueta: 'Origen' },
        { clave: 'destinoNombre', etiqueta: 'Destino' },
        { clave: 'cantidad', etiqueta: 'Cantidad' },
        { clave: 'delta', etiqueta: 'Movimiento' },
        { clave: 'saldo', etiqueta: 'Saldo' },
        { clave: 'nota', etiqueta: 'Nota' },
      ],
      this.kardex().map((f) => ({
        fecha: f.fecha,
        tipo: this.nombreTipo(f.tipo),
        origenNombre: f.origenNombre ?? '',
        destinoNombre: f.destinoNombre ?? '',
        cantidad: f.cantidad,
        delta: f.delta,
        saldo: f.saldo,
        nota: f.nota ?? '',
      })),
    );
  }

  exportarPdf(): void {
    const producto = this.productoElegido();
    const bodega = this.bodegas().find((b) => b.id === this.bodegaFiltroId());
    exportarTablaPdf({
      nombreArchivo: `${this.nombreArchivoBase()}.pdf`,
      titulo: `Kardex — ${producto?.nombre ?? ''}`,
      subtitulo: bodega ? `Bodega: ${bodega.nombre}` : 'Todas las bodegas (saldo total)',
      columnas: [
        { etiqueta: 'Fecha', ancho: 32 },
        { etiqueta: 'Tipo', ancho: 24 },
        { etiqueta: 'Origen', ancho: 36 },
        { etiqueta: 'Destino', ancho: 36 },
        { etiqueta: 'Cantidad', ancho: 20 },
        { etiqueta: 'Movimiento', ancho: 24 },
        { etiqueta: 'Saldo', ancho: 20 },
        { etiqueta: 'Nota' },
      ],
      filas: this.kardex().map((f) => [
        new Date(f.fecha).toLocaleString('es-MX'),
        this.nombreTipo(f.tipo),
        f.origenNombre ?? '—',
        f.destinoNombre ?? '—',
        String(f.cantidad),
        (f.delta > 0 ? '+' : '') + String(f.delta),
        String(f.saldo),
        f.nota ?? '',
      ]),
    });
  }
}

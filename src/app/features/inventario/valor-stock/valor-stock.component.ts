import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { Producto } from '../productos/producto.model';
import { formatMoneda, existenciaTotal } from '../productos/producto.util';
import { CategoriaProducto } from '../categorias-producto/categoria-producto.model';
import { Bodega } from '../bodegas/bodega.model';
import { ExistenciaBodega } from '../movimientos-bodega/existencia-bodega.model';

interface FilaValor {
  productoId: number;
  codigo: string;
  nombre: string;
  categoriaId: number;
  categoriaNombre: string;
  existencia: number;
  costo: number;
  valor: number;
  /** true si tiene nivelMinimo definido y la existencia ya cayó por debajo. */
  stockBajo: boolean;
}

interface ValorCategoria {
  id: number;
  nombre: string;
  valor: number;
  pct: number;
  color: string;
}

interface ValorBodega {
  /** null = valor "heredado" de productos que todavía no se asignaron a
   *  ninguna bodega (ver existenciaTotal() en producto.util.ts). */
  id: number | null;
  nombre: string;
  valor: number;
  pct: number;
  color: string;
}

/** Misma paleta que PALETA_CATEGORIAS de Presupuesto Personal
 *  (wallet.util.ts) — se repite aquí en vez de importar entre módulos
 *  (mismo criterio que formatMoneda en producto.util.ts). */
const PALETA_CATEGORIAS = ['var(--client)', 'var(--danger)', 'var(--amber)', 'var(--indigo)', 'var(--teal)', 'var(--technical)'];

function colorCategoria(id: number): string {
  return PALETA_CATEGORIAS[id % PALETA_CATEGORIAS.length];
}

/**
 * "Monitorea el valor del stock" (costo × existencia), por producto y por
 * categoría. Solo entran productos FÍSICOS (existencia !== null) y ACTIVOS
 * — los servicios no tienen inventario que valorizar (ver producto.model.ts)
 * y un producto inactivo ya no debería contar para decisiones de stock.
 *
 * Es solo lectura: no hay edición aquí, a diferencia de Listas de precios
 * (ver lista-precio-detalle.component.ts) y de Movimientos entre bodegas
 * (ver movimientos-bodega.component.ts, donde se registran entradas y
 * traspasos). La existencia que se usa aquí es existenciaTotal() — la suma
 * por bodega si el producto ya tiene alguna asignada, o su
 * Producto.existencia heredado si no (ver producto.util.ts) — así siempre
 * coincide con lo que muestra Productos y Movimientos entre bodegas.
 *
 * También avisa cuáles productos ya están por debajo de su nivel mínimo
 * (ver Producto.nivelMinimo) y desglosa el valor por bodega además de por
 * categoría — el "valor por bodega" se calcula directo de ExistenciaBodega
 * (no de existenciaTotal()), así que el remanente de productos SIN bodega
 * asignada cae en un bucket aparte ("Sin bodega asignada") para que la suma
 * siga cuadrando con "Valor de inventario".
 */
@Component({
  selector: 'app-valor-stock',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './valor-stock.component.html',
  styleUrl: './valor-stock.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ValorStockComponent implements OnInit {
  private readonly data = inject(DataClientService);
  protected readonly formatMoneda = formatMoneda;

  protected readonly productos = signal<Producto[]>([]);
  protected readonly categorias = signal<CategoriaProducto[]>([]);
  protected readonly bodegas = signal<Bodega[]>([]);
  protected readonly existenciasBodega = signal<ExistenciaBodega[]>([]);
  protected readonly cargando = signal(false);
  protected readonly busqueda = signal('');

  /** Solo productos físicos (existencia !== null) y activos — base de todo lo demás. */
  protected readonly productosValorizables = computed(() =>
    this.productos().filter((p) => p.activo && p.existencia !== null),
  );

  protected readonly filas = computed<FilaValor[]>(() => {
    const nombreCategoria = (id: number) => this.categorias().find((c) => c.id === id)?.nombre ?? '—';
    return this.productosValorizables()
      .map((p) => {
        const existencia = existenciaTotal(p, this.existenciasBodega());
        return {
          productoId: p.id,
          codigo: p.codigo ?? '',
          nombre: p.nombre,
          categoriaId: p.categoriaProductoId,
          categoriaNombre: nombreCategoria(p.categoriaProductoId),
          existencia,
          costo: p.costo,
          valor: existencia * p.costo,
          // typeof === 'number' (no solo !== null): un producto creado antes de
          // que existiera este campo no lo tiene en absoluto en IndexedDB (sin
          // migraciones de esquema) y vale `undefined`, no `null` — con !== null
          // se cuela y dispara un falso "stock bajo" contra undefined.
          stockBajo: typeof p.nivelMinimo === 'number' && existencia < p.nivelMinimo,
        };
      })
      .sort((a, b) => b.valor - a.valor);
  });

  protected readonly filasFiltradas = computed(() => {
    const texto = this.busqueda().trim().toLowerCase();
    if (!texto) return this.filas();
    return this.filas().filter((f) => f.nombre.toLowerCase().includes(texto) || f.codigo.toLowerCase().includes(texto));
  });

  protected readonly valorInventario = computed(() => this.filas().reduce((acc, f) => acc + f.valor, 0));

  protected readonly valorVenta = computed(() =>
    this.productosValorizables().reduce(
      (acc, p) => acc + existenciaTotal(p, this.existenciasBodega()) * p.precioUnitario,
      0,
    ),
  );

  protected readonly margenPotencial = computed(() => this.valorVenta() - this.valorInventario());

  protected readonly sinExistencia = computed(() => this.filas().filter((f) => f.existencia === 0).length);
  protected readonly stockBajo = computed(() => this.filas().filter((f) => f.stockBajo).length);

  protected readonly porCategoria = computed<ValorCategoria[]>(() => {
    const total = this.valorInventario();
    const porId = new Map<number, { nombre: string; valor: number }>();
    for (const f of this.filas()) {
      const actual = porId.get(f.categoriaId);
      if (actual) actual.valor += f.valor;
      else porId.set(f.categoriaId, { nombre: f.categoriaNombre, valor: f.valor });
    }
    return Array.from(porId.entries())
      .map(([id, v]) => ({ id, nombre: v.nombre, valor: v.valor, pct: total > 0 ? (v.valor / total) * 100 : 0, color: colorCategoria(id) }))
      .sort((a, b) => b.valor - a.valor);
  });

  protected readonly maxCategoria = computed(() => Math.max(1, ...this.porCategoria().map((c) => c.valor)));

  /** A diferencia de porCategoria() (que reparte existenciaTotal() de cada
   *  producto, ya incluya o no bodega), aquí se suma directo cada registro
   *  de ExistenciaBodega — así que el remanente de productos sin ninguna
   *  bodega asignada no queda repartido en ninguna, sino en su propio
   *  bucket "Sin bodega asignada" (id null). */
  protected readonly porBodega = computed<ValorBodega[]>(() => {
    const costoPorProducto = new Map(this.productosValorizables().map((p) => [p.id, p.costo]));
    const nombreBodega = (id: number) => this.bodegas().find((b) => b.id === id)?.nombre ?? '—';

    const porId = new Map<number, number>();
    let asignado = 0;
    for (const e of this.existenciasBodega()) {
      const costo = costoPorProducto.get(e.productoId);
      if (costo === undefined) continue; // producto inactivo, servicio o eliminado
      const valor = e.existencia * costo;
      porId.set(e.bodegaId, (porId.get(e.bodegaId) ?? 0) + valor);
      asignado += valor;
    }

    const total = this.valorInventario();
    const sinAsignar = Math.max(0, total - asignado);
    const colores = ['var(--client)', 'var(--danger)', 'var(--amber)', 'var(--indigo)', 'var(--teal)', 'var(--technical)'];
    const filas: ValorBodega[] = Array.from(porId.entries()).map(([id, valor], indice) => ({
      id,
      nombre: nombreBodega(id),
      valor,
      pct: total > 0 ? (valor / total) * 100 : 0,
      color: colores[indice % colores.length],
    }));
    if (sinAsignar > 0) {
      filas.push({ id: null, nombre: 'Sin bodega asignada', valor: sinAsignar, pct: total > 0 ? (sinAsignar / total) * 100 : 0, color: 'var(--ink-soft)' });
    }
    return filas.sort((a, b) => b.valor - a.valor);
  });

  protected readonly maxBodega = computed(() => Math.max(1, ...this.porBodega().map((b) => b.valor)));

  ngOnInit(): void {
    this.cargar();
  }

  private cargar(): void {
    this.cargando.set(true);
    Promise.all([
      firstValueFrom(this.data.list<Producto>('Producto')),
      firstValueFrom(this.data.list<CategoriaProducto>('CategoriaProducto')),
      firstValueFrom(this.data.list<Bodega>('Bodega')),
      firstValueFrom(this.data.list<ExistenciaBodega>('ExistenciaBodega')),
    ]).then(([productos, categorias, bodegas, existenciasBodega]) => {
      this.productos.set(productos);
      this.categorias.set(categorias);
      this.bodegas.set(bodegas);
      this.existenciasBodega.set(existenciasBodega);
      this.cargando.set(false);
    });
  }
}

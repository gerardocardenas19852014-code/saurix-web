import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe, DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { Producto } from '../productos/producto.model';
import { formatMoneda, existenciaTotal, alertasStockBajo, haySobreStock } from '../productos/producto.util';
import { CategoriaProducto } from '../categorias-producto/categoria-producto.model';
import { Bodega } from '../bodegas/bodega.model';
import { ExistenciaBodega } from '../movimientos-bodega/existencia-bodega.model';
import { NivelMinimoBodega } from '../productos/nivel-minimo-bodega.model';
import { MovimientoInventario } from '../movimientos-bodega/movimiento-inventario.model';
import { exportarCsv } from '../../../shared/utils/csv.util';
import { exportarTablaPdf } from '../../../shared/utils/pdf-tabla.util';

type TabValorStock = 'resumen' | 'productos' | 'rotacion';

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
  sobreStock: boolean;
}

interface FilaRotacion {
  productoId: number;
  codigo: string;
  nombre: string;
  existencia: number;
  /** ISO 8601 del movimiento más reciente de este producto (cualquier
   *  tipo: entrada, traspaso, salida/ajuste) — null = nunca tuvo ninguno
   *  desde que existe MovimientoInventario (puede ser un producto viejo
   *  cuya existencia solo viene de la asignación inicial, o uno que de
   *  plano nunca se ha movido). */
  ultimoMovimiento: string | null;
  /** null cuando ultimoMovimiento es null (no se puede calcular "hace
   *  cuánto" sin una fecha) — se muestra como "nunca" en vez de un número. */
  diasSinMovimiento: number | null;
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
  imports: [DecimalPipe, DatePipe],
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
  protected readonly nivelesMinimoBodega = signal<NivelMinimoBodega[]>([]);
  protected readonly movimientos = signal<MovimientoInventario[]>([]);
  protected readonly cargando = signal(false);
  protected readonly busqueda = signal('');
  protected readonly tabActiva = signal<TabValorStock>('resumen');
  /** Umbral de "sin movimiento" para la pestaña Rotación — editable, 60
   *  días por default (criterio razonable genérico; no se guarda nada, es
   *  solo del filtro de esta pantalla). */
  protected readonly umbralDias = signal(60);

  seleccionarTab(tab: TabValorStock): void {
    this.tabActiva.set(tab);
  }

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
          // Ver alertasStockBajo() en producto.util.ts: evalúa por bodega si el
          // producto ya tiene NivelMinimoBodega propios, o cae al mínimo global
          // "heredado" contra la existencia TOTAL si no tiene ninguno.
          stockBajo: alertasStockBajo(p, this.existenciasBodega(), this.nivelesMinimoBodega()).length > 0,
          sobreStock: haySobreStock(p, this.existenciasBodega()),
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
  protected readonly sobreStock = computed(() => this.filas().filter((f) => f.sobreStock).length);

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

  private async cargar(): Promise<void> {
    this.cargando.set(true);
    const [productos, categorias, bodegas, existenciasBodega, nivelesMinimoBodega] = await Promise.all([
      firstValueFrom(this.data.list<Producto>('Producto')),
      firstValueFrom(this.data.list<CategoriaProducto>('CategoriaProducto')),
      firstValueFrom(this.data.list<Bodega>('Bodega')),
      firstValueFrom(this.data.list<ExistenciaBodega>('ExistenciaBodega')),
      firstValueFrom(this.data.list<NivelMinimoBodega>('NivelMinimoBodega')),
    ]);
    this.productos.set(productos);
    this.categorias.set(categorias);
    this.bodegas.set(bodegas);
    this.existenciasBodega.set(existenciasBodega);
    this.nivelesMinimoBodega.set(nivelesMinimoBodega);

    // MovimientoInventario es el log de TODOS los movimientos de inventario
    // de la empresa (crece sin límite) — "rotación" necesita, por producto,
    // la fecha del último movimiento SIN importar qué tan viejo sea (es el
    // propósito de la pantalla: detectar capital inmovilizado), así que no
    // se puede acotar por fecha como en otras pantallas. Se acota por lo
    // único que sí es seguro acotar: solo productos valorizables (activos y
    // físicos), no absolutamente todos los productos que hayan existido.
    // NOTA para un fix completo: lo ideal a futuro es una vista/RPC en
    // Postgres que regrese MAX(fecha) agrupado por producto_id — eso evita
    // traer las filas de movimiento en sí, que es lo que de verdad pesa
    // aquí; ese cambio requiere tocar el backend, fuera del alcance de este
    // filtro (ver esquema-tablas-saurix.md).
    const idsValorizables = this.productosValorizables().map((p) => p.id);
    const movimientos = idsValorizables.length
      ? await firstValueFrom(this.data.list<MovimientoInventario>('MovimientoInventario', { productoId: idsValorizables }))
      : [];
    this.movimientos.set(movimientos);
    this.cargando.set(false);
  }

  /** Último movimiento (cualquier tipo) de cada producto físico activo, y
   *  cuántos días lleva sin ninguno — para detectar capital inmovilizado
   *  por falta de rotación, no solo por exceso de cantidad (ver
   *  haySobreStock(), que es un criterio distinto y complementario). */
  protected readonly rotacion = computed<FilaRotacion[]>(() => {
    const ahora = Date.now();
    return this.productosValorizables()
      .map((p) => {
        const propios = this.movimientos().filter((m) => m.productoId === p.id);
        const ultimoMovimiento = propios.length > 0 ? propios.reduce((max, m) => (m.fecha > max ? m.fecha : max), propios[0].fecha) : null;
        const diasSinMovimiento = ultimoMovimiento ? Math.floor((ahora - new Date(ultimoMovimiento).getTime()) / 86400000) : null;
        return {
          productoId: p.id,
          codigo: p.codigo ?? '',
          nombre: p.nombre,
          existencia: existenciaTotal(p, this.existenciasBodega()),
          ultimoMovimiento,
          diasSinMovimiento,
        };
      })
      .sort((a, b) => (b.diasSinMovimiento ?? Infinity) - (a.diasSinMovimiento ?? Infinity));
  });

  protected readonly rotacionFiltrada = computed(() =>
    this.rotacion().filter((f) => f.diasSinMovimiento === null || f.diasSinMovimiento >= this.umbralDias()),
  );

  /** Etiqueta de la(s) alerta(s) de una fila, para la columna "Alertas" del
   *  CSV/PDF — mismo criterio que los <span class="tag"> de la tabla en
   *  pantalla, pero como texto plano. */
  private etiquetaAlerta(fila: FilaValor): string {
    if (fila.existencia === 0) return 'Sin existencia';
    if (fila.stockBajo) return 'Stock bajo';
    if (fila.sobreStock) return 'Sobre-stock';
    return '';
  }

  exportarCsvProductos(): void {
    exportarCsv(
      'valor_stock.csv',
      [
        { clave: 'codigo', etiqueta: 'Código' },
        { clave: 'nombre', etiqueta: 'Nombre' },
        { clave: 'categoriaNombre', etiqueta: 'Categoría' },
        { clave: 'existencia', etiqueta: 'Existencia' },
        { clave: 'costo', etiqueta: 'Costo' },
        { clave: 'valor', etiqueta: 'Valor' },
        { clave: 'alerta', etiqueta: 'Alerta' },
      ],
      this.filasFiltradas().map((f) => ({ ...f, alerta: this.etiquetaAlerta(f) })),
    );
  }

  exportarPdfProductos(): void {
    exportarTablaPdf({
      nombreArchivo: 'valor_stock.pdf',
      titulo: 'Valor de stock',
      subtitulo: `Valor total: ${formatMoneda(this.valorInventario())}`,
      columnas: [
        { etiqueta: 'Código', ancho: 26 },
        { etiqueta: 'Nombre' },
        { etiqueta: 'Categoría', ancho: 36 },
        { etiqueta: 'Existencia', ancho: 24 },
        { etiqueta: 'Costo', ancho: 26 },
        { etiqueta: 'Valor', ancho: 26 },
        { etiqueta: 'Alerta', ancho: 28 },
      ],
      filas: this.filasFiltradas().map((f) => [
        f.codigo || '—',
        f.nombre,
        f.categoriaNombre,
        String(f.existencia),
        formatMoneda(f.costo),
        formatMoneda(f.valor),
        this.etiquetaAlerta(f),
      ]),
    });
  }
}

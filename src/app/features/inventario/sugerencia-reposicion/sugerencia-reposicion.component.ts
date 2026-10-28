import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { fuenteDatosActual } from '../../../core/services/fuente-datos';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { SelectBuscableComponent, OpcionBuscable } from '../../../shared/components/select-buscable/select-buscable.component';
import { Producto } from '../productos/producto.model';
import { alertasStockBajo } from '../productos/producto.util';
import { ExistenciaBodega } from '../movimientos-bodega/existencia-bodega.model';
import { NivelMinimoBodega } from '../productos/nivel-minimo-bodega.model';
import { Bodega } from '../bodegas/bodega.model';
import { Proveedor } from '../proveedores/proveedor.model';
import { ProductoProveedor } from '../proveedores/producto-proveedor.model';
import { ToastService } from '../../../shared/services/toast.service';
import { OrdenCompraBorradorService } from '../compras/orden-compra-borrador.service';

/** Sentinel para el filtro de Proveedor: "Sin proveedor asignado" no es un
 *  id real (sería NULL), así que se representa con -1 en el combo y se
 *  traduce a "proveedor_id IS NULL" tanto en la RPC como en modo local
 *  (ver requerimiento 18 — antes no existía forma de filtrar por esto). */
const SIN_PROVEEDOR = -1;

type ColumnaOrden = 'proveedor' | 'codigo' | 'nombre' | 'existencia' | 'minimo' | 'sugerido';

interface FilaReposicion {
  productoId: number;
  codigo: string;
  nombre: string;
  /** null = alerta global "heredada" (sin NivelMinimoBodega propios, ver
   *  alertasStockBajo() en producto.util.ts) — no se puede saber EN CUÁL
   *  bodega concreta comprar. Con número, la bodega exacta que está baja. */
  bodegaId: number | null;
  bodegaNombre: string;
  existencia: number;
  nivelMinimo: number;
  /** Cuánto comprar para volver a quedar con el doble del mínimo, no solo
   *  justo en el mínimo — así no se vuelve a caer en alerta con el primer
   *  movimiento de salida. Misma regla de siempre, ahora calculada en SQL
   *  (ver migración fn_sugerencia_reposicion) o aquí mismo en modo local. */
  sugerida: number;
  proveedorId: number | null;
  proveedorNombre: string;
  costoUnitario: number;
}

/**
 * "Qué comprar y cuánto" — a diferencia de la tarjeta "Stock bajo" de Valor
 * de stock (que solo avisa que algo está por debajo del mínimo), esta
 * pantalla ya calcula una cantidad sugerida y agrupa por proveedor, lista
 * para pasar a quien se le compra. Es de solo lectura: no genera ningún
 * movimiento ni modifica existencia — eso sigue siendo tarea de Movimientos
 * entre bodegas, una vez que de verdad llegue la mercancía (como Entrada).
 *
 * Una fila por ALERTA (ver alertasStockBajo() en producto.util.ts / la RPC
 * fn_sugerencia_reposicion), no por producto: un mismo producto puede
 * aparecer varias veces si tiene varias bodegas con mínimo propio y más de
 * una está baja a la vez.
 *
 * Homologado visualmente a Productos y servicios (ver sesión de trabajo del
 * 27-oct-2026): barra blanca con Buscar/Nombre/Código/Proveedor/Bodega,
 * paginación server-side y ancho completo (`data-wide='grid'`). La regla de
 * negocio (qué cuenta como alerta, cuánto sugerir) NO cambió — solo se
 * movió de calcularse sobre el catálogo completo en Angular a calcularse en
 * PostgreSQL vía RPC, paginada (ver fn_sugerencia_reposicion en Supabase).
 */
@Component({
  selector: 'app-sugerencia-reposicion',
  standalone: true,
  imports: [SelectBuscableComponent],
  templateUrl: './sugerencia-reposicion.component.html',
  styleUrl: './sugerencia-reposicion.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SugerenciaReposicionComponent implements OnInit, OnDestroy {
  private readonly data = inject(DataClientService);
  private readonly router = inject(Router);
  private readonly borradorService = inject(OrdenCompraBorradorService);
  protected readonly toast = inject(ToastService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);

  private readonly esSupabase = fuenteDatosActual() === 'supabase';
  private readonly sb = this.esSupabase ? inject(SupabaseService).cliente : null;

  // ── Catálogos chicos para los selects de filtro (Proveedor/Bodega) — se
  // cargan completos porque una empresa normal tiene pocos de cada uno
  // (decenas, no decenas de miles como Producto) — ver requerimiento 8/9. ──
  protected readonly bodegas = signal<Bodega[]>([]);
  protected readonly proveedores = signal<Proveedor[]>([]);

  protected readonly opcionesBodega = computed<OpcionBuscable[]>(() =>
    this.bodegas()
      .filter((b) => b.activo)
      .map((b) => ({ valor: b.id, etiqueta: b.nombre })),
  );
  protected readonly opcionesProveedor = computed<OpcionBuscable[]>(() => [
    { valor: SIN_PROVEEDOR, etiqueta: 'Sin proveedor asignado' },
    ...this.proveedores()
      .filter((p) => p.activo)
      .map((p) => ({ valor: p.id, etiqueta: p.nombre })),
  ]);

  // ── Filtros + paginación (server-side, ver requerimiento 13/15) ────────
  protected readonly busquedaNombre = signal('');
  protected readonly busquedaCodigo = signal('');
  protected readonly filtroProveedorId = signal(0); // 0 = todos, SIN_PROVEEDOR = sin asignar
  protected readonly filtroBodegaId = signal(0); // 0 = todas
  protected readonly orden = signal<ColumnaOrden>('proveedor');
  protected readonly direccion = signal<'asc' | 'desc'>('asc');
  protected readonly paginaActual = signal(1);

  /** Antes del primer click en "Buscar" (o Enter) no se carga ni se
   *  muestra nada — mismo patrón que Productos y servicios/Existencia por
   *  bodega/Historial de movimientos (ver busquedaRealizada ahí). */
  protected readonly busquedaRealizada = signal(false);
  protected readonly cargando = signal(false);
  protected readonly filasPagina = signal<FilaReposicion[]>([]);

  /** Mismo total para el KPI y el paginador — una sola consulta server-side
   *  (count(*) over() dentro de fn_sugerencia_reposicion), nunca un COUNT
   *  aparte (ver requerimiento 21). Refleja los filtros actuales. */
  protected readonly totalFilas = signal(0);
  protected readonly totalPaginas = computed(() =>
    Math.max(1, Math.ceil(this.totalFilas() / Math.max(1, this.preferenciasGrid.tamanoPagina()))),
  );
  private secuencia = 0;

  // ── Modo local (IndexedDB, sin backend) — mismo criterio de siempre: en
  // ese modo la base es chica (un solo usuario sin servidor), así que se
  // carga completa una vez y se filtra/ordena/pagina aquí mismo. ─────────
  private baseLocalCargada = false;
  private cargaBaseLocalPromesa: Promise<void> | null = null;
  private productosLocal: Producto[] = [];
  private existenciasBodegaLocal: ExistenciaBodega[] = [];
  private nivelesMinimoBodegaLocal: NivelMinimoBodega[] = [];
  private productoProveedorLocal: ProductoProveedor[] = [];

  ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid'); // ancho completo, ver requerimiento 1
    this.cargarCatalogosFiltro();
  }

  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  private cargarCatalogosFiltro(): void {
    firstValueFrom(this.data.list<Bodega>('Bodega'))
      .then((b) => this.bodegas.set(b))
      .catch(() => {});
    firstValueFrom(this.data.list<Proveedor>('Proveedor'))
      .then((p) => this.proveedores.set(p))
      .catch(() => {});
  }

  protected cambiarFiltro(): void {
    this.busquedaRealizada.set(true);
    this.paginaActual.set(1);
    this.cargar();
  }

  protected irAPaginaAnterior(): void {
    if (this.paginaActual() <= 1) return;
    this.paginaActual.update((p) => p - 1);
    this.cargar();
  }

  protected irAPaginaSiguiente(): void {
    if (this.paginaActual() >= this.totalPaginas()) return;
    this.paginaActual.update((p) => p + 1);
    this.cargar();
  }

  /** Encabezados ordenables (requerimiento 16) — Productos y servicios no
   *  tiene todavía este patrón en ningún lado, así que se diseñó uno nuevo,
   *  simple, consistente con el resto (flecha ▲/▼ junto al título). El
   *  orden inicial (antes de que el usuario toque un encabezado) se dejó
   *  exactamente como estaba: por proveedor y luego por mínimo descendente
   *  — ver el `order by` por defecto de fn_sugerencia_reposicion. */
  protected ordenarPor(columna: ColumnaOrden): void {
    if (this.orden() === columna) {
      this.direccion.set(this.direccion() === 'asc' ? 'desc' : 'asc');
    } else {
      this.orden.set(columna);
      this.direccion.set('asc');
    }
    this.paginaActual.set(1);
    this.cargar();
  }

  protected indicadorOrden(columna: ColumnaOrden): string {
    if (this.orden() !== columna) return '';
    return this.direccion() === 'asc' ? ' ▲' : ' ▼';
  }

  private async cargar(): Promise<void> {
    this.cargando.set(true);
    const miSecuencia = ++this.secuencia;
    const resultado = this.esSupabase ? await this.cargarSupabase() : await this.cargarLocal();
    if (miSecuencia !== this.secuencia) return; // respuesta vieja, se descarta
    this.filasPagina.set(resultado.filas);
    this.totalFilas.set(resultado.total);
    this.cargando.set(false);
  }

  private async cargarSupabase(): Promise<{ filas: FilaReposicion[]; total: number }> {
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActual() - 1) * tamanio;
    const { data, error } = await this.sb!.schema('inventario').rpc('fn_sugerencia_reposicion', {
      p_busqueda_nombre: this.busquedaNombre().trim() || null,
      p_busqueda_codigo: this.busquedaCodigo().trim() || null,
      p_proveedor_id: this.filtroProveedorId() || null,
      p_bodega_id: this.filtroBodegaId() || null,
      p_orden: this.orden(),
      p_direccion: this.direccion(),
      p_desde: desde,
      p_cantidad: tamanio,
    });
    if (error) return { filas: [], total: 0 };
    const filas = (data ?? []) as Record<string, unknown>[];
    return { filas: filas.map((f) => this.mapearFila(f)), total: Number(filas[0]?.['total'] ?? 0) };
  }

  private mapearFila(f: Record<string, unknown>): FilaReposicion {
    return {
      productoId: Number(f['producto_id']),
      codigo: String(f['codigo'] ?? ''),
      nombre: String(f['nombre'] ?? ''),
      bodegaId: f['bodega_id'] === null || f['bodega_id'] === undefined ? null : Number(f['bodega_id']),
      bodegaNombre: String(f['bodega_nombre'] ?? ''),
      existencia: Number(f['existencia']) || 0,
      nivelMinimo: Number(f['nivel_minimo']) || 0,
      sugerida: Number(f['sugerida']) || 0,
      proveedorId: f['proveedor_id'] === null || f['proveedor_id'] === undefined ? null : Number(f['proveedor_id']),
      proveedorNombre: String(f['proveedor_nombre'] ?? ''),
      costoUnitario: Number(f['costo_unitario']) || 0,
    };
  }

  // ── Modo local ───────────────────────────────────────────────────────
  private async cargarBaseLocal(): Promise<void> {
    if (this.baseLocalCargada) return;
    if (this.cargaBaseLocalPromesa) return this.cargaBaseLocalPromesa;
    this.cargaBaseLocalPromesa = Promise.all([
      firstValueFrom(this.data.list<Producto>('Producto')),
      firstValueFrom(this.data.list<ExistenciaBodega>('ExistenciaBodega')),
      firstValueFrom(this.data.list<NivelMinimoBodega>('NivelMinimoBodega')),
      firstValueFrom(this.data.list<ProductoProveedor>('ProductoProveedor')),
    ]).then(([productos, existenciasBodega, nivelesMinimoBodega, productoProveedor]) => {
      this.productosLocal = productos;
      this.existenciasBodegaLocal = existenciasBodega;
      this.nivelesMinimoBodegaLocal = nivelesMinimoBodega;
      this.productoProveedorLocal = productoProveedor;
      this.baseLocalCargada = true;
    });
    return this.cargaBaseLocalPromesa;
  }

  private proveedorPreferidoLocal(producto: Producto): { proveedorId: number | null; precioCompra: number | null } {
    const preferido = this.productoProveedorLocal.find((pp) => pp.productoId === producto.id && pp.preferido);
    if (preferido) return { proveedorId: preferido.proveedorId, precioCompra: preferido.precioCompra };
    return { proveedorId: producto.proveedorId ?? null, precioCompra: null };
  }

  /** Misma regla exacta que antes (ver alertasStockBajo() en
   *  producto.util.ts) — todas las alertas sin filtrar, sin ordenar ni
   *  paginar todavía; eso se aplica después según lo que pida cada
   *  llamada (tabla visible vs. "Generar orden de compra"). */
  private todasLasFilasLocal(): FilaReposicion[] {
    const nombreProveedor = (id: number | null) => {
      if (!id) return 'Sin proveedor asignado';
      return this.proveedores().find((p) => p.id === id)?.nombre ?? 'Sin proveedor asignado';
    };
    const nombreBodega = (id: number | null) => {
      if (id === null) return 'Todas (sin mínimo por bodega)';
      return this.bodegas().find((b) => b.id === id)?.nombre ?? '—';
    };
    const filas: FilaReposicion[] = [];
    for (const producto of this.productosLocal) {
      if (!producto.activo) continue;
      const alertas = alertasStockBajo(producto, this.existenciasBodegaLocal, this.nivelesMinimoBodegaLocal);
      if (alertas.length === 0) continue;
      const { proveedorId, precioCompra } = this.proveedorPreferidoLocal(producto);
      for (const alerta of alertas) {
        const sugerida = Math.max(alerta.nivelMinimo * 2 - alerta.existencia, 1);
        filas.push({
          productoId: producto.id,
          codigo: producto.codigo ?? '',
          nombre: producto.nombre,
          bodegaId: alerta.bodegaId,
          bodegaNombre: nombreBodega(alerta.bodegaId),
          existencia: alerta.existencia,
          nivelMinimo: alerta.nivelMinimo,
          sugerida,
          proveedorId,
          proveedorNombre: nombreProveedor(proveedorId),
          costoUnitario: precioCompra ?? producto.costo,
        });
      }
    }
    return filas;
  }

  private ordenarFilasLocal(filas: FilaReposicion[]): FilaReposicion[] {
    const dir = this.direccion() === 'asc' ? 1 : -1;
    const copia = [...filas];
    switch (this.orden()) {
      case 'codigo':
        return copia.sort((a, b) => dir * a.codigo.localeCompare(b.codigo));
      case 'nombre':
        return copia.sort((a, b) => dir * a.nombre.localeCompare(b.nombre));
      case 'existencia':
        return copia.sort((a, b) => dir * (a.existencia - b.existencia));
      case 'minimo':
        return copia.sort((a, b) => dir * (a.nivelMinimo - b.nivelMinimo));
      case 'sugerido':
        return copia.sort((a, b) => dir * (a.sugerida - b.sugerida));
      default:
        // Mismo orden por defecto de siempre: proveedor, luego mínimo descendente.
        return copia.sort((a, b) => a.proveedorNombre.localeCompare(b.proveedorNombre) || b.nivelMinimo - a.nivelMinimo);
    }
  }

  private filasLocalFiltradas(): FilaReposicion[] {
    const nombre = this.busquedaNombre().trim().toLowerCase();
    const codigo = this.busquedaCodigo().trim().toLowerCase();
    const proveedorId = this.filtroProveedorId();
    const bodegaId = this.filtroBodegaId();
    return this.todasLasFilasLocal().filter(
      (f) =>
        (!nombre || f.nombre.toLowerCase().includes(nombre)) &&
        (!codigo || f.codigo.toLowerCase().includes(codigo)) &&
        (!proveedorId ||
          (proveedorId === SIN_PROVEEDOR ? f.proveedorId === null : f.proveedorId === proveedorId)) &&
        (!bodegaId || f.bodegaId === bodegaId),
    );
  }

  private async cargarLocal(): Promise<{ filas: FilaReposicion[]; total: number }> {
    await this.cargarBaseLocal();
    const todas = this.ordenarFilasLocal(this.filasLocalFiltradas());
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActual() - 1) * tamanio;
    return { filas: todas.slice(desde, desde + tamanio), total: todas.length };
  }

  /** Genera un borrador de Orden de compra con TODOS los productos
   *  sugeridos de UN proveedor (ignora los demás filtros de pantalla —
   *  nombre/código/bodega — igual que antes: la orden debe llevar todo lo
   *  que se le debe comprar a ese proveedor, no solo lo que se ve filtrado
   *  en ese momento) y navega a la ficha de Órdenes de compra para que el
   *  usuario la revise — no se guarda nada todavía aquí. */
  async generarOrdenCompra(proveedorId: number): Promise<void> {
    const filasProveedor = this.esSupabase
      ? await this.obtenerTodasDelProveedorSupabase(proveedorId)
      : this.todasLasFilasLocal().filter((f) => f.proveedorId === proveedorId);
    if (filasProveedor.length === 0) return;
    const lineas = filasProveedor.map((f) => ({ productoId: f.productoId, cantidad: f.sugerida, costoUnitario: f.costoUnitario }));
    const bodegasDistintas = new Set(filasProveedor.map((f) => f.bodegaId));
    const bodegaId = bodegasDistintas.size === 1 ? filasProveedor[0].bodegaId : null;
    this.borradorService.establecer({ proveedorId, bodegaId, lineas });
    this.router.navigate(['/inventario/ordenes-compra']);
  }

  /** Todas las alertas de un proveedor, SIN paginar (hasta 10,000 — tope
   *  de la propia RPC) — la generación de una orden de compra necesita la
   *  lista completa, no solo la página visible en pantalla. */
  private async obtenerTodasDelProveedorSupabase(proveedorId: number): Promise<FilaReposicion[]> {
    const { data, error } = await this.sb!.schema('inventario').rpc('fn_sugerencia_reposicion', {
      p_busqueda_nombre: null,
      p_busqueda_codigo: null,
      p_proveedor_id: proveedorId,
      p_bodega_id: null,
      p_orden: 'proveedor',
      p_direccion: 'asc',
      p_desde: 0,
      p_cantidad: 10000,
    });
    if (error) return [];
    return ((data ?? []) as Record<string, unknown>[]).map((f) => this.mapearFila(f));
  }
}

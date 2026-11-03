import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { SelectBuscableComponent, OpcionBuscable } from '../../../shared/components/select-buscable/select-buscable.component';
import { Bodega } from '../bodegas/bodega.model';
import { Proveedor } from '../proveedores/proveedor.model';
import { ToastService } from '../../../shared/services/toast.service';
import { OrdenCompraBorradorService } from '../compras/orden-compra-borrador.service';

/** Sentinel para el filtro de Proveedor: "Sin proveedor asignado" no es un
 *  id real (sería NULL), así que se representa con -1 en el combo y se
 *  traduce a "proveedor_id IS NULL" en la RPC (ver requerimiento 18 — antes
 *  no existía forma de filtrar por esto). */
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
   *  movimiento de salida. Misma regla de siempre, calculada en SQL (ver
   *  migración fn_sugerencia_reposicion). */
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

  private readonly sb = inject(SupabaseService).cliente;

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
    const resultado = await this.cargarSupabase();
    if (miSecuencia !== this.secuencia) return; // respuesta vieja, se descarta
    this.filasPagina.set(resultado.filas);
    this.totalFilas.set(resultado.total);
    this.cargando.set(false);
  }

  private async cargarSupabase(): Promise<{ filas: FilaReposicion[]; total: number }> {
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActual() - 1) * tamanio;
    const { data, error } = await this.sb.schema('inventario').rpc('fn_sugerencia_reposicion', {
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

  /** Genera un borrador de Orden de compra con TODOS los productos
   *  sugeridos de UN proveedor (ignora los demás filtros de pantalla —
   *  nombre/código/bodega — igual que antes: la orden debe llevar todo lo
   *  que se le debe comprar a ese proveedor, no solo lo que se ve filtrado
   *  en ese momento) y navega a la ficha de Órdenes de compra para que el
   *  usuario la revise — no se guarda nada todavía aquí. */
  async generarOrdenCompra(proveedorId: number): Promise<void> {
    const filasProveedor = await this.obtenerTodasDelProveedorSupabase(proveedorId);
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
    const { data, error } = await this.sb.schema('inventario').rpc('fn_sugerencia_reposicion', {
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

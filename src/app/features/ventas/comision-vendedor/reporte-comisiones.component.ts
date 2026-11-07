import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { ToastService } from '../../../shared/services/toast.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { Usuario } from '../../seguridad/usuarios/usuario.model';
import { formatMoneda } from '../ventas.util';
import { TipoComisionVendedor } from './comision-vendedor.model';

interface FilaReporteComision {
  usuarioId: number;
  vendedorNombre: string;
  numeroVentas: number;
  totalVentas: number;
  totalDevuelto: number;
  ventasNetas: number;
  comisionTipo: TipoComisionVendedor | null;
  comisionValor: number | null;
  montoComision: number;
}

/**
 * Comisión a pagar por vendedor en un periodo — usa la comisión
 * configurada en ComisionesVendedoresComponent. "Ventas netas" resta lo
 * devuelto (ver Devolucion/DevolucionItem) de cada venta Completada del
 * periodo, para no pagar comisión sobre algo que el cliente regresó. La
 * comisión se calcula sobre lo VENDIDO, no sobre lo ya cobrado — una venta
 * a Crédito sin abonar todavía también genera comisión (decisión de
 * alcance ya documentada antes de esta homologación).
 *
 * HOMOLOGACIÓN DE RENDIMIENTO (Fase 1, "Prompt maestro" nov-2026): el
 * cálculo por vendedor (ventas netas, comisión) se hacía 100% en Angular
 * vía un computed que iteraba TODOS los vendedores activos, sin
 * paginación ni filtro por vendedor — con muchos vendedores/mucho
 * historial eso significa procesar cada vez el periodo completo en el
 * navegador. Ahora una sola función de PostgreSQL
 * (`ventas.fn_reporte_comisiones_listar`) hace TODO el cálculo (ventas
 * netas = vendido - devuelto, comisión según tipo configurado) con los
 * MISMOS criterios de negocio de siempre, filtra por fecha y vendedor,
 * pagina 20 vendedores por página (ordenados por comisión a pagar DESC) y
 * regresa también la suma de comisión de TODOS los vendedores que cumplen
 * el filtro (no solo los de la página visible) para la tarjeta "Total a
 * pagar". Un botón "🔍 Buscar" es el único disparador de una consulta
 * nueva — cambiar fecha o vendedor nunca consulta por sí solo.
 */
@Component({
  selector: 'app-reporte-comisiones',
  standalone: true,
  imports: [],
  templateUrl: './reporte-comisiones.component.html',
  styleUrl: './reporte-comisiones.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReporteComisionesComponent implements OnInit, OnDestroy {
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  private readonly data = inject(DataClientService);
  private readonly sb = inject(SupabaseService).cliente;
  protected readonly toast = inject(ToastService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);
  protected readonly formatMoneda = formatMoneda;

  /** false hasta terminar una búsqueda -- ya no se consulta nada al abrir
   *  la pantalla (ver ngOnInit()). */
  protected readonly cargando = signal(false);
  /** true en cuanto el usuario presiona "Buscar" por primera vez. */
  protected readonly haBuscado = signal(false);

  /** Catálogo chico (vendedores activos) — se carga UNA sola vez, solo
   *  para llenar el combo "Vendedor"; nunca para calcular nada (eso lo
   *  hace fn_reporte_comisiones_listar en el servidor). */
  protected readonly usuarios = signal<Usuario[]>([]);
  protected readonly usuariosActivos = computed(() => this.usuarios().filter((u) => u.activo !== false));

  /** Filtros EN EDICIÓN — nunca disparan una consulta por sí solos. Solo
   *  cambiarFiltro() (botón "🔍 Buscar") los aplica de verdad. */
  protected readonly fechaDesde = signal(this.primerDiaMesISO());
  protected readonly fechaHasta = signal(this.hoyISO());
  protected readonly filtroVendedorId = signal(0); // 0 = todos los vendedores

  /** Filtros APLICADOS -- foto de los filtros tal como estaban cuando se
   *  presionó "Buscar" por última vez. cargarListadoSupabase() y la
   *  paginación leen SIEMPRE de aquí, nunca de los signals "en edición" de
   *  arriba (mismo criterio que HistorialVentasComponent -- ver mandato de
   *  corrección "Búsqueda manual en reportes de ventas", nov-2026). null =
   *  todavía no se ejecutó ninguna búsqueda. */
  private filtrosAplicados: { desde: string; hasta: string; vendedorId: number } | null = null;

  protected readonly paginaActual = signal(1);
  protected readonly totalVendedoresFiltrados = signal(0);
  protected readonly totalPaginas = computed(() =>
    Math.max(1, Math.ceil(this.totalVendedoresFiltrados() / Math.max(1, this.preferenciasGrid.tamanoPagina()))),
  );
  /** Suma de comisión de TODOS los vendedores que cumplen el filtro (no
   *  solo los de la página visible) — la da el propio servidor
   *  (suma_comision_total vía sum(...) over()), nunca se calcula sumando
   *  solo las filas ya traídas. */
  protected readonly totalComisiones = signal(0);
  protected readonly filas = signal<FilaReporteComision[]>([]);

  /** Evita que una respuesta vieja (petición lenta) pise el resultado de
   *  una búsqueda/página más reciente — mismo patrón que
   *  OrdenesCompraComponent.secuenciaListado. */
  private secuenciaListado = 0;

  private hoyISO(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private primerDiaMesISO(): string {
    const hoy = new Date();
    return new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10);
  }

  async ngOnInit(): Promise<void> {
    document.documentElement.setAttribute('data-wide', 'grid');
    // El catálogo de vendedores SÍ se carga al abrir (solo llena el combo de
    // filtro, nunca calcula nada) -- lo que ya NO se hace al abrir es
    // consultar el reporte: eso espera a que se presione "Buscar".
    const usuarios = await firstValueFrom(this.data.list<Usuario>('Usuario'));
    this.usuarios.set(usuarios);
  }

  /** Trae SOLO la página actual de vendedores que cumplen el filtro
   *  aplicado — nunca el catálogo completo de vendedores ni el histórico
   *  de ventas. Mismo patrón que OrdenesCompraComponent.cargarListado(). */
  async cargarListado(): Promise<void> {
    this.cargando.set(true);
    const miSecuencia = ++this.secuenciaListado;
    const resultado = await this.cargarListadoSupabase();
    if (miSecuencia !== this.secuenciaListado) return; // ya respondió una búsqueda/página más nueva — descartar esta
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    if (resultado.filas.length === 0 && this.paginaActual() > 1 && resultado.total > 0) {
      this.paginaActual.set(Math.max(1, Math.ceil(resultado.total / tamanio)));
      this.cargando.set(false);
      await this.cargarListado();
      return;
    }
    this.filas.set(resultado.filas);
    this.totalVendedoresFiltrados.set(resultado.total);
    this.totalComisiones.set(resultado.sumaComisionTotal);
    this.cargando.set(false);
  }

  private async cargarListadoSupabase(): Promise<{ filas: FilaReporteComision[]; total: number; sumaComisionTotal: number }> {
    const f = this.filtrosAplicados;
    if (!f) return { filas: [], total: 0, sumaComisionTotal: 0 }; // defensivo: no debería llamarse sin una búsqueda ya ejecutada.
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActual() - 1) * tamanio;
    const { data, error } = await this.sb.schema('ventas').rpc('fn_reporte_comisiones_listar', {
      p_desde_fecha: f.desde || null,
      p_hasta_fecha: f.hasta || null,
      p_vendedor_id: f.vendedorId || null,
      p_desde: desde,
      p_cantidad: tamanio,
    });
    if (error) {
      this.toast.error('No se pudo cargar el reporte de comisiones: ' + error.message);
      return { filas: [], total: 0, sumaComisionTotal: 0 };
    }
    const filas = (data ?? []) as Record<string, unknown>[];
    return {
      filas: filas.map((f) => ({
        usuarioId: Number(f['usuario_id']),
        vendedorNombre: String(f['vendedor_nombre']),
        numeroVentas: Number(f['numero_ventas']) || 0,
        totalVentas: Number(f['total_ventas']) || 0,
        totalDevuelto: Number(f['total_devuelto']) || 0,
        ventasNetas: Number(f['ventas_netas']) || 0,
        comisionTipo: (f['comision_tipo'] as TipoComisionVendedor | null) ?? null,
        comisionValor: f['comision_valor'] !== null ? Number(f['comision_valor']) : null,
        montoComision: Number(f['monto_comision']) || 0,
      })),
      total: Number(filas[0]?.['total_filas'] ?? 0),
      sumaComisionTotal: Number(filas[0]?.['suma_comision_total'] ?? 0),
    };
  }

  /** Único disparador de una consulta nueva (botón "🔍 Buscar") — cambiar
   *  fecha o vendedor nunca consulta por sí solo. Vuelve a la página 1. */
  protected cambiarFiltro(): void {
    this.filtrosAplicados = {
      desde: this.fechaDesde(),
      hasta: this.fechaHasta(),
      vendedorId: this.filtroVendedorId(),
    };
    this.haBuscado.set(true);
    this.paginaActual.set(1);
    void this.cargarListado();
  }

  protected irAPaginaAnterior(): void {
    if (this.paginaActual() <= 1) return;
    this.paginaActual.update((p) => p - 1);
    void this.cargarListado();
  }

  protected irAPaginaSiguiente(): void {
    if (this.paginaActual() >= this.totalPaginas()) return;
    this.paginaActual.update((p) => p + 1);
    void this.cargarListado();
  }
}

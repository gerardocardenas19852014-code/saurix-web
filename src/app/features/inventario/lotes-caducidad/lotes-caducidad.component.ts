import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { fuenteDatosActual } from '../../../core/services/fuente-datos';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { SelectBuscableComponent, OpcionBuscable } from '../../../shared/components/select-buscable/select-buscable.component';
import { ToastService } from '../../../shared/services/toast.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { LoteProducto } from './lote-producto.model';
import { Producto } from '../productos/producto.model';
import { Bodega } from '../bodegas/bodega.model';
import { diasParaCaducar } from './lote-producto.util';

interface FilaLote {
  id: number;
  productoId: number;
  productoCodigo: string | null;
  productoNombre: string;
  bodegaId: number | null;
  bodegaNombre: string | null;
  lote: string;
  fechaCaducidad: string | null;
  dias: number | null;
  cantidad: number | null;
  notas: string | null;
  activo: boolean;
}

type FiltroEstado = '' | 'vigente' | 'proximo' | 'vencido';
type CampoOrden = 'fecha_caducidad' | 'producto' | 'lote' | 'bodega' | 'cantidad' | 'dias' | 'activo';

/** Umbral de días para "próximo a vencer" — MISMO criterio que ya tenía esta
 *  pantalla (ver lote-producto.util.ts/diasParaCaducar()); ahora también es
 *  el que usa fn_lotes_resumen()/fn_lotes_listar() en PostgreSQL, para no
 *  tener dos reglas distintas entre frontend y backend. */
const UMBRAL_PROXIMOS_DIAS = 30;

/**
 * Registro de lotes con fecha de caducidad (ver LoteProducto — es un
 * registro INFORMATIVO aparte: no reemplaza la existencia por bodega, la
 * cantidad aquí se captura aparte — ver el comentario completo en
 * lote-producto.model.ts). Solo permite elegir productos con
 * Producto.manejaLotes === true.
 *
 * Homologación 28-oct-2026: antes esta pantalla cargaba TODO
 * LoteProducto/Producto/Bodega de la empresa al entrar y filtraba/ordenaba
 * 100% en memoria — inviable con 200,000+ productos y cientos de miles de
 * lotes. Ahora (modo Supabase):
 *  - El campo "Buscar producto…" es un autocomplete remoto (debounce
 *    300 ms, hasta 15 resultados) contra fn_lotes_productos_autocomplete()
 *    — solo productos con manejaLotes=true, nunca el catálogo completo.
 *  - Bodega/Lote/Estado/Mostrar inactivos quedan en memoria hasta
 *    presionar "🔍 Buscar" (cambiarFiltro()) — igual que Productos y
 *    servicios/Órdenes de compra/Kardex: ningún filtro dispara una
 *    consulta por sí solo. Cambiar de página o de ordenamiento SÍ recarga
 *    de inmediato (igual que ValorStockComponent.cambiarOrdenProductos()).
 *  - El listado se pide paginado y ordenado server-side contra
 *    fn_lotes_listar() (PostgreSQL arma el ORDER BY dinámico con un
 *    whitelist de columnas vía format()/%I, mismo patrón ya probado en
 *    fn_valor_stock_productos()) — nunca se descargan todos los lotes para
 *    ordenar/paginar en Angular.
 *  - "Próximos a vencer"/"Vencidos" se piden a fn_lotes_resumen(), que hace
 *    dos count(*) filter(...) en PostgreSQL — nunca se derivan descargando
 *    lotes. Son conteos GLOBALES (activos, sin filtros de pantalla aplicados)
 *    — igual que el comportamiento anterior, que los calculaba sobre
 *    this.lotes() completo, no sobre filasLotes() ya filtrado.
 *  - El modal "Nuevo/Editar lote" también cambia su selector de Producto a
 *    autocomplete remoto (antes cargaba todo Producto con manejaLotes=true
 *    en memoria) — Bodega se queda igual (catálogo chico, sin problema de
 *    escala). Las validaciones/guardar()/eliminar() NO cambian.
 *
 * Modo IndexedDB local (catálogos de prueba, chicos): mismo cálculo de
 * siempre, cargado una sola vez bajo demanda, ahora respetando los mismos
 * filtros/orden/paginación que el modo Supabase.
 */
@Component({
  selector: 'app-lotes-caducidad',
  standalone: true,
  imports: [ReactiveFormsModule, ConfirmDialogComponent, SelectBuscableComponent],
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

  private readonly esSupabase = fuenteDatosActual() === 'supabase';
  private readonly sb = this.esSupabase ? inject(SupabaseService).cliente : null;

  // ── Catálogo de bodegas (chico, siempre completo en ambos modos) ───────
  protected readonly bodegas = signal<Bodega[]>([]);
  protected readonly bodegasActivas = computed(() => this.bodegas().filter((b) => b.activo !== false));
  protected readonly opcionesBodega = computed<OpcionBuscable[]>(() =>
    this.bodegasActivas().map((b) => ({ valor: b.id, etiqueta: b.nombre })),
  );
  private nombreBodega(id: number | null): string | null {
    if (id === null) return null;
    return this.bodegas().find((b) => b.id === id)?.nombre ?? '—';
  }

  // ── Filtro de producto (autocomplete remoto — ver buscarProductosRemoto()) ─
  protected readonly filtroProductoId = signal(0);
  private readonly catalogoAutocomplete = new Map<number, { codigo: string; nombre: string }>();

  // ── Resto de filtros — igual que Productos y servicios/Órdenes de
  // compra: son los mismos signals que lee la consulta, pero NINGUNO
  // dispara una consulta por sí solo; solo cambiarFiltro() ("🔍 Buscar"). ──
  protected readonly filtroBodegaId = signal(0);
  protected readonly filtroLote = signal('');
  protected readonly filtroEstado = signal<FiltroEstado>('');
  protected readonly mostrarInactivos = signal(false);
  protected readonly ordenCampo = signal<CampoOrden>('fecha_caducidad');
  protected readonly ordenDireccion = signal<'asc' | 'desc'>('asc');
  protected readonly paginaActual = signal(1);
  protected readonly busquedaRealizada = signal(false);

  protected readonly cargando = signal(false);
  protected readonly cargandoResumen = signal(false);
  protected readonly totalProximos = signal(0);
  protected readonly totalVencidos = signal(0);
  protected readonly filasListado = signal<FilaLote[]>([]);
  protected readonly totalFilasFiltradas = signal(0);

  protected readonly totalPaginas = computed(() =>
    Math.max(1, Math.ceil(this.totalFilasFiltradas() / this.tamanioPagina())),
  );

  // Protección contra respuestas fuera de orden (ver KardexComponent/
  // OrdenesCompraComponent): si el usuario cambia de filtro/página varias
  // veces rápido, una respuesta vieja nunca debe pisar la más reciente.
  private secuenciaListado = 0;

  protected readonly modalAbierto = signal(false);
  protected readonly loteEnEdicion = signal<FilaLote | null>(null);
  protected readonly loteAEliminar = signal<FilaLote | null>(null);

  protected readonly etiquetaProductoEdicion = computed(() => {
    const lote = this.loteEnEdicion();
    if (!lote) return null;
    return lote.productoCodigo ? `${lote.productoCodigo} — ${lote.productoNombre}` : lote.productoNombre;
  });

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

  /** Igual que ProductosComponent/OrdenesCompraComponent: true indica si el
   *  usuario YA cambió algún filtro del valor inicial — sirve para distinguir
   *  "no hay ningún lote" de "los filtros no encontraron nada" (ver plantilla). */
  protected readonly hayFiltrosActivos = computed(
    () =>
      this.filtroProductoId() !== 0 ||
      this.filtroBodegaId() !== 0 ||
      this.filtroLote().trim() !== '' ||
      this.filtroEstado() !== '' ||
      this.mostrarInactivos(),
  );

  ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid'); // ancho completo
    this.cargarBodegas();
    this.cargarResumen();
    // La tabla arranca vacía hasta que el usuario haga click en "Buscar"
    // (ver busquedaRealizada/cambiarFiltro()) — mismo patrón que
    // ProductosComponent/OrdenesCompraComponent. Los cards de arriba
    // (Próximos a vencer/Vencidos) sí se cargan de inmediato: son conteos
    // globales, no dependen de los filtros de esta barra.
  }

  private cargarBodegas(): void {
    if (this.esSupabase) {
      firstValueFrom(this.data.list<Bodega>('Bodega')).then((bodegas) => this.bodegas.set(bodegas));
    } else {
      this.cargarBaseLocal().then(() => this.bodegas.set(this.bodegasLocal));
    }
  }

  private tamanioPagina(): number {
    return Math.max(1, this.preferenciasGrid.tamanoPagina());
  }

  /** Autocomplete remoto de Producto — SOLO productos con manejaLotes=true
   *  (distinto filtro al de fn_productos_autocomplete/
   *  fn_kardex_productos_autocomplete, por eso una función aparte). Guarda
   *  cada resultado en catalogoAutocomplete para poder resolver código/nombre
   *  sin otra consulta (p.ej. al reabrir el modal de edición). */
  protected readonly buscarProductosRemoto = async (texto: string): Promise<OpcionBuscable[]> => {
    const limite = 15;
    if (this.esSupabase) {
      const { data, error } = await this.sb!.schema('inventario').rpc('fn_lotes_productos_autocomplete', {
        p_busqueda: texto || null,
        p_limite: limite,
      });
      if (error) return [];
      const filas = (data ?? []) as Record<string, unknown>[];
      for (const f of filas) {
        this.catalogoAutocomplete.set(Number(f['id']), { codigo: String(f['codigo'] ?? ''), nombre: String(f['nombre']) });
      }
      return filas.map((f) => {
        const codigo = f['codigo'] ? String(f['codigo']) : null;
        const unidad = f['unidad_nombre'] ? String(f['unidad_nombre']) : null;
        const etiqueta = [codigo, String(f['nombre']), unidad].filter((p) => !!p).join(' — ');
        return { valor: Number(f['id']), etiqueta };
      });
    }
    await this.cargarBaseLocal();
    const termino = texto.trim().toLowerCase();
    const candidatos = this.productosLocal.filter((p) => p.activo && p.manejaLotes);
    const filtrados = termino
      ? candidatos.filter((p) => p.nombre.toLowerCase().includes(termino) || (p.codigo ?? '').toLowerCase().includes(termino))
      : candidatos;
    for (const p of filtrados.slice(0, limite)) {
      this.catalogoAutocomplete.set(p.id, { codigo: p.codigo ?? '', nombre: p.nombre });
    }
    return filtrados.slice(0, limite).map((p) => ({ valor: p.id, etiqueta: p.codigo ? `${p.codigo} — ${p.nombre}` : p.nombre }));
  };

  /** Cualquier cambio de filtro vuelve a la página 1. Solo se llama desde el
   *  botón "🔍 Buscar" — ningún filtro dispara una consulta por sí solo. */
  protected cambiarFiltro(): void {
    this.paginaActual.set(1);
    this.busquedaRealizada.set(true);
    this.cargarListado();
  }

  /** Columnas ordenables server-side — clic en el encabezado, mismo patrón
   *  que ValorStockComponent.cambiarOrdenProductos(): mismo campo invierte
   *  dirección, campo distinto empieza en ascendente. Recarga de inmediato
   *  (no espera a "Buscar"). */
  protected cambiarOrden(campo: CampoOrden): void {
    if (this.ordenCampo() === campo) {
      this.ordenDireccion.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.ordenCampo.set(campo);
      this.ordenDireccion.set('asc');
    }
    this.paginaActual.set(1);
    this.cargarListado();
  }

  protected irAPaginaAnterior(): void {
    if (this.paginaActual() <= 1) return;
    this.paginaActual.update((p) => p - 1);
    this.cargarListado();
  }

  protected irAPaginaSiguiente(): void {
    if (this.paginaActual() >= this.totalPaginas()) return;
    this.paginaActual.update((p) => p + 1);
    this.cargarListado();
  }

  /** Próximos a vencer / Vencidos — conteos GLOBALES (activos, sin
   *  filtros de pantalla), vía fn_lotes_resumen(): dos count(*) filter(...)
   *  en PostgreSQL, nunca descargando lotes a Angular. Se recarga al entrar
   *  y después de crear/editar/eliminar un lote (puede cambiar el conteo). */
  private async cargarResumen(): Promise<void> {
    this.cargandoResumen.set(true);
    if (this.esSupabase) {
      const { data, error } = await this.sb!.schema('inventario').rpc('fn_lotes_resumen');
      if (!error) {
        const fila = ((data ?? []) as Record<string, unknown>[])[0];
        this.totalProximos.set(Number(fila?.['total_proximos'] ?? 0));
        this.totalVencidos.set(Number(fila?.['total_vencidos'] ?? 0));
      }
    } else {
      await this.cargarBaseLocal();
      const activos = this.lotesLocal.filter((l) => l.activo);
      this.totalProximos.set(
        activos.filter((l) => {
          const d = diasParaCaducar(l.fechaCaducidad);
          return d !== null && d >= 0 && d <= UMBRAL_PROXIMOS_DIAS;
        }).length,
      );
      this.totalVencidos.set(activos.filter((l) => (diasParaCaducar(l.fechaCaducidad) ?? 1) < 0).length);
    }
    this.cargandoResumen.set(false);
  }

  /** Página del listado — ver fn_lotes_listar(). */
  private async cargarListado(): Promise<void> {
    this.cargando.set(true);
    const miSecuencia = ++this.secuenciaListado;
    const resultado = this.esSupabase ? await this.cargarListadoSupabase() : await this.cargarListadoLocal();
    if (miSecuencia !== this.secuenciaListado) return; // respuesta vieja — descartar
    // Si la página en la que estábamos quedó vacía (filtro nuevo con menos
    // páginas que la posición actual), retrocede a la última página real —
    // mismo criterio que ProductosComponent/OrdenesCompraComponent/KardexComponent.
    if (resultado.filas.length === 0 && this.paginaActual() > 1 && resultado.total > 0) {
      this.paginaActual.set(Math.max(1, Math.ceil(resultado.total / this.tamanioPagina())));
      this.cargando.set(false);
      await this.cargarListado();
      return;
    }
    this.filasListado.set(resultado.filas);
    this.totalFilasFiltradas.set(resultado.total);
    this.cargando.set(false);
  }

  private async cargarListadoSupabase(): Promise<{ filas: FilaLote[]; total: number }> {
    const tamanio = this.tamanioPagina();
    const desde = (this.paginaActual() - 1) * tamanio;
    const { data, error } = await this.sb!.schema('inventario').rpc('fn_lotes_listar', {
      p_producto_id: this.filtroProductoId() || null,
      p_bodega_id: this.filtroBodegaId() || null,
      p_busqueda_lote: this.filtroLote().trim() || null,
      p_estado: this.filtroEstado() || null,
      p_incluir_inactivos: this.mostrarInactivos(),
      p_orden: this.ordenCampo(),
      p_direccion: this.ordenDireccion(),
      p_desde: desde,
      p_cantidad: tamanio,
    });
    if (error) {
      this.toast.error('No se pudo cargar el listado de lotes: ' + error.message);
      return { filas: [], total: 0 };
    }
    const filas = (data ?? []) as Record<string, unknown>[];
    return {
      filas: filas.map((f) => ({
        id: Number(f['id']),
        productoId: Number(f['producto_id']),
        productoCodigo: f['producto_codigo'] ? String(f['producto_codigo']) : null,
        productoNombre: String(f['producto_nombre']),
        bodegaId: f['bodega_id'] !== null ? Number(f['bodega_id']) : null,
        bodegaNombre: f['bodega_nombre'] ? String(f['bodega_nombre']) : null,
        lote: String(f['lote']),
        fechaCaducidad: f['fecha_caducidad'] ? String(f['fecha_caducidad']) : null,
        dias: f['dias'] !== null && f['dias'] !== undefined ? Number(f['dias']) : null,
        cantidad: f['cantidad'] !== null && f['cantidad'] !== undefined ? Number(f['cantidad']) : null,
        notas: f['notas'] ? String(f['notas']) : null,
        activo: Boolean(f['activo']),
      })),
      total: Number(filas[0]?.['total'] ?? 0),
    };
  }

  /** Modo IndexedDB local — mismo filtro/orden/paginación que el modo
   *  Supabase, sobre el catálogo completo cargado una sola vez bajo demanda
   *  (sin problema de escala real a este tamaño). */
  private async cargarListadoLocal(): Promise<{ filas: FilaLote[]; total: number }> {
    await this.cargarBaseLocal();
    const productoId = this.filtroProductoId();
    const bodegaId = this.filtroBodegaId();
    const textoLote = this.filtroLote().trim().toLowerCase();
    const estado = this.filtroEstado();
    const incluirInactivos = this.mostrarInactivos();

    let filtradas = this.lotesLocal
      .filter((l) => incluirInactivos || l.activo)
      .filter((l) => !productoId || l.productoId === productoId)
      .filter((l) => !bodegaId || l.bodegaId === bodegaId)
      .filter((l) => !textoLote || l.lote.toLowerCase().includes(textoLote))
      .map((l) => ({
        id: l.id,
        productoId: l.productoId,
        productoCodigo: this.productosLocal.find((p) => p.id === l.productoId)?.codigo ?? null,
        productoNombre: this.productosLocal.find((p) => p.id === l.productoId)?.nombre ?? '—',
        bodegaId: l.bodegaId,
        bodegaNombre: this.nombreBodega(l.bodegaId),
        lote: l.lote,
        fechaCaducidad: l.fechaCaducidad,
        dias: diasParaCaducar(l.fechaCaducidad),
        cantidad: l.cantidad,
        notas: l.notas,
        activo: l.activo,
      }));

    if (estado === 'vigente') filtradas = filtradas.filter((f) => f.dias !== null && f.dias > UMBRAL_PROXIMOS_DIAS);
    else if (estado === 'proximo') filtradas = filtradas.filter((f) => f.dias !== null && f.dias >= 0 && f.dias <= UMBRAL_PROXIMOS_DIAS);
    else if (estado === 'vencido') filtradas = filtradas.filter((f) => f.dias !== null && f.dias < 0);

    const campo = this.ordenCampo();
    const direccion = this.ordenDireccion() === 'desc' ? -1 : 1;
    const comparar = (a: FilaLote, b: FilaLote): number => {
      let cmp: number;
      switch (campo) {
        case 'producto':
          cmp = a.productoNombre.localeCompare(b.productoNombre);
          break;
        case 'lote':
          cmp = a.lote.localeCompare(b.lote);
          break;
        case 'bodega':
          cmp = (a.bodegaNombre ?? '').localeCompare(b.bodegaNombre ?? '');
          break;
        case 'cantidad':
          cmp = (a.cantidad ?? -Infinity) - (b.cantidad ?? -Infinity);
          break;
        case 'dias':
          cmp = (a.dias ?? Infinity) - (b.dias ?? Infinity);
          break;
        case 'activo':
          cmp = Number(a.activo) - Number(b.activo);
          break;
        default:
          cmp = (a.fechaCaducidad ?? '9999-99-99').localeCompare(b.fechaCaducidad ?? '9999-99-99');
      }
      return cmp !== 0 ? cmp * direccion : a.id - b.id; // id como segundo criterio estable
    };
    filtradas.sort(comparar);

    const tamanio = this.tamanioPagina();
    const inicioPagina = (this.paginaActual() - 1) * tamanio;
    return { filas: filtradas.slice(inicioPagina, inicioPagina + tamanio), total: filtradas.length };
  }

  nuevo(): void {
    this.loteEnEdicion.set(null);
    this.form.reset({ id: 0, productoId: 0, bodegaId: 0, lote: '', fechaCaducidad: '', cantidad: null, notas: '', activo: true });
    this.modalAbierto.set(true);
  }

  editar(lote: FilaLote): void {
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
        this.cargarResumen();
        this.cargarListado();
      },
    });
  }

  pedirEliminar(lote: FilaLote): void {
    this.loteAEliminar.set(lote);
  }

  confirmarEliminar(): void {
    const lote = this.loteAEliminar();
    if (!lote) return;

    this.data.baja('LoteProducto', lote.id).subscribe({
      next: () => {
        this.toast.exito('Lote eliminado.');
        this.loteAEliminar.set(null);
        this.cargarResumen();
        this.cargarListado();
      },
    });
  }

  // ── Catálogos locales (solo IndexedDB) — cargados una sola vez bajo
  // demanda, nunca al abrir la pantalla. ──────────────────────────────────
  private baseLocalCargada = false;
  private productosLocal: Producto[] = [];
  private bodegasLocal: Bodega[] = [];
  private lotesLocal: LoteProducto[] = [];

  private async cargarBaseLocal(): Promise<void> {
    if (this.baseLocalCargada) return;
    const [productos, bodegas, lotes] = await Promise.all([
      firstValueFrom(this.data.list<Producto>('Producto')),
      firstValueFrom(this.data.list<Bodega>('Bodega')),
      firstValueFrom(this.data.list<LoteProducto>('LoteProducto')),
    ]);
    this.productosLocal = productos;
    this.bodegasLocal = bodegas;
    this.lotesLocal = lotes;
    this.baseLocalCargada = true;
  }
}

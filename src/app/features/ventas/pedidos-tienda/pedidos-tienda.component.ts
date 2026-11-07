import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { formatMoneda } from '../ventas.util';
import { CargaVentaPedidoTiendaService } from '../carga-venta-pedido-tienda.service';
import { EstadoPedidoTienda, FilaPedidoTienda, OrigenPedidoTienda, PedidoTienda } from './pedido-tienda.model';
import { PedidoTiendaService } from './pedido-tienda.service';

/**
 * "Pedidos web" — bandeja de los pedidos que llegan de la tienda pública
 * (/tienda/:clave, ver catalogo-tienda.component.ts). Muestra DOS orígenes
 * en la misma bandeja (ver ventas.pedido_tienda.origen — nunca se infiere,
 * lo pone el servidor):
 *   - 'pedido_web': el pedido real se manda por WhatsApp, esto solo queda
 *     de registro ligero para no volver a teclearlo.
 *   - 'menu_qr': "Mostrar en caja" del modo Menú + Mi orden — NO es un
 *     pedido en línea, es solo una intención que el cliente muestra en
 *     caja con folio/QR.
 *
 * Fase 5 (2026-11, "unificación de Pedidos web con Cobro"): ANTES había
 * DOS caminos a venta para 'pedido_web' ("Cargar a venta" hacia Cobro, y
 * un botón/modal independiente "Confirmar venta" que llamaba
 * PedidoTiendaService.confirmarComoVenta() directo, SIN revalidar precio/
 * stock del servidor). Ese segundo camino se retiró aquí — "Cargar a
 * venta" (cargarAVenta() abajo) es ahora el ÚNICO camino a venta para los
 * 2 orígenes, consistente con lo que ya hacía 'menu_qr'.
 *
 * Dependencia ya RESUELTA (ver claude/fase5-propuesta-atomicidad-pedido-venta-2026-11.md
 * y claude/fase5-entrega-final-parteB-2026-11.md del proyecto): "Cargar a
 * venta" registraba antes la Venta y vinculaba el pedido en DOS pasos
 * separados (CobroComponent.confirmarCobro(): VentaService.registrar() +
 * PedidoTiendaService.marcarConfirmadoDesdeVenta() aparte) — no atómico,
 * con riesgo real de venta duplicada si el segundo paso fallaba. Desde
 * Fase 5 Parte B (2026-11), confirmarCobro() usa
 * VentaService.registrarDesdePedidoTienda() →
 * ventas.fn_pedido_tienda_cargar_a_venta(), que hace candado + registro de
 * la venta + actualización del pedido en UNA sola transacción atómica e
 * idempotente. marcarConfirmadoDesdeVenta() ya no tiene ningún llamador
 * real (queda en PedidoTiendaService como código muerto, sin retirar
 * todavía por no haber sido pedido explícitamente).
 *
 * Bandeja paginada/filtrada del lado del servidor (ver
 * ventas.fn_pedidos_tienda_listar() y PedidoTiendaService.listar()) — mismo
 * criterio de rendimiento que Kardex/movimientos de bodega: nunca se
 * descarga la tabla completa ni se filtra/pagina en el navegador, ningún
 * filtro dispara una consulta por sí solo (solo "🔍 Buscar"/Enter), y "Ver
 * detalle" trae el pedido completo A DEMANDA (getById), nunca junto con el
 * listado (sin N+1 — la fila de la cuadrícula es FilaPedidoTienda, mucho
 * más chica que el PedidoTienda completo con items/ubicación/notas).
 */
@Component({
  selector: 'app-pedidos-tienda',
  standalone: true,
  imports: [ConfirmDialogComponent, DatePipe],
  templateUrl: './pedidos-tienda.component.html',
  styleUrl: './pedidos-tienda.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PedidosTiendaComponent implements OnInit, OnDestroy {
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  private readonly data = inject(DataClientService);
  private readonly pedidoTiendaService = inject(PedidoTiendaService);
  private readonly cargaVentaPedidoTienda = inject(CargaVentaPedidoTiendaService);
  private readonly router = inject(Router);
  protected readonly toast = inject(ToastService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);
  protected readonly formatMoneda = formatMoneda;

  protected readonly cargando = signal(true);
  protected readonly cargandoDetalle = signal(false);
  protected readonly filas = signal<FilaPedidoTienda[]>([]);
  protected readonly totalFilas = signal(0);

  // ── Filtros — server-side: ningún cambio dispara una consulta por sí
  //    solo, solo el botón "🔍 Buscar" (o Enter en el buscador), ver
  //    cambiarFiltro() — mismo criterio que Kardex/movimientos de bodega. ──
  protected readonly busqueda = signal('');
  protected readonly fechaDesde = signal(this.hoyISO());
  protected readonly fechaHasta = signal(this.hoyISO());
  protected readonly filtroEstado = signal<EstadoPedidoTienda | 'Todos'>('Todos');
  protected readonly filtroOrigen = signal<OrigenPedidoTienda | 'Todos'>('Todos');

  // ── Paginación — real (OFFSET/LIMIT server-side), no slice() en memoria. ──
  protected readonly paginaActual = signal(1);
  protected readonly totalPaginas = computed(() => Math.max(1, Math.ceil(this.totalFilas() / this.tamanioPagina())));

  /** Evita que una respuesta vieja (petición lenta) pise el resultado de
   *  una búsqueda/página/confirmación/descarte más reciente — mismo
   *  patrón que KardexComponent.secuenciaListado /
   *  MovimientosBodegaComponent.secuenciaHistorial (homologación Fase 1,
   *  "Prompt maestro" nov-2026: esta pantalla ya decía seguir ese mismo
   *  criterio pero le faltaba esta guarda). */
  private secuenciaPedidos = 0;

  async ngOnInit(): Promise<void> {
    document.documentElement.setAttribute('data-wide', 'grid'); // ancho completo
    await this.cargarPedidos();
  }

  private hoyISO(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private tamanioPagina(): number {
    return Math.max(1, this.preferenciasGrid.tamanoPagina());
  }

  private async cargarPedidos(): Promise<void> {
    this.cargando.set(true);
    const miSecuencia = ++this.secuenciaPedidos;
    const tamanio = this.tamanioPagina();
    const desde = (this.paginaActual() - 1) * tamanio;
    const estado = this.filtroEstado();
    const origen = this.filtroOrigen();
    try {
      const resultado = await this.pedidoTiendaService.listar(
        {
          desdeFecha: this.fechaDesde() || null,
          hastaFecha: this.fechaHasta() || null,
          estado: estado === 'Todos' ? null : estado,
          origen: origen === 'Todos' ? null : origen,
          busqueda: this.busqueda() || null,
        },
        desde,
        tamanio,
      );
      if (miSecuencia !== this.secuenciaPedidos) return; // ya respondió una búsqueda/página/acción más nueva — descartar esta
      // Si la página actual quedó vacía (p.ej. se eliminó la última fila de
      // la última página), regresa a la última página real con datos —
      // mismo criterio que Kardex.
      if (resultado.filas.length === 0 && this.paginaActual() > 1 && resultado.total > 0) {
        this.paginaActual.set(Math.max(1, Math.ceil(resultado.total / tamanio)));
        return this.cargarPedidos();
      }
      this.filas.set(resultado.filas);
      this.totalFilas.set(resultado.total);
    } catch (e) {
      if (miSecuencia !== this.secuenciaPedidos) return; // ya hay una más nueva en curso — no pisarla con este error
      this.toast.error('No se pudo cargar la bandeja de pedidos: ' + (e instanceof Error ? e.message : 'error desconocido'));
    } finally {
      if (miSecuencia === this.secuenciaPedidos) this.cargando.set(false);
    }
  }

  /** Único disparador de los filtros — ver el comentario grande arriba. */
  protected cambiarFiltro(): void {
    this.paginaActual.set(1);
    this.cargarPedidos();
  }

  protected irAPaginaAnterior(): void {
    if (this.paginaActual() <= 1) return;
    this.paginaActual.update((p) => p - 1);
    this.cargarPedidos();
  }

  protected irAPaginaSiguiente(): void {
    if (this.paginaActual() >= this.totalPaginas()) return;
    this.paginaActual.update((p) => p + 1);
    this.cargarPedidos();
  }

  // ── Detalle / confirmación / descarte ──────────────────────────────
  protected readonly pedidoDetalle = signal<PedidoTienda | null>(null);
  protected readonly pedidoADescartar = signal<PedidoTienda | null>(null);
  protected readonly pedidoAEliminar = signal<FilaPedidoTienda | null>(null);

  /** A demanda — nunca se trae junto con el listado (ver el comentario
   *  grande arriba). */
  async verDetalle(fila: FilaPedidoTienda): Promise<void> {
    this.cargandoDetalle.set(true);
    try {
      const pedido = await firstValueFrom(this.data.getById<PedidoTienda>('PedidoTienda', fila.id));
      this.pedidoDetalle.set(pedido);
    } catch (e) {
      this.toast.error('No se pudo abrir el detalle: ' + (e instanceof Error ? e.message : 'error desconocido'));
    } finally {
      this.cargandoDetalle.set(false);
    }
  }

  cerrarDetalle(): void {
    this.pedidoDetalle.set(null);
  }

  pedirDescartar(pedido: PedidoTienda): void {
    this.pedidoADescartar.set(pedido);
  }

  async confirmarDescartar(): Promise<void> {
    const pedido = this.pedidoADescartar();
    if (!pedido) return;

    const actualizado = await this.pedidoTiendaService.descartar(pedido);
    this.toast.exito('Pedido descartado.');
    this.pedidoADescartar.set(null);
    this.pedidoDetalle.set(actualizado);
    await this.cargarPedidos();
  }

  pedirEliminar(fila: FilaPedidoTienda): void {
    this.pedidoAEliminar.set(fila);
  }

  async confirmarEliminar(): Promise<void> {
    const fila = this.pedidoAEliminar();
    if (!fila) return;

    await firstValueFrom(this.data.baja('PedidoTienda', fila.id));
    this.toast.exito('Pedido eliminado.');
    this.pedidoAEliminar.set(null);
    if (this.pedidoDetalle()?.id === fila.id) this.pedidoDetalle.set(null);
    await this.cargarPedidos();
  }

  /** "Cargar a venta" — único camino a venta para los 2 orígenes desde
   *  Fase 5 (ver el comentario grande de la clase). Revalida precio/
   *  disponibilidad del lado del servidor (nunca confía en el total/
   *  precio guardado en el pedido/orden, sección 30 del plan), precarga
   *  el carrito de Cobro vía CargaVentaPedidoTiendaService y navega ahí.
   *  El cajero sigue pudiendo editar TODO antes de cobrar — esto no
   *  registra ninguna venta por sí solo ("cargar a venta" ≠ "venta
   *  cobrada"). */
  protected async cargarAVenta(pedido: PedidoTienda): Promise<void> {
    // Reclamo atómico (Bloque G) ANTES de revalidar/navegar — ver el
    // comentario grande de PedidoTiendaService.reclamar(): nunca se decide
    // aquí si otro cajero ya lo tiene, eso lo resuelve el UPDATE condicionado
    // del lado del servidor.
    const reclamado = await this.pedidoTiendaService.reclamar(pedido.id);
    if (!reclamado) {
      this.toast.advertencia('Este pedido ya está siendo atendido en otra caja (o ya cambió de estado).');
      await this.cargarPedidos();
      return;
    }
    try {
      const lineas = await this.pedidoTiendaService.revalidarItems(pedido.id);
      if (lineas.length === 0) {
        this.toast.advertencia('Este pedido no tiene productos que cargar.');
        this.pedidoTiendaService.liberar(pedido.id).catch(() => {});
        return;
      }
      const conProblema = lineas.filter((l) => !l.disponible);
      if (conProblema.length > 0) {
        this.toast.advertencia(
          `Revisa en Cobro: ${conProblema.map((l) => `${l.descripcion} — ${l.motivo}`).join(' · ')}`,
        );
      }
      const nombre = pedido.nombreCliente ?? pedido.nombreMostrarEn;
      const etiquetaOrigen = pedido.origen === 'menu_qr' ? 'Menú QR' : 'Tienda en línea';
      const canal = [etiquetaOrigen, pedido.folio, nombre].filter(Boolean).join(' — ');
      this.cargaVentaPedidoTienda.fijar({ pedidoId: pedido.id, canal, lineas });
      this.cerrarDetalle();
      await this.router.navigateByUrl('/ventas/cobro');
    } catch (e) {
      this.toast.error('No se pudo cargar el pedido a Cobro: ' + (e instanceof Error ? e.message : 'error desconocido'));
      this.pedidoTiendaService.liberar(pedido.id).catch(() => {});
    }
  }

}

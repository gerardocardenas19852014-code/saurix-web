import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { AuthService } from '../../../core/services/auth.service';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { Bodega } from '../../inventario/bodegas/bodega.model';
import { ClienteService } from '../clientes/cliente.service';
import { MetodoPago, METODOS_PAGO } from '../venta/venta.model';
import { TurnoCajaService } from '../turno/turno-caja.service';
import { formatMoneda } from '../ventas.util';
import { CargaVentaPedidoTiendaService } from '../carga-venta-pedido-tienda.service';
import { EstadoPedidoTienda, FilaPedidoTienda, OrigenPedidoTienda, PedidoTienda } from './pedido-tienda.model';
import { PedidoTiendaService } from './pedido-tienda.service';

/**
 * "Pedidos web" — bandeja de los pedidos que llegan de la tienda pública
 * (/tienda/:clave, ver catalogo-tienda.component.ts). Desde el plan "Menú +
 * Mi orden" (2026-10/11) muestra DOS orígenes en la misma bandeja (ver
 * ventas.pedido_tienda.origen — nunca se infiere, lo pone el servidor):
 *   - 'pedido_web': el flujo de siempre — el pedido real se manda por
 *     WhatsApp, esto solo queda de registro ligero para no volver a
 *     teclearlo. "Confirmar venta" arma la Venta real con
 *     PedidoTiendaService (mismo VentaService que usa Cobro).
 *   - 'menu_qr': "Mostrar en caja" del modo Menú + Mi orden — NO es un
 *     pedido en línea, es solo una intención que el cliente muestra en
 *     caja con folio/QR. Todavía no tiene un camino a venta (eso es el
 *     Bloque E — "Cargar a venta" hacia Cobro con revalidación de
 *     precio/stock): por ahora solo se puede ver y descartar aquí.
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
  imports: [ReactiveFormsModule, ConfirmDialogComponent, DatePipe],
  templateUrl: './pedidos-tienda.component.html',
  styleUrl: './pedidos-tienda.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PedidosTiendaComponent implements OnInit, OnDestroy {
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  private readonly data = inject(DataClientService);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly clienteService = inject(ClienteService);
  private readonly turnoCajaService = inject(TurnoCajaService);
  private readonly pedidoTiendaService = inject(PedidoTiendaService);
  private readonly cargaVentaPedidoTienda = inject(CargaVentaPedidoTiendaService);
  private readonly router = inject(Router);
  protected readonly toast = inject(ToastService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);
  protected readonly formatMoneda = formatMoneda;
  protected readonly metodosPago = METODOS_PAGO;

  protected readonly cargando = signal(true);
  protected readonly cargandoDetalle = signal(false);
  protected readonly filas = signal<FilaPedidoTienda[]>([]);
  protected readonly totalFilas = signal(0);
  protected readonly bodegas = signal<Bodega[]>([]);

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

  async ngOnInit(): Promise<void> {
    document.documentElement.setAttribute('data-wide', 'grid'); // ancho completo
    await Promise.all([this.cargarBodegas(), this.cargarPedidos()]);
  }

  private hoyISO(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private tamanioPagina(): number {
    return Math.max(1, this.preferenciasGrid.tamanoPagina());
  }

  private async cargarBodegas(): Promise<void> {
    const bodegas = await firstValueFrom(this.data.list<Bodega>('Bodega'));
    this.bodegas.set(bodegas.filter((b) => b.activo !== false));
    this.bodegaConversionId.set(this.bodegas()[0]?.id ?? null);
  }

  private async cargarPedidos(): Promise<void> {
    this.cargando.set(true);
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
      this.toast.error('No se pudo cargar la bandeja de pedidos: ' + (e instanceof Error ? e.message : 'error desconocido'));
    } finally {
      this.cargando.set(false);
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

  protected readonly modalConfirmarAbierto = signal(false);
  protected readonly bodegaConversionId = signal<number | null>(null);
  protected readonly confirmando = signal(false);

  protected readonly confirmarForm = this.fb.nonNullable.group({
    metodoPago: ['Efectivo' as MetodoPago, Validators.required],
  });

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

  /** "Cargar a venta" (Bloque E) — revalida precio/disponibilidad del lado
   *  del servidor (nunca confía en el total/precio guardado en el
   *  pedido/orden, sección 30 del plan), precarga el carrito de Cobro vía
   *  CargaVentaPedidoTiendaService y navega ahí. El cajero sigue pudiendo
   *  editar TODO antes de cobrar — esto no registra ninguna venta por sí
   *  solo ("cargar a venta" ≠ "venta cobrada"). Disponible para los 2
   *  orígenes: para 'pedido_web' coexiste con "Confirmar venta" (el
   *  flujo directo de siempre, que sigue intacto); para 'menu_qr' es el
   *  único camino a venta por ahora. */
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

  async abrirConfirmar(): Promise<void> {
    const usuario = this.auth.usuarioActual();
    const pedido = this.pedidoDetalle();
    if (!usuario || !pedido) return;
    // "Confirmar venta" (finaliza directo, sin pasar por Cobro) sigue
    // siendo exclusivo de 'pedido_web' — para 'menu_qr' falta "Cargar a
    // venta" con revalidación de precio/stock (Bloque E); el botón ya no
    // se muestra para 'menu_qr' en el HTML, esto es la misma defensa que
    // ya se aplicó en abrirEnvio() de la tienda pública.
    if (pedido.origen !== 'pedido_web') return;

    // turnoAbiertoOCrear(): si "Apertura de caja" está desactivada, abre uno
    // en silencio en vez de bloquear — ver su comentario en TurnoCajaService.
    const turno = await this.turnoCajaService.turnoAbiertoOCrear(usuario.id);
    if (!turno) {
      this.toast.advertencia('Abre un turno de caja antes de confirmar un pedido como venta.');
      return;
    }

    // Reclamo atómico (Bloque G) — ver cargarAVenta() arriba, mismo
    // mecanismo: confirmar directo también puede chocar con otro cajero
    // haciendo lo mismo (o con "Cargar a venta" hacia Cobro) al mismo
    // tiempo, nunca se confía solo en el estado ya cargado en Angular.
    const reclamado = await this.pedidoTiendaService.reclamar(pedido.id);
    if (!reclamado) {
      this.toast.advertencia('Este pedido ya está siendo atendido en otra caja (o ya cambió de estado).');
      await this.cargarPedidos();
      return;
    }

    this.confirmarForm.reset({ metodoPago: 'Efectivo' });
    this.modalConfirmarAbierto.set(true);
  }

  /** Suelta el reclamo tomado en abrirConfirmar() — ver
   *  PedidoTiendaService.liberar() (best-effort, no bloquea el cierre del
   *  modal). Al confirmar de verdad (confirmarConfirmar()) no hace falta
   *  liberar: el pedido pasa a 'Confirmado' y ya no se puede volver a
   *  reclamar sin importar estos campos. */
  cerrarConfirmar(): void {
    const pedido = this.pedidoDetalle();
    if (pedido) this.pedidoTiendaService.liberar(pedido.id).catch(() => {});
    this.modalConfirmarAbierto.set(false);
  }

  async confirmarConfirmar(): Promise<void> {
    const pedido = this.pedidoDetalle();
    const usuario = this.auth.usuarioActual();
    if (!pedido || !usuario) return;

    if (this.bodegaConversionId() === null) {
      this.toast.advertencia('Elige la bodega de la que se descuenta existencia.');
      return;
    }
    if (this.confirmarForm.invalid) {
      this.confirmarForm.markAllAsTouched();
      return;
    }

    this.confirmando.set(true);
    try {
      const turno = await this.turnoCajaService.turnoAbiertoOCrear(usuario.id);
      if (!turno) {
        this.toast.advertencia('Ya no tienes un turno de caja abierto.');
        return;
      }
      const generico = await this.clienteService.obtenerOCrearGenerico();

      const valor = this.confirmarForm.getRawValue();
      const venta = await this.pedidoTiendaService.confirmarComoVenta(pedido, {
        turnoCajaId: turno.id,
        clienteId: generico.id,
        vendedorUsuarioId: usuario.id,
        bodegaId: this.bodegaConversionId(),
        pago: { metodoPago: valor.metodoPago, monto: pedido.total, montoRecibido: null, cambio: null },
      });

      this.toast.exito(`Pedido confirmado como venta ${venta.folio}.`);
      this.modalConfirmarAbierto.set(false);
      this.pedidoDetalle.set({ ...pedido, estado: 'Confirmado', ventaId: venta.id });
      await this.cargarPedidos();
    } finally {
      this.confirmando.set(false);
    }
  }
}

import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { AuthService } from '../../../core/services/auth.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { Bodega } from '../../inventario/bodegas/bodega.model';
import { ClienteService } from '../clientes/cliente.service';
import { MetodoPago, METODOS_PAGO } from '../venta/venta.model';
import { TurnoCajaService } from '../turno/turno-caja.service';
import { formatMoneda } from '../ventas.util';
import { PedidoTienda } from './pedido-tienda.model';
import { PedidoTiendaService } from './pedido-tienda.service';

/**
 * "Pedidos web" — bandeja de los pedidos que llegan de la tienda pública
 * (/tienda/:clave, ver catalogo-tienda.component.ts): esos NO se guardan
 * como Venta de entrada (el canal real sigue siendo WhatsApp, ver el
 * comentario grande en 27_tienda_publica.sql), solo quedan aquí como
 * registro ligero (ver migración 30) para que el staff no tenga que volver
 * a teclear el pedido a mano — "Confirmar" arma la Venta real con
 * PedidoTiendaService (mismo VentaService que usa Cobro) y "Descartar" lo
 * cierra sin más. Mismo criterio de pantalla que Cotizaciones.
 */
@Component({
  selector: 'app-pedidos-tienda',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, DatePipe],
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
  protected readonly toast = inject(ToastService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);
  protected readonly formatMoneda = formatMoneda;
  protected readonly metodosPago = METODOS_PAGO;

  protected readonly cargando = signal(true);
  protected readonly pedidos = signal<PedidoTienda[]>([]);
  protected readonly bodegas = signal<Bodega[]>([]);

  protected readonly columnas: ColumnaTabla<PedidoTienda>[] = [
    { campo: 'fechaCreacion', etiqueta: 'Fecha', formatear: (p) => new Date(p.fechaCreacion).toLocaleString('es-MX') },
    { campo: 'nombreCliente', etiqueta: 'Cliente' },
    { campo: 'telefonoCliente', etiqueta: 'Teléfono' },
    { campo: 'total', etiqueta: 'Total', formatear: (p) => formatMoneda(p.total) },
    {
      campo: 'estado',
      etiqueta: 'Estado',
      claseValor: (p) =>
        p.estado === 'Pendiente' ? 'grid-badge-warning' : p.estado === 'Confirmado' ? 'grid-badge-success' : 'grid-badge-muted',
    },
  ];

  async ngOnInit(): Promise<void> {
    document.documentElement.setAttribute('data-wide', 'grid'); // ancho completo
    await this.cargar();
  }

  private async cargar(): Promise<void> {
    this.cargando.set(true);
    const [pedidos, bodegas] = await Promise.all([
      firstValueFrom(this.data.list<PedidoTienda>('PedidoTienda')),
      firstValueFrom(this.data.list<Bodega>('Bodega')),
    ]);
    this.pedidos.set(pedidos.sort((a, b) => b.fechaCreacion.localeCompare(a.fechaCreacion)));
    this.bodegas.set(bodegas.filter((b) => b.activo !== false));
    this.bodegaConversionId.set(this.bodegas()[0]?.id ?? null);
    this.cargando.set(false);
  }

  // ── Detalle / confirmación / descarte ──────────────────────────────
  protected readonly pedidoDetalle = signal<PedidoTienda | null>(null);
  protected readonly pedidoADescartar = signal<PedidoTienda | null>(null);

  protected readonly modalConfirmarAbierto = signal(false);
  protected readonly bodegaConversionId = signal<number | null>(null);
  protected readonly confirmando = signal(false);

  protected readonly confirmarForm = this.fb.nonNullable.group({
    metodoPago: ['Efectivo' as MetodoPago, Validators.required],
  });

  verDetalle(pedido: PedidoTienda): void {
    this.pedidoDetalle.set(pedido);
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
    await this.cargar();
  }

  async abrirConfirmar(): Promise<void> {
    const usuario = this.auth.usuarioActual();
    if (!usuario) return;

    const turno = await this.turnoCajaService.turnoAbierto(usuario.id);
    if (!turno) {
      this.toast.advertencia('Abre un turno de caja antes de confirmar un pedido como venta.');
      return;
    }
    this.confirmarForm.reset({ metodoPago: 'Efectivo' });
    this.modalConfirmarAbierto.set(true);
  }

  cerrarConfirmar(): void {
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
      const turno = await this.turnoCajaService.turnoAbierto(usuario.id);
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
      await this.cargar();
    } finally {
      this.confirmando.set(false);
    }
  }
}

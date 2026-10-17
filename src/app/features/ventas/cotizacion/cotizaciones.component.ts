import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { AuthService } from '../../../core/services/auth.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { SelectBuscableComponent, OpcionBuscable } from '../../../shared/components/select-buscable/select-buscable.component';
import { ToastService } from '../../../shared/services/toast.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { Producto } from '../../inventario/productos/producto.model';
import { Bodega } from '../../inventario/bodegas/bodega.model';
import { Cliente } from '../clientes/cliente.model';
import { ClienteService } from '../clientes/cliente.service';
import { MetodoPago, METODOS_PAGO, Venta } from '../venta/venta.model';
import { TurnoCajaService } from '../turno/turno-caja.service';
import { formatMoneda, redondear } from '../ventas.util';
import { Cotizacion, CotizacionItem } from './cotizacion.model';
import { CotizacionService, LineaCotizacionEntrada } from './cotizacion.service';

interface LineaUI {
  productoId: number | null;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  descuentoPct: number;
}

/**
 * Cotizaciones — una propuesta de precio para el cliente que NO toca
 * inventario ni caja (ver cotizacion.model.ts); cuando el cliente acepta,
 * "Convertir a venta" la vuelve una Venta real con el mismo VentaService
 * que usa Cobro. Mismo criterio de "catálogo con modal de alta + detalle"
 * que el resto de las pantallas de Ventas, pero el alta aquí arma varias
 * líneas (como un mini-Cobro) en vez de un solo formulario plano.
 */
@Component({
  selector: 'app-cotizaciones',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, SelectBuscableComponent],
  templateUrl: './cotizaciones.component.html',
  styleUrl: './cotizaciones.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CotizacionesComponent implements OnInit, OnDestroy {
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  private readonly data = inject(DataClientService);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly clienteService = inject(ClienteService);
  private readonly turnoCajaService = inject(TurnoCajaService);
  private readonly cotizacionService = inject(CotizacionService);
  protected readonly toast = inject(ToastService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);
  protected readonly formatMoneda = formatMoneda;
  protected readonly metodosPago = METODOS_PAGO;

  protected readonly cargando = signal(true);
  protected readonly cotizaciones = signal<Cotizacion[]>([]);
  protected readonly clientes = signal<Cliente[]>([]);
  protected readonly productos = signal<Producto[]>([]);
  protected readonly bodegas = signal<Bodega[]>([]);

  protected readonly opcionesClientes = computed<OpcionBuscable[]>(() =>
    this.clientes()
      .filter((c) => c.activo !== false)
      .map((c) => ({ valor: c.id, etiqueta: c.esGenerico ? c.nombre : `${c.nombre} — ${c.rfc}` })),
  );
  protected readonly opcionesProductos = computed<OpcionBuscable[]>(() => [
    { valor: 0, etiqueta: '— Texto libre (sin producto del catálogo) —' },
    ...this.productos()
      .filter((p) => p.activo !== false)
      .map((p) => ({ valor: p.id, etiqueta: p.nombre })),
  ]);

  protected nombreCliente(clienteId: number): string {
    return this.clientes().find((c) => c.id === clienteId)?.nombre ?? '—';
  }

  protected readonly columnas: ColumnaTabla<Cotizacion>[] = [
    { campo: 'folio', etiqueta: 'Folio' },
    { campo: 'fecha', etiqueta: 'Fecha', formatear: (c) => new Date(c.fecha).toLocaleDateString('es-MX') },
    { campo: 'clienteId', etiqueta: 'Cliente', formatear: (c) => this.nombreCliente(c.clienteId) },
    { campo: 'total', etiqueta: 'Total', formatear: (c) => formatMoneda(c.total) },
    {
      campo: 'estado',
      etiqueta: 'Estado',
      claseValor: (c) =>
        c.estado === 'Vigente' ? 'grid-badge-success' : c.estado === 'Convertida' ? 'grid-badge-neutral' : 'grid-badge-muted',
    },
  ];

  // ── Alta ────────────────────────────────────────────────────────────
  protected readonly modalNuevaAbierto = signal(false);
  protected readonly lineasNuevas = signal<LineaUI[]>([]);
  protected readonly clienteNuevaId = signal<number | null>(null);
  protected readonly guardandoNueva = signal(false);

  protected readonly cotizacionForm = this.fb.nonNullable.group({
    fechaVigencia: [''],
    notas: [''],
  });

  protected readonly lineaForm = this.fb.nonNullable.group({
    productoId: [0],
    descripcion: ['', Validators.required],
    cantidad: [1, [Validators.required, Validators.min(1)]],
    precioUnitario: [0, [Validators.required, Validators.min(0)]],
    descuentoPct: [0],
  });

  protected readonly subtotalNueva = computed(() => redondear(this.lineasNuevas().reduce((acc, l) => acc + l.cantidad * l.precioUnitario, 0)));
  protected readonly descuentoNueva = computed(() =>
    redondear(this.lineasNuevas().reduce((acc, l) => acc + l.cantidad * l.precioUnitario * (l.descuentoPct / 100), 0)),
  );
  protected readonly totalNueva = computed(() => redondear(this.subtotalNueva() - this.descuentoNueva()));

  elegirProductoLinea(id: number | string | null): void {
    const productoId = id ? Number(id) : 0;
    this.lineaForm.controls.productoId.setValue(productoId);
    if (productoId === 0) {
      this.lineaForm.patchValue({ descripcion: '', precioUnitario: 0 });
      return;
    }
    const producto = this.productos().find((p) => p.id === productoId);
    if (producto) this.lineaForm.patchValue({ descripcion: producto.nombre, precioUnitario: producto.precioUnitario });
  }

  agregarLinea(): void {
    if (this.lineaForm.invalid) {
      this.lineaForm.markAllAsTouched();
      return;
    }
    const valor = this.lineaForm.getRawValue();
    this.lineasNuevas.update((lista) => [
      ...lista,
      {
        productoId: valor.productoId || null,
        descripcion: valor.descripcion,
        cantidad: valor.cantidad,
        precioUnitario: valor.precioUnitario,
        descuentoPct: valor.descuentoPct,
      },
    ]);
    this.lineaForm.reset({ productoId: 0, descripcion: '', cantidad: 1, precioUnitario: 0, descuentoPct: 0 });
  }

  quitarLineaNueva(index: number): void {
    this.lineasNuevas.update((lista) => lista.filter((_, idx) => idx !== index));
  }

  async abrirNueva(): Promise<void> {
    this.cotizacionForm.reset({ fechaVigencia: '', notas: '' });
    this.lineaForm.reset({ productoId: 0, descripcion: '', cantidad: 1, precioUnitario: 0, descuentoPct: 0 });
    this.lineasNuevas.set([]);
    const generico = await this.clienteService.obtenerOCrearGenerico();
    this.clienteNuevaId.set(generico.id);
    this.modalNuevaAbierto.set(true);
  }

  cerrarNueva(): void {
    this.modalNuevaAbierto.set(false);
  }

  async guardarNueva(): Promise<void> {
    const usuario = this.auth.usuarioActual();
    const clienteId = this.clienteNuevaId();
    if (!usuario || clienteId === null) return;

    if (this.lineasNuevas().length === 0) {
      this.toast.advertencia('Agrega al menos una línea a la cotización.');
      return;
    }

    this.guardandoNueva.set(true);
    try {
      const valor = this.cotizacionForm.getRawValue();
      const lineas: LineaCotizacionEntrada[] = this.lineasNuevas().map((l) => ({
        productoId: l.productoId,
        descripcion: l.descripcion,
        cantidad: l.cantidad,
        precioUnitario: l.precioUnitario,
        descuentoPct: l.descuentoPct,
      }));

      const cotizacion = await this.cotizacionService.generar({
        clienteId,
        vendedorUsuarioId: usuario.id,
        fechaVigencia: valor.fechaVigencia || null,
        notas: valor.notas || null,
        lineas,
      });

      this.toast.exito(`Cotización ${cotizacion.folio} generada.`);
      this.modalNuevaAbierto.set(false);
      await this.cargar();
    } finally {
      this.guardandoNueva.set(false);
    }
  }

  // ── Detalle / conversión / cancelación ─────────────────────────────────
  protected readonly cotizacionDetalle = signal<Cotizacion | null>(null);
  protected readonly itemsDetalle = signal<CotizacionItem[]>([]);
  protected readonly ventaConvertidaDetalle = signal<Venta | null>(null);
  protected readonly cargandoDetalle = signal(false);
  protected readonly cotizacionACancelar = signal<Cotizacion | null>(null);

  protected readonly modalConvertirAbierto = signal(false);
  protected readonly bodegaConversionId = signal<number | null>(null);
  protected readonly convirtiendo = signal(false);

  protected readonly conversionForm = this.fb.nonNullable.group({
    metodoPago: ['Efectivo' as MetodoPago, Validators.required],
  });

  protected readonly requiereBodegaConversion = computed(() => this.itemsDetalle().some((i) => i.productoId !== null));

  async ngOnInit(): Promise<void> {
    document.documentElement.setAttribute('data-wide', 'grid'); // ancho completo
    await this.cargar();
  }

  private async cargar(): Promise<void> {
    this.cargando.set(true);
    const [cotizaciones, clientes, productos, bodegas] = await Promise.all([
      firstValueFrom(this.data.list<Cotizacion>('Cotizacion')),
      firstValueFrom(this.data.list<Cliente>('Cliente')),
      firstValueFrom(this.data.list<Producto>('Producto')),
      firstValueFrom(this.data.list<Bodega>('Bodega')),
    ]);
    this.cotizaciones.set(cotizaciones.sort((a, b) => b.fecha.localeCompare(a.fecha)));
    this.clientes.set(clientes);
    this.productos.set(productos);
    this.bodegas.set(bodegas.filter((b) => b.activo !== false));
    this.bodegaConversionId.set(this.bodegas()[0]?.id ?? null);
    this.cargando.set(false);
  }

  async verDetalle(cotizacion: Cotizacion): Promise<void> {
    this.cotizacionDetalle.set(cotizacion);
    this.cargandoDetalle.set(true);
    const items = await firstValueFrom(this.data.list<CotizacionItem>('CotizacionItem', { cotizacionId: cotizacion.id }));
    this.itemsDetalle.set(items);

    if (cotizacion.estado === 'Convertida' && cotizacion.ventaConvertidaId !== null) {
      const ventas = await firstValueFrom(this.data.list<Venta>('Venta', { id: cotizacion.ventaConvertidaId }));
      this.ventaConvertidaDetalle.set(ventas[0] ?? null);
    } else {
      this.ventaConvertidaDetalle.set(null);
    }
    this.cargandoDetalle.set(false);
  }

  cerrarDetalle(): void {
    this.cotizacionDetalle.set(null);
    this.itemsDetalle.set([]);
    this.ventaConvertidaDetalle.set(null);
  }

  pedirCancelar(cotizacion: Cotizacion): void {
    this.cotizacionACancelar.set(cotizacion);
  }

  async confirmarCancelar(): Promise<void> {
    const cotizacion = this.cotizacionACancelar();
    if (!cotizacion) return;

    const actualizada = await this.cotizacionService.cancelar(cotizacion);
    this.toast.exito(`Cotización ${cotizacion.folio} cancelada.`);
    this.cotizacionACancelar.set(null);
    this.cotizacionDetalle.set(actualizada);
    await this.cargar();
  }

  async abrirConvertir(): Promise<void> {
    const usuario = this.auth.usuarioActual();
    if (!usuario) return;

    const turno = await this.turnoCajaService.turnoAbierto(usuario.id);
    if (!turno) {
      this.toast.advertencia('Abre un turno de caja antes de convertir una cotización en venta.');
      return;
    }
    this.conversionForm.reset({ metodoPago: 'Efectivo' });
    this.modalConvertirAbierto.set(true);
  }

  cerrarConvertir(): void {
    this.modalConvertirAbierto.set(false);
  }

  async confirmarConvertir(): Promise<void> {
    const cotizacion = this.cotizacionDetalle();
    const usuario = this.auth.usuarioActual();
    if (!cotizacion || !usuario) return;

    if (this.requiereBodegaConversion() && this.bodegaConversionId() === null) {
      this.toast.advertencia('Elige la bodega de la que se descuenta existencia.');
      return;
    }
    if (this.conversionForm.invalid) {
      this.conversionForm.markAllAsTouched();
      return;
    }

    this.convirtiendo.set(true);
    try {
      const turno = await this.turnoCajaService.turnoAbierto(usuario.id);
      if (!turno) {
        this.toast.advertencia('Ya no tienes un turno de caja abierto.');
        return;
      }

      const valor = this.conversionForm.getRawValue();
      const venta = await this.cotizacionService.convertirAVenta(cotizacion, this.itemsDetalle(), {
        turnoCajaId: turno.id,
        bodegaId: this.bodegaConversionId(),
        pago: { metodoPago: valor.metodoPago, monto: cotizacion.total, montoRecibido: null, cambio: null },
      });

      this.toast.exito(`Cotización convertida en venta ${venta.folio}.`);
      this.modalConvertirAbierto.set(false);
      await this.verDetalle({ ...cotizacion, estado: 'Convertida', ventaConvertidaId: venta.id });
      await this.cargar();
    } finally {
      this.convirtiendo.set(false);
    }
  }
}

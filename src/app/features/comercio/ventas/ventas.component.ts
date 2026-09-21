import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { jsPDF } from 'jspdf';
import { DataClientService } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { EstadoVenta, Venta, VentaItem } from './venta.model';
import { ClienteOpcion, Cotizacion, CotizacionItem } from '../cotizaciones/cotizacion.model';

interface ProductoOpcion {
  id: number;
  nombre: string;
  precioUnitario: number;
}

/**
 * Ventana de Ventas: mismo patrón encabezado (modal) + partidas (panel
 * inline) que Cotizaciones. Además soporta el flujo "Convertir a venta":
 * si se llega aquí navegando desde Cotizaciones con estado de router
 * (cotizacionOrigen + items), se abre el modal de nueva venta prellenado
 * y, tras guardar el encabezado, se copian las partidas automáticamente.
 */
@Component({
  selector: 'app-ventas',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent],
  templateUrl: './ventas.component.html',
  styleUrl: './ventas.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VentasComponent implements OnInit {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);

  protected readonly ventas = signal<Venta[]>([]);
  protected readonly clientes = signal<ClienteOpcion[]>([]);
  protected readonly productos = signal<ProductoOpcion[]>([]);
  protected readonly cargando = signal(false);

  protected readonly modalAbierto = signal(false);
  protected readonly ventaEnEdicion = signal<Venta | null>(null);
  protected readonly ventaAEliminar = signal<Venta | null>(null);

  protected readonly ventaActiva = signal<Venta | null>(null);
  protected readonly items = signal<VentaItem[]>([]);

  /** Partidas de la cotización de origen, pendientes de copiar tras guardar el encabezado. */
  private itemsACopiar: CotizacionItem[] = [];
  private cotizacionOrigenId: number | null = null;

  protected readonly columnas: ColumnaTabla<Venta>[] = [
    { campo: 'folio', etiqueta: 'Folio' },
    { campo: 'clienteId', etiqueta: 'Cliente', formatear: (v) => this.nombreCliente(v.clienteId) },
    { campo: 'fecha', etiqueta: 'Fecha', formatear: (v) => (v.fecha ?? '').slice(0, 10) },
    { campo: 'estado', etiqueta: 'Estado' },
    { campo: 'total', etiqueta: 'Total', formatear: (v) => `$${v.total.toFixed(2)}` },
  ];

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    folio: ['', Validators.required],
    clienteId: [0, Validators.required],
    fecha: ['', Validators.required],
    estado: ['Pendiente' as EstadoVenta, Validators.required],
    ivaPct: [16, Validators.required],
    notas: [''],
  });

  protected readonly formItem = this.fb.nonNullable.group({
    productoId: [0, Validators.required],
    cantidad: [1, Validators.required],
    precioUnitario: [0, Validators.required],
    descuentoPct: [0],
  });

  protected readonly subtotalItems = computed(() =>
    this.items().reduce((acc, i) => acc + i.cantidad * i.precioUnitario * (1 - i.descuentoPct / 100), 0),
  );
  protected readonly ivaItems = computed(
    () => this.subtotalItems() * ((this.ventaActiva()?.ivaPct ?? 0) / 100),
  );
  protected readonly totalItems = computed(() => this.subtotalItems() + this.ivaItems());

  ngOnInit(): void {
    this.cargarClientes();
    this.cargarProductos();
    this.cargar();

    const estadoNav = this.router.getCurrentNavigation()?.extras.state as
      | { cotizacionOrigen?: Cotizacion; items?: CotizacionItem[] }
      | undefined;
    const estadoHistorial = history.state as { cotizacionOrigen?: Cotizacion; items?: CotizacionItem[] } | undefined;
    const origen = estadoNav?.cotizacionOrigen ?? estadoHistorial?.cotizacionOrigen;
    const itemsOrigen = estadoNav?.items ?? estadoHistorial?.items ?? [];

    if (origen) {
      this.prepararDesdeConversion(origen, itemsOrigen);
    }
  }

  nombreCliente(id: number): string {
    return this.clientes().find((c) => c.id === id)?.nombre ?? '—';
  }

  nombreProducto(id: number): string {
    return this.productos().find((p) => p.id === id)?.nombre ?? '—';
  }

  private cargarClientes(): void {
    this.data.list<ClienteOpcion>('Cliente').subscribe({
      next: (clientes) => this.clientes.set(clientes),
    });
  }

  private cargarProductos(): void {
    this.data.list<ProductoOpcion>('Producto').subscribe({
      next: (productos) => this.productos.set(productos),
    });
  }

  cargar(): void {
    this.cargando.set(true);
    this.data.list<Venta>('Venta').subscribe({
      next: (ventas) => {
        this.ventas.set(ventas);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  private folioSugerido(): string {
    const numeros = this.ventas().map((v) => Number(v.folio.replace(/\D/g, '')) || 0);
    const siguiente = (numeros.length ? Math.max(...numeros) : 0) + 1;
    return `VTA-${String(siguiente).padStart(4, '0')}`;
  }

  nueva(): void {
    this.ventaEnEdicion.set(null);
    this.cotizacionOrigenId = null;
    this.itemsACopiar = [];
    this.form.reset({
      id: 0,
      folio: this.folioSugerido(),
      clienteId: 0,
      fecha: new Date().toISOString().slice(0, 10),
      estado: 'Pendiente',
      ivaPct: 16,
      notas: '',
    });
    this.modalAbierto.set(true);
  }

  private prepararDesdeConversion(cotizacion: Cotizacion, items: CotizacionItem[]): void {
    this.ventaEnEdicion.set(null);
    this.cotizacionOrigenId = cotizacion.id;
    this.itemsACopiar = items;
    this.form.reset({
      id: 0,
      folio: this.folioSugerido(),
      clienteId: cotizacion.clienteId,
      fecha: new Date().toISOString().slice(0, 10),
      estado: 'Pendiente',
      ivaPct: cotizacion.ivaPct,
      notas: cotizacion.notas ?? '',
    });
    this.toast.info(`Venta prellenada desde la cotización ${cotizacion.folio}. Revisa y guarda para copiar las partidas.`);
    this.modalAbierto.set(true);
  }

  editar(venta: Venta): void {
    this.ventaEnEdicion.set(venta);
    this.cotizacionOrigenId = null;
    this.itemsACopiar = [];
    this.form.reset({
      id: venta.id,
      folio: venta.folio,
      clienteId: venta.clienteId,
      fecha: (venta.fecha ?? '').slice(0, 10),
      estado: venta.estado,
      ivaPct: venta.ivaPct,
      notas: venta.notas ?? '',
    });
    this.modalAbierto.set(true);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const valor = this.form.getRawValue();
    const existente = this.ventaEnEdicion();
    const payload = {
      id: valor.id,
      folio: valor.folio,
      clienteId: valor.clienteId,
      fecha: valor.fecha,
      estado: valor.estado,
      ivaPct: valor.ivaPct,
      notas: valor.notas || null,
      subtotal: existente?.subtotal ?? 0,
      iva: existente?.iva ?? 0,
      total: existente?.total ?? 0,
      cotizacionOrigenId: this.cotizacionOrigenId ?? existente?.cotizacionOrigenId ?? null,
      vendedorUsuarioId: existente?.vendedorUsuarioId ?? null,
      activo: true,
    };

    const esEdicion = existente !== null;
    const itemsPendientes = [...this.itemsACopiar];

    const peticion = esEdicion
      ? this.data.modificacion<Venta>('Venta', payload)
      : this.data.alta<Venta>('Venta', payload);

    peticion.subscribe({
      next: (venta) => {
        this.toast.exito(esEdicion ? 'Venta actualizada.' : 'Venta creada.');
        this.modalAbierto.set(false);
        this.itemsACopiar = [];
        this.cotizacionOrigenId = null;

        if (!esEdicion && itemsPendientes.length) {
          this.copiarItems(venta.id, itemsPendientes);
        } else {
          this.cargar();
        }
      },
    });
  }

  private copiarItems(ventaId: number, items: CotizacionItem[]): void {
    let pendientes = items.length;
    items.forEach((item) => {
      this.data
        .alta<VentaItem>('VentaItem', {
          ventaId,
          productoId: item.productoId,
          cantidad: item.cantidad,
          precioUnitario: item.precioUnitario,
          descuentoPct: item.descuentoPct,
        })
        .subscribe(() => {
          pendientes -= 1;
          if (pendientes === 0) {
            this.toast.exito('Partidas copiadas desde la cotización de origen.');
            this.cargar();
          }
        });
    });
  }

  pedirEliminar(venta: Venta): void {
    this.ventaAEliminar.set(venta);
  }

  confirmarEliminar(): void {
    const venta = this.ventaAEliminar();
    if (!venta) return;

    this.data.baja('Venta', venta.id).subscribe({
      next: () => {
        this.toast.exito('Venta eliminada.');
        this.ventaAEliminar.set(null);
        this.cargar();
      },
    });
  }

  abrirPartidas(venta: Venta): void {
    this.ventaActiva.set(venta);
    this.formItem.reset({ productoId: 0, cantidad: 1, precioUnitario: 0, descuentoPct: 0 });
    this.cargarItems(venta.id);
  }

  cerrarPartidas(): void {
    this.ventaActiva.set(null);
    this.items.set([]);
  }

  private cargarItems(ventaId: number): void {
    this.data.list<VentaItem>('VentaItem', { ventaId }).subscribe({ next: (items) => this.items.set(items) });
  }

  seleccionarProducto(): void {
    const producto = this.productos().find((p) => p.id === this.formItem.controls.productoId.value);
    if (producto) {
      this.formItem.controls.precioUnitario.setValue(producto.precioUnitario);
    }
  }

  agregarItem(): void {
    const activa = this.ventaActiva();
    if (!activa || this.formItem.invalid) {
      this.formItem.markAllAsTouched();
      return;
    }

    const valor = this.formItem.getRawValue();
    this.data.alta<VentaItem>('VentaItem', { ...valor, ventaId: activa.id }).subscribe({
      next: () => {
        this.formItem.reset({ productoId: 0, cantidad: 1, precioUnitario: 0, descuentoPct: 0 });
        this.cargarItems(activa.id);
        this.recalcularTotales();
      },
    });
  }

  eliminarItem(item: VentaItem): void {
    const activa = this.ventaActiva();
    if (!activa) return;

    this.data.baja('VentaItem', item.id).subscribe({
      next: () => {
        this.cargarItems(activa.id);
        this.recalcularTotales();
      },
    });
  }

  private recalcularTotales(): void {
    const activa = this.ventaActiva();
    if (!activa) return;

    setTimeout(() => {
      const payload = {
        ...activa,
        subtotal: this.subtotalItems(),
        iva: this.ivaItems(),
        total: this.totalItems(),
      };
      this.data.modificacion<Venta>('Venta', payload).subscribe({
        next: (actualizada) => {
          this.ventaActiva.set(actualizada);
          this.cargar();
        },
      });
    });
  }

  /** Genera un PDF simple de la venta activa con los datos ya cargados en memoria. */
  exportarPdf(): void {
    const activa = this.ventaActiva();
    if (!activa) return;

    const doc = new jsPDF();
    let y = 20;

    doc.setFontSize(18);
    doc.text(`Venta ${activa.folio}`, 14, y);
    y += 9;

    doc.setFontSize(10);
    doc.setTextColor(100);
    const fecha = activa.fecha ? new Date(activa.fecha).toLocaleDateString('es-MX') : '—';
    doc.text(`Fecha: ${fecha} · Estado: ${activa.estado}`, 14, y);
    y += 10;

    doc.setTextColor(0);
    doc.setFontSize(11);
    doc.text(`Cliente: ${this.nombreCliente(activa.clienteId)}`, 14, y);
    y += 10;

    doc.setDrawColor(220);
    doc.line(14, y, 196, y);
    y += 8;

    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text('Producto', 14, y);
    doc.text('Cant.', 110, y);
    doc.text('P. Unit.', 130, y);
    doc.text('Desc.', 155, y);
    doc.text('Subtotal', 196, y, { align: 'right' });
    y += 6;

    doc.setTextColor(0);
    this.items().forEach((item) => {
      if (y > 270) {
        doc.addPage();
        y = 20;
      }
      const subtotalLinea = item.cantidad * item.precioUnitario * (1 - item.descuentoPct / 100);
      doc.text(this.nombreProducto(item.productoId).slice(0, 42), 14, y);
      doc.text(String(item.cantidad), 110, y);
      doc.text(`$${item.precioUnitario.toFixed(2)}`, 130, y);
      doc.text(item.descuentoPct ? `${item.descuentoPct}%` : '—', 155, y);
      doc.text(`$${subtotalLinea.toFixed(2)}`, 196, y, { align: 'right' });
      y += 6;
    });

    y += 6;
    doc.setDrawColor(220);
    doc.line(120, y, 196, y);
    y += 8;
    doc.text(`Subtotal: $${this.subtotalItems().toFixed(2)}`, 196, y, { align: 'right' });
    y += 6;
    doc.text(`IVA (${activa.ivaPct}%): $${this.ivaItems().toFixed(2)}`, 196, y, { align: 'right' });
    y += 6;
    doc.setFontSize(12);
    doc.text(`Total: $${this.totalItems().toFixed(2)}`, 196, y, { align: 'right' });

    if (activa.notas) {
      y += 14;
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.text('Notas:', 14, y);
      y += 6;
      doc.text(activa.notas, 14, y, { maxWidth: 180 });
    }

    doc.save(`${activa.folio}.pdf`);
    this.toast.exito('PDF generado.');
  }
}

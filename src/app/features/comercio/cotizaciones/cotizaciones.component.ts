import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { jsPDF } from 'jspdf';
import { DataClientService } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { ClienteOpcion, Cotizacion, CotizacionItem, EstadoCotizacion } from './cotizacion.model';

interface ProductoOpcion {
  id: number;
  nombre: string;
  precioUnitario: number;
}

/**
 * Ventana de Cotizaciones: encabezado (modal) + partidas (panel inline,
 * solo disponible una vez que la cotización ya tiene Id real —
 * CotizacionItem exige CotizacionId obligatorio, por eso las partidas no
 * se pueden capturar antes de guardar el encabezado, igual que el resto
 * de tablas hijas de un solo padre del sistema).
 */
@Component({
  selector: 'app-cotizaciones',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent],
  templateUrl: './cotizaciones.component.html',
  styleUrl: './cotizaciones.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CotizacionesComponent implements OnInit {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);

  protected readonly cotizaciones = signal<Cotizacion[]>([]);
  protected readonly clientes = signal<ClienteOpcion[]>([]);
  protected readonly productos = signal<ProductoOpcion[]>([]);
  protected readonly cargando = signal(false);

  protected readonly modalAbierto = signal(false);
  protected readonly cotizacionEnEdicion = signal<Cotizacion | null>(null);
  protected readonly cotizacionAEliminar = signal<Cotizacion | null>(null);

  protected readonly cotizacionActiva = signal<Cotizacion | null>(null);
  protected readonly items = signal<CotizacionItem[]>([]);

  protected readonly columnas: ColumnaTabla<Cotizacion>[] = [
    { campo: 'folio', etiqueta: 'Folio' },
    { campo: 'clienteId', etiqueta: 'Cliente', formatear: (c) => this.nombreCliente(c.clienteId) },
    { campo: 'fecha', etiqueta: 'Fecha', formatear: (c) => (c.fecha ?? '').slice(0, 10) },
    { campo: 'estado', etiqueta: 'Estado' },
    { campo: 'total', etiqueta: 'Total', formatear: (c) => `$${c.total.toFixed(2)}` },
  ];

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    folio: ['', Validators.required],
    clienteId: [0, Validators.required],
    fecha: ['', Validators.required],
    validaHasta: [''],
    estado: ['Borrador' as EstadoCotizacion, Validators.required],
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
    () => this.subtotalItems() * ((this.cotizacionActiva()?.ivaPct ?? 0) / 100),
  );
  protected readonly totalItems = computed(() => this.subtotalItems() + this.ivaItems());

  ngOnInit(): void {
    this.cargarClientes();
    this.cargarProductos();
    this.cargar();
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
    this.data.list<Cotizacion>('Cotizacion').subscribe({
      next: (cotizaciones) => {
        this.cotizaciones.set(cotizaciones);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  private folioSugerido(): string {
    const numeros = this.cotizaciones().map((c) => Number(c.folio.replace(/\D/g, '')) || 0);
    const siguiente = (numeros.length ? Math.max(...numeros) : 0) + 1;
    return `COT-${String(siguiente).padStart(4, '0')}`;
  }

  nueva(): void {
    this.cotizacionEnEdicion.set(null);
    this.form.reset({
      id: 0,
      folio: this.folioSugerido(),
      clienteId: 0,
      fecha: new Date().toISOString().slice(0, 10),
      validaHasta: '',
      estado: 'Borrador',
      ivaPct: 16,
      notas: '',
    });
    this.modalAbierto.set(true);
  }

  editar(cotizacion: Cotizacion): void {
    this.cotizacionEnEdicion.set(cotizacion);
    this.form.reset({
      id: cotizacion.id,
      folio: cotizacion.folio,
      clienteId: cotizacion.clienteId,
      fecha: (cotizacion.fecha ?? '').slice(0, 10),
      validaHasta: (cotizacion.validaHasta ?? '').slice(0, 10),
      estado: cotizacion.estado,
      ivaPct: cotizacion.ivaPct,
      notas: cotizacion.notas ?? '',
    });
    this.modalAbierto.set(true);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const valor = this.form.getRawValue();
    const existente = this.cotizacionEnEdicion();
    const payload = {
      id: valor.id,
      folio: valor.folio,
      clienteId: valor.clienteId,
      fecha: valor.fecha,
      validaHasta: valor.validaHasta || null,
      estado: valor.estado,
      ivaPct: valor.ivaPct,
      notas: valor.notas || null,
      subtotal: existente?.subtotal ?? 0,
      iva: existente?.iva ?? 0,
      total: existente?.total ?? 0,
      vendedorUsuarioId: existente?.vendedorUsuarioId ?? null,
      activo: true,
    };

    const esEdicion = existente !== null;
    const peticion = esEdicion
      ? this.data.modificacion<Cotizacion>('Cotizacion', payload)
      : this.data.alta<Cotizacion>('Cotizacion', payload);

    peticion.subscribe({
      next: () => {
        this.toast.exito(
          esEdicion
            ? 'Cotización actualizada.'
            : 'Cotización creada. Ábrela de nuevo con "Partidas" para agregar productos.',
        );
        this.modalAbierto.set(false);
        this.cargar();
      },
    });
  }

  pedirEliminar(cotizacion: Cotizacion): void {
    this.cotizacionAEliminar.set(cotizacion);
  }

  confirmarEliminar(): void {
    const cotizacion = this.cotizacionAEliminar();
    if (!cotizacion) return;

    this.data.baja('Cotizacion', cotizacion.id).subscribe({
      next: () => {
        this.toast.exito('Cotización eliminada.');
        this.cotizacionAEliminar.set(null);
        this.cargar();
      },
    });
  }

  abrirPartidas(cotizacion: Cotizacion): void {
    this.cotizacionActiva.set(cotizacion);
    this.formItem.reset({ productoId: 0, cantidad: 1, precioUnitario: 0, descuentoPct: 0 });
    this.cargarItems(cotizacion.id);
  }

  cerrarPartidas(): void {
    this.cotizacionActiva.set(null);
    this.items.set([]);
  }

  private cargarItems(cotizacionId: number): void {
    this.data.list<CotizacionItem>('CotizacionItem', { cotizacionId }).subscribe({
      next: (items) => this.items.set(items),
    });
  }

  seleccionarProducto(): void {
    const producto = this.productos().find((p) => p.id === this.formItem.controls.productoId.value);
    if (producto) {
      this.formItem.controls.precioUnitario.setValue(producto.precioUnitario);
    }
  }

  agregarItem(): void {
    const activa = this.cotizacionActiva();
    if (!activa || this.formItem.invalid) {
      this.formItem.markAllAsTouched();
      return;
    }

    const valor = this.formItem.getRawValue();
    this.data.alta<CotizacionItem>('CotizacionItem', { ...valor, cotizacionId: activa.id }).subscribe({
      next: () => {
        this.formItem.reset({ productoId: 0, cantidad: 1, precioUnitario: 0, descuentoPct: 0 });
        this.cargarItems(activa.id);
        this.recalcularTotales();
      },
    });
  }

  eliminarItem(item: CotizacionItem): void {
    const activa = this.cotizacionActiva();
    if (!activa) return;

    this.data.baja('CotizacionItem', item.id).subscribe({
      next: () => {
        this.cargarItems(activa.id);
        this.recalcularTotales();
      },
    });
  }

  /** Recalcula subtotal/iva/total a partir de las partidas actuales. */
  private recalcularTotales(): void {
    const activa = this.cotizacionActiva();
    if (!activa) return;

    // Pequeño delay para que la lista de items ya se haya actualizado antes de sumar.
    setTimeout(() => {
      const payload = {
        ...activa,
        subtotal: this.subtotalItems(),
        iva: this.ivaItems(),
        total: this.totalItems(),
      };
      this.data.modificacion<Cotizacion>('Cotizacion', payload).subscribe({
        next: (actualizada) => {
          this.cotizacionActiva.set(actualizada);
          this.cargar();
        },
      });
    });
  }

  convertirAVenta(): void {
    const activa = this.cotizacionActiva();
    if (!activa) return;

    if (activa.estado !== 'Aceptada') {
      this.toast.error('Solo se pueden convertir a venta las cotizaciones en estado "Aceptada".');
      return;
    }

    this.router.navigate(['/comercio/ventas'], { state: { cotizacionOrigen: activa, items: this.items() } });
  }

  /** Genera un PDF simple de la cotización activa con los datos ya cargados en memoria. */
  exportarPdf(): void {
    const activa = this.cotizacionActiva();
    if (!activa) return;

    const doc = new jsPDF();
    let y = 20;

    doc.setFontSize(18);
    doc.text(`Cotización ${activa.folio}`, 14, y);
    y += 9;

    doc.setFontSize(10);
    doc.setTextColor(100);
    const fecha = activa.fecha ? new Date(activa.fecha).toLocaleDateString('es-MX') : '—';
    const validaHasta = activa.validaHasta
      ? ` · Válida hasta: ${new Date(activa.validaHasta).toLocaleDateString('es-MX')}`
      : '';
    doc.text(`Fecha: ${fecha}${validaHasta}`, 14, y);
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

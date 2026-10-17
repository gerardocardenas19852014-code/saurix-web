import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { AuthService } from '../../../core/services/auth.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { ToastService } from '../../../shared/services/toast.service';
import { Cliente } from '../clientes/cliente.model';
import { MetodoPagoCobrado, METODOS_PAGO_COBRADOS, Venta } from '../venta/venta.model';
import { TurnoCajaService } from '../turno/turno-caja.service';
import { formatMoneda } from '../ventas.util';
import { AbonoCuentaPorCobrar, CuentaPorCobrar } from './cuenta-por-cobrar.model';
import { CuentaPorCobrarService } from './cuenta-por-cobrar.service';

/**
 * Estado de cuenta de clientes a crédito — todas las CuentaPorCobrar que
 * generó Cobro al elegir "Crédito" como método de pago (ver
 * VentaService.registrar()), con el botón para registrar un abono. Mismo
 * criterio que Historial/Cotizaciones: grid de solo lectura + un detalle/
 * acción por fila, nunca editar/eliminar directo desde el grid.
 */
@Component({
  selector: 'app-cuentas-por-cobrar',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent],
  templateUrl: './cuentas-por-cobrar.component.html',
  styleUrl: './cuentas-por-cobrar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CuentasPorCobrarComponent implements OnInit, OnDestroy {
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  private readonly data = inject(DataClientService);
  private readonly auth = inject(AuthService);
  private readonly turnoCajaService = inject(TurnoCajaService);
  private readonly cuentaPorCobrarService = inject(CuentaPorCobrarService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);
  protected readonly formatMoneda = formatMoneda;
  protected readonly metodosPagoCobrados = METODOS_PAGO_COBRADOS;

  protected readonly cargando = signal(true);
  protected readonly cuentas = signal<CuentaPorCobrar[]>([]);
  protected readonly clientes = signal<Cliente[]>([]);
  protected readonly ventas = signal<Venta[]>([]);
  protected readonly soloPendientes = signal(true);
  protected readonly busqueda = signal('');

  protected readonly cuentasFiltradas = computed(() => {
    const texto = this.busqueda().trim().toLowerCase();
    return this.cuentas()
      .filter((c) => (this.soloPendientes() ? c.estado === 'Pendiente' : true))
      .filter((c) => !texto || this.nombreCliente(c.clienteId).toLowerCase().includes(texto) || this.folioVenta(c.ventaId).toLowerCase().includes(texto))
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
  });

  protected readonly columnas: ColumnaTabla<CuentaPorCobrar>[] = [
    { campo: 'clienteId', etiqueta: 'Cliente', formatear: (c) => this.nombreCliente(c.clienteId) },
    { campo: 'ventaId', etiqueta: 'Venta', formatear: (c) => this.folioVenta(c.ventaId) },
    { campo: 'fecha', etiqueta: 'Fecha', formatear: (c) => this.formatearFecha(c.fecha) },
    { campo: 'montoOriginal', etiqueta: 'Monto original', formatear: (c) => formatMoneda(c.montoOriginal) },
    { campo: 'saldoPendiente', etiqueta: 'Saldo pendiente', formatear: (c) => formatMoneda(c.saldoPendiente) },
    {
      campo: 'estado',
      etiqueta: 'Estado',
      claseValor: (c) => (c.estado === 'Pagada' ? 'grid-badge-success' : c.estado === 'Cancelada' ? 'grid-badge-muted' : 'grid-badge-warning'),
    },
  ];

  // ── Abono ──────────────────────────────────────────────────────────────
  protected readonly cuentaAbonar = signal<CuentaPorCobrar | null>(null);
  protected readonly abonosPrevios = signal<AbonoCuentaPorCobrar[]>([]);
  protected readonly guardandoAbono = signal(false);

  protected readonly abonoForm = this.fb.nonNullable.group({
    monto: [0, [Validators.required, Validators.min(0.01)]],
    metodoPago: ['Efectivo' as MetodoPagoCobrado, Validators.required],
    notas: [''],
  });

  async ngOnInit(): Promise<void> {
    document.documentElement.setAttribute('data-wide', 'grid');
    await this.cargar();
  }

  private async cargar(): Promise<void> {
    this.cargando.set(true);
    const [cuentas, clientes, ventas] = await Promise.all([
      firstValueFrom(this.data.list<CuentaPorCobrar>('CuentaPorCobrar')),
      firstValueFrom(this.data.list<Cliente>('Cliente')),
      firstValueFrom(this.data.list<Venta>('Venta')),
    ]);
    this.cuentas.set(cuentas);
    this.clientes.set(clientes);
    this.ventas.set(ventas);
    this.cargando.set(false);
  }

  protected nombreCliente(clienteId: number): string {
    return this.clientes().find((c) => c.id === clienteId)?.nombre ?? '—';
  }

  protected folioVenta(ventaId: number): string {
    return this.ventas().find((v) => v.id === ventaId)?.folio ?? '—';
  }

  private formatearFecha(fecha: string): string {
    return new Date(fecha).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
  }

  async abrirAbono(cuenta: CuentaPorCobrar): Promise<void> {
    this.cuentaAbonar.set(cuenta);
    this.abonosPrevios.set(await this.cuentaPorCobrarService.abonos(cuenta.id));
    this.abonoForm.reset({ monto: cuenta.saldoPendiente, metodoPago: 'Efectivo', notas: '' });
  }

  cerrarAbono(): void {
    this.cuentaAbonar.set(null);
    this.abonosPrevios.set([]);
  }

  async confirmarAbono(): Promise<void> {
    const cuenta = this.cuentaAbonar();
    const usuario = this.auth.usuarioActual();
    if (!cuenta || !usuario || this.abonoForm.invalid) {
      this.abonoForm.markAllAsTouched();
      return;
    }

    const valor = this.abonoForm.getRawValue();
    if (valor.monto > cuenta.saldoPendiente + 0.01) {
      this.toast.advertencia(`El abono no puede ser mayor al saldo pendiente (${this.formatMoneda(cuenta.saldoPendiente)}).`);
      return;
    }

    const turno = await this.turnoCajaService.turnoAbierto(usuario.id);
    if (!turno) {
      this.toast.advertencia('Abre un turno de caja antes de registrar un abono.');
      return;
    }

    this.guardandoAbono.set(true);
    try {
      await this.cuentaPorCobrarService.registrarAbono({
        cuenta,
        monto: valor.monto,
        metodoPago: valor.metodoPago,
        turnoCajaId: turno.id,
        usuarioId: usuario.id,
        notas: valor.notas || null,
      });
      this.toast.exito('Abono registrado.');
      this.cerrarAbono();
      await this.cargar();
    } finally {
      this.guardandoAbono.set(false);
    }
  }
}

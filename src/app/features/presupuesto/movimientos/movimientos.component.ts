import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { DataClientService } from '../../../core/services/data-client.service';
import { AdjuntosPanelComponent } from '../../../shared/components/adjuntos-panel/adjuntos-panel.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { PagoTarjetaService } from '../shared/pago-tarjeta.service';
import { CategoriaPresupuesto } from '../../catalogos/categoria-presupuesto/categoria-presupuesto.model';
import { CuentaPresupuesto } from '../../catalogos/cuenta-presupuesto/cuenta-presupuesto.model';
import { InfoTarjeta, colorCategoria, formatMoneda, iconoTipoCuenta, infoTarjeta, nivelUso } from '../shared/wallet.util';
import { ValorLista } from '../../catalogos/valor-lista/valor-lista.model';
import { MovimientoPresupuesto } from './movimiento.model';

interface ColumnaMensual {
  etiqueta: string;
  ingreso: number;
  gasto: number;
}

interface OpcionMes {
  valor: string;
  etiqueta: string;
}

interface GrupoMovimientos {
  clave: string;
  etiqueta: string;
  movimientos: MovimientoPresupuesto[];
}

/** "2026-8" (año-mes, mes 0-indexado) → "Septiembre 2026" — mismo formato para
 *  el combo "Mes" y para los encabezados de grupo de la lista. */
function etiquetaMes(anio: number, mes: number): string {
  const texto = new Date(anio, mes, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function claveMes(fecha: string): string {
  const f = new Date(fecha);
  return `${f.getFullYear()}-${f.getMonth()}`;
}

interface CuentaConInfo {
  cuenta: CuentaPresupuesto;
  saldo: number;
  esTarjeta: boolean;
  info: InfoTarjeta | null;
}

type TabMovimientos = 'movimientos' | 'cuentas' | 'grafica';

/**
 * Movimientos (ingresos/gastos). Una transferencia entre cuentas propias
 * se modela como el prototipo indica: un par de movimientos (gasto en la
 * cuenta origen + ingreso en la cuenta destino) ligados por el mismo
 * TransferenciaId (GUID) — aquí se resuelve como "tipo Transferencia" en
 * el formulario, que dispara las dos peticiones Alta.
 *
 * Cuentas y categorías son catálogos compartidos (módulo Catálogos); los
 * movimientos en sí son personales — cada usuario solo ve y administra los
 * suyos (creadoPorUsuarioId). Como CuentaPresupuesto no tiene "saldoInicial",
 * el saldo de cada cuenta se calcula 100% a partir de sus movimientos
 * (ingresos suman, gastos restan).
 */
@Component({
  selector: 'app-movimientos',
  standalone: true,
  imports: [ReactiveFormsModule, ConfirmDialogComponent, AdjuntosPanelComponent, DatePipe, DecimalPipe],
  templateUrl: './movimientos.component.html',
  styleUrl: './movimientos.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MovimientosComponent implements OnInit {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly pagoTarjeta = inject(PagoTarjetaService);

  protected readonly formatMoneda = formatMoneda;
  protected readonly colorCategoria = colorCategoria;
  protected readonly iconoTipoCuenta = iconoTipoCuenta;
  protected readonly nivelUso = nivelUso;

  /** Pestaña activa de la página — Movimientos (filtros + lista) es la
   *  principal y por eso va primero/por defecto; Cuentas y la gráfica de
   *  Ingresos vs. gastos quedan cada una en su propia pestaña en vez de
   *  apiladas una tras otra. */
  protected readonly tabActiva = signal<TabMovimientos>('movimientos');

  seleccionarTab(tab: TabMovimientos): void {
    this.tabActiva.set(tab);
  }

  protected readonly movimientos = signal<MovimientoPresupuesto[]>([]);
  protected readonly cuentas = signal<CuentaPresupuesto[]>([]);
  protected readonly categorias = signal<CategoriaPresupuesto[]>([]);
  protected readonly tiposMovimiento = signal<ValorLista[]>([]);
  protected readonly cargando = signal(false);

  protected readonly modalAbierto = signal(false);
  protected readonly movimientoEnEdicion = signal<MovimientoPresupuesto | null>(null);
  protected readonly movimientoAEliminar = signal<MovimientoPresupuesto | null>(null);

  protected readonly filtroTexto = signal('');
  protected readonly filtroCuentaId = signal(0);
  protected readonly filtroCategoriaId = signal(0);
  protected readonly filtroTipo = signal<string>('');
  /** "" = todos los meses; si no, "año-mes" (mes 0-indexado, ver claveMes()). */
  protected readonly filtroMes = signal<string>('');
  /** "" = sin límite; si no, fecha ISO "YYYY-MM-DD" (compara bien como texto). */
  protected readonly filtroFechaDesde = signal<string>('');
  protected readonly filtroFechaHasta = signal<string>('');

  protected readonly hayFiltros = computed(
    () =>
      !!this.filtroTexto() ||
      this.filtroCuentaId() !== 0 ||
      this.filtroCategoriaId() !== 0 ||
      this.filtroTipo() !== '' ||
      this.filtroMes() !== '' ||
      !!this.filtroFechaDesde() ||
      !!this.filtroFechaHasta(),
  );

  /** Movimientos "reales" — excluye los proyectados (generados por
   *  adelantado con "Generar futuros" en Fijos y Proyección, aún sin
   *  confirmar): saldo, gráfica y demás cálculos de dinero solo deben
   *  contar lo que ya ocurrió, no una proyección a futuro. */
  protected readonly movimientosReales = computed(() => this.movimientos().filter((m) => !m.proyectado));

  /** Meses con al menos un movimiento (de más reciente a más antiguo), para el combo "Mes". */
  protected readonly mesesDisponibles = computed<OpcionMes[]>(() => {
    const claves = new Set(this.movimientos().map((m) => claveMes(m.fecha)));
    return [...claves]
      .sort((a, b) => {
        const [anioA, mesA] = a.split('-').map(Number);
        const [anioB, mesB] = b.split('-').map(Number);
        return anioB - anioA || mesB - mesA;
      })
      .map((valor) => {
        const [anio, mes] = valor.split('-').map(Number);
        return { valor, etiqueta: etiquetaMes(anio, mes) };
      });
  });

  protected readonly movimientosFiltrados = computed(() => {
    const texto = this.filtroTexto().trim().toLowerCase();
    const cuentaId = this.filtroCuentaId();
    const categoriaId = this.filtroCategoriaId();
    const tipo = this.filtroTipo();
    const mes = this.filtroMes();
    const desde = this.filtroFechaDesde();
    const hasta = this.filtroFechaHasta();
    return [...this.movimientos()]
      .filter((m) => !cuentaId || m.cuentaPresupuestoId === cuentaId)
      .filter((m) => !categoriaId || m.categoriaPresupuestoId === categoriaId)
      .filter((m) => !tipo || m.tipo === tipo)
      .filter((m) => !mes || claveMes(m.fecha) === mes)
      .filter((m) => !desde || m.fecha >= desde)
      .filter((m) => !hasta || m.fecha <= hasta)
      .filter((m) => !texto || m.descripcion.toLowerCase().includes(texto))
      .sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  });

  /** La misma lista de movimientosFiltrados, pero agrupada por mes — para que
   *  la lista se pueda escanear fácilmente aunque crezca mucho. Como
   *  movimientosFiltrados ya viene ordenado de más reciente a más antiguo, los
   *  grupos salen en ese mismo orden sin necesidad de reordenarlos aparte. */
  protected readonly movimientosAgrupados = computed<GrupoMovimientos[]>(() => {
    const grupos = new Map<string, MovimientoPresupuesto[]>();
    for (const m of this.movimientosFiltrados()) {
      const clave = claveMes(m.fecha);
      const lista = grupos.get(clave);
      if (lista) lista.push(m);
      else grupos.set(clave, [m]);
    }
    return [...grupos.entries()].map(([clave, movimientos]) => {
      const [anio, mes] = clave.split('-').map(Number);
      return { clave, etiqueta: etiquetaMes(anio, mes), movimientos };
    });
  });

  /** Resumen de los últimos 6 meses (ingresos vs gastos) para la gráfica de barras. */
  protected readonly resumenMensual = computed<ColumnaMensual[]>(() => {
    const hoy = new Date();
    const columnas: ColumnaMensual[] = [];
    for (let i = 5; i >= 0; i--) {
      const fecha = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
      const anio = fecha.getFullYear();
      const mes = fecha.getMonth();
      const etiqueta = fecha.toLocaleDateString('es-MX', { month: 'short' });
      const delMes = this.movimientosReales().filter((m) => {
        const f = new Date(m.fecha);
        return f.getFullYear() === anio && f.getMonth() === mes && !m.transferenciaId;
      });
      columnas.push({
        etiqueta,
        ingreso: delMes.filter((m) => m.tipo === 'Ingreso').reduce((s, m) => s + m.monto, 0),
        gasto: delMes.filter((m) => m.tipo === 'Gasto').reduce((s, m) => s + m.monto, 0),
      });
    }
    return columnas;
  });

  protected readonly maxMensual = computed(() =>
    Math.max(1, ...this.resumenMensual().flatMap((c) => [c.ingreso, c.gasto])),
  );

  /** Mismo criterio que el Dashboard (presupuesto-landing): tarjetas con su
   *  info de deuda/límite/atajo de pago, el resto solo con su saldo. */
  protected readonly cuentasConInfo = computed<CuentaConInfo[]>(() =>
    this.cuentas().map((cuenta) => {
      const saldo = this.saldoCuenta(Number(cuenta.id));
      const esTarjeta = cuenta.tipo === 'Tarjeta';
      return { cuenta, saldo, esTarjeta, info: esTarjeta ? infoTarjeta(cuenta, saldo) : null };
    }),
  );

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    fecha: [new Date().toISOString().slice(0, 10), Validators.required],
    tipo: ['Gasto' as string, Validators.required],
    cuentaPresupuestoId: [0, Validators.required],
    cuentaDestinoId: [0],
    categoriaPresupuestoId: [0],
    monto: [0, [Validators.required, Validators.min(0.01)]],
    descripcion: ['', Validators.required],
    /** Editable a mano (además del atajo "✅ Confirmar" y de "Generar
     *  futuros"/"↻ Registrar ciclo" en Fijos y Proyección): permite marcar o
     *  desmarcar cualquier movimiento como proyección a futuro. */
    proyectado: [false],
  });

  get esTransferencia(): boolean {
    return this.form.controls.tipo.value === 'Transferencia';
  }

  /** Tipo actual del formulario como signal (para filtrar Categoría reactivamente sin duplicar estado). */
  private readonly tipoFormulario = toSignal(this.form.controls.tipo.valueChanges, {
    initialValue: this.form.controls.tipo.value,
  });

  /** Solo categorías del mismo Tipo (o sin Tipo definido — catálogo previo a este campo). */
  protected readonly categoriasFiltradas = computed(() => {
    const tipo = this.tipoFormulario();
    return this.categorias().filter((c) => !c.tipo || c.tipo === tipo);
  });

  /** Si al cambiar Tipo la categoría ya elegida deja de aplicar, se limpia (evita guardar una combinación inconsistente). */
  onTipoChange(): void {
    const tipo = this.form.controls.tipo.value;
    const categoriaId = this.form.controls.categoriaPresupuestoId.value;
    const categoria = this.categorias().find((c) => Number(c.id) === Number(categoriaId));
    if (categoria?.tipo && categoria.tipo !== tipo) {
      this.form.controls.categoriaPresupuestoId.setValue(0);
    }
  }

  private get usuarioActualId(): number {
    return this.auth.usuarioActual()?.id ?? 0;
  }

  ngOnInit(): void {
    this.data.list<CuentaPresupuesto>('CuentaPresupuesto').subscribe((cuentas) => this.cuentas.set(cuentas));
    this.data.list<CategoriaPresupuesto>('CategoriaPresupuesto').subscribe((categorias) => this.categorias.set(categorias));
    this.data.list<ValorLista>('ValorLista', { grupo: 'MovimientoPresupuestoTipo' }).subscribe((valores) =>
      this.tiposMovimiento.set(
        valores.filter((v) => v.grupo === 'MovimientoPresupuestoTipo').sort((a, b) => a.orden - b.orden),
      ),
    );
    this.cargar();
    this.abrirSolicitudPagoTarjetaSiExiste();
  }

  /** Atajo "Pagar tarjeta" desde la propia pestaña Cuentas de esta página
   *  (mismo atajo que ya existe en el Dashboard): dejamos la solicitud y la
   *  consumimos en el acto, sin necesidad de navegar a ningún lado. */
  pagarTarjeta(cuentaInfo: CuentaConInfo): void {
    if (!cuentaInfo.info || cuentaInfo.info.deuda <= 0) return;
    this.pagoTarjeta.solicitar(cuentaInfo.cuenta, cuentaInfo.info.deuda);
    this.abrirSolicitudPagoTarjetaSiExiste();
  }

  /** Si venimos del botón "Pagar tarjeta" del Dashboard, abre ya el modal de
   *  transferencia con la tarjeta destino y el monto de la deuda prellenados
   *  (el usuario solo elige de qué cuenta sale el pago). */
  private abrirSolicitudPagoTarjetaSiExiste(): void {
    const solicitud = this.pagoTarjeta.consumir();
    if (!solicitud) return;
    this.movimientoEnEdicion.set(null);
    this.form.reset({
      id: 0,
      fecha: new Date().toISOString().slice(0, 10),
      tipo: 'Transferencia',
      cuentaPresupuestoId: 0,
      cuentaDestinoId: solicitud.cuentaId,
      categoriaPresupuestoId: 0,
      monto: solicitud.monto,
      descripcion: solicitud.descripcion,
    });
    this.modalAbierto.set(true);
  }

  cargar(): void {
    this.cargando.set(true);
    this.data.list<MovimientoPresupuesto>('MovimientoPresupuesto', { creadoPorUsuarioId: this.usuarioActualId }).subscribe({
      next: (movimientos) => {
        this.movimientos.set(movimientos);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  limpiarFiltros(): void {
    this.filtroTexto.set('');
    this.filtroCuentaId.set(0);
    this.filtroCategoriaId.set(0);
    this.filtroTipo.set('');
    this.filtroMes.set('');
    this.filtroFechaDesde.set('');
    this.filtroFechaHasta.set('');
  }

  nombreCuenta(id: number): string {
    return this.cuentas().find((c) => Number(c.id) === Number(id))?.nombre ?? '—';
  }

  nombreCategoria(id: number | null): string {
    if (!id) return 'Sin categoría';
    return this.categorias().find((c) => Number(c.id) === Number(id))?.nombre ?? '—';
  }

  /** Saldo actual de una cuenta = suma de sus ingresos menos sus gastos (no hay saldo inicial en el catálogo).
   *  Solo cuenta movimientos reales — uno proyectado a futuro aún no pasó. */
  saldoCuenta(cuentaId: number): number {
    return this.movimientosReales()
      .filter((m) => Number(m.cuentaPresupuestoId) === Number(cuentaId))
      .reduce((s, m) => s + (m.tipo === 'Ingreso' ? m.monto : -m.monto), 0);
  }

  nuevo(): void {
    this.movimientoEnEdicion.set(null);
    this.form.reset({
      id: 0,
      fecha: new Date().toISOString().slice(0, 10),
      tipo: 'Gasto',
      cuentaPresupuestoId: 0,
      cuentaDestinoId: 0,
      categoriaPresupuestoId: 0,
      monto: 0,
      descripcion: '',
      proyectado: false,
    });
    this.modalAbierto.set(true);
  }

  editar(movimiento: MovimientoPresupuesto): void {
    this.movimientoEnEdicion.set(movimiento);
    this.form.reset({
      id: movimiento.id,
      fecha: movimiento.fecha?.slice(0, 10),
      tipo: movimiento.tipo,
      cuentaPresupuestoId: Number(movimiento.cuentaPresupuestoId),
      cuentaDestinoId: 0,
      categoriaPresupuestoId: movimiento.categoriaPresupuestoId ? Number(movimiento.categoriaPresupuestoId) : 0,
      monto: movimiento.monto,
      descripcion: movimiento.descripcion,
      proyectado: movimiento.proyectado ?? false,
    });
    this.modalAbierto.set(true);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const valor = this.form.getRawValue();
    const esEdicion = this.movimientoEnEdicion() !== null;
    const creadoPorUsuarioId = this.usuarioActualId;

    if (!esEdicion && valor.tipo === 'Transferencia') {
      if (!valor.cuentaDestinoId) {
        this.toast.advertencia('Selecciona la cuenta destino.');
        return;
      }
      const transferenciaId = crypto.randomUUID();
      const base = {
        fecha: valor.fecha,
        monto: valor.monto,
        descripcion: valor.descripcion,
        categoriaPresupuestoId: null,
        transferenciaId,
        origenRecurrenteId: null,
        creadoPorUsuarioId,
      };
      const salida = { ...base, tipo: 'Gasto' as const, cuentaPresupuestoId: Number(valor.cuentaPresupuestoId) };
      const entrada = { ...base, tipo: 'Ingreso' as const, cuentaPresupuestoId: Number(valor.cuentaDestinoId) };

      this.data.alta<MovimientoPresupuesto>('MovimientoPresupuesto', salida).subscribe({
        next: (movimientoSalida) => {
          this.data.alta<MovimientoPresupuesto>('MovimientoPresupuesto', entrada).subscribe({
            next: () => {
              this.toast.exito('Transferencia registrada.');
              this.modalAbierto.set(false);
              this.cargar();
            },
            // La salida ya se guardó pero la entrada falló: se revierte la
            // salida para no dejar una transferencia con una sola pierna
            // huérfana (que aparecería como un gasto suelto sin su ingreso par).
            error: () => {
              this.data.baja('MovimientoPresupuesto', movimientoSalida.id).subscribe();
              this.toast.error('No se pudo completar la transferencia; se revirtió el movimiento parcial. Intenta de nuevo.');
            },
          });
        },
        error: () => this.toast.error('No se pudo registrar la transferencia. Intenta de nuevo.'),
      });
      return;
    }

    const { cuentaDestinoId: _cuentaDestinoId, tipo, ...resto } = valor;
    const payload = {
      ...resto,
      tipo: tipo as 'Ingreso' | 'Gasto',
      cuentaPresupuestoId: Number(resto.cuentaPresupuestoId),
      categoriaPresupuestoId: resto.categoriaPresupuestoId ? Number(resto.categoriaPresupuestoId) : null,
      creadoPorUsuarioId,
      origenRecurrenteId: this.movimientoEnEdicion()?.origenRecurrenteId ?? null,
      // put() reemplaza el registro completo: transferenciaId no lo controla
      // el formulario, así que hay que conservarlo explícitamente al editar
      // para no perderlo (nunca se crea uno aquí; solo el flujo de
      // transferencia de arriba genera un transferenciaId). "proyectado" sí
      // viene de resto — el checkbox del formulario decide su valor.
      transferenciaId: this.movimientoEnEdicion()?.transferenciaId ?? null,
    };
    const peticion = esEdicion
      ? this.data.modificacion<MovimientoPresupuesto>('MovimientoPresupuesto', payload)
      : this.data.alta<MovimientoPresupuesto>('MovimientoPresupuesto', payload);

    peticion.subscribe({
      next: (resultado) => {
        this.toast.exito(esEdicion ? 'Movimiento actualizado.' : 'Movimiento creado.');
        this.movimientoEnEdicion.set(resultado);
        this.cargar();
        if (!esEdicion) this.modalAbierto.set(false);
      },
    });
  }

  /** Confirma un movimiento proyectado (generado por adelantado con "Generar
   *  futuros" en Fijos y Proyección) directamente desde su modal de edición,
   *  sin tener que ir a Fijos y Proyección ni esperar al botón "Guardar". */
  confirmarProyectado(): void {
    const movimiento = this.movimientoEnEdicion();
    if (!movimiento) return;
    this.data.modificacion<MovimientoPresupuesto>('MovimientoPresupuesto', { ...movimiento, proyectado: false }).subscribe({
      next: (resultado) => {
        this.toast.exito('Movimiento confirmado.');
        this.movimientoEnEdicion.set(resultado);
        this.cargar();
      },
    });
  }

  pedirEliminar(movimiento: MovimientoPresupuesto): void {
    this.movimientoAEliminar.set(movimiento);
  }

  confirmarEliminar(): void {
    const movimiento = this.movimientoAEliminar();
    if (!movimiento) return;

    this.data.baja('MovimientoPresupuesto', movimiento.id).subscribe({
      next: () => {
        this.toast.exito('Movimiento eliminado.');
        this.movimientoAEliminar.set(null);
        if (this.movimientoEnEdicion()?.id === movimiento.id) this.modalAbierto.set(false);
        this.cargar();
      },
    });
  }
}

import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { DataClientService } from '../../../core/services/data-client.service';
import { AdjuntosPanelComponent } from '../../../shared/components/adjuntos-panel/adjuntos-panel.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { PagoTarjetaService } from '../shared/pago-tarjeta.service';
import { AnioTrabajoService } from '../shared/anio-trabajo.service';
import { CategoriaPresupuesto } from '../categoria-presupuesto/categoria-presupuesto.model';
import { CuentaPresupuesto } from '../cuenta-presupuesto/cuenta-presupuesto.model';
import { InfoTarjeta, colorCategoria, etiquetaMes, formatMoneda, formatMonedaCompacta, iconoTipoCuenta, infoTarjeta, nivelUso, nombreMes, opcionesCategoriasBuscable, opcionesCuentasBuscable } from '../shared/wallet.util';
import { ValorLista } from '../../../shared/valor-lista/valor-lista.model';
import { MovimientoPresupuesto } from './movimiento.model';
import { PresupuestoAnual } from '../presupuesto-anual/presupuesto-anual.model';
import { SelectBuscableComponent } from '../../../shared/components/select-buscable/select-buscable.component';
import { exportarCsv } from '../../../shared/utils/csv.util';

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

/** Parsea "YYYY-MM-DD" directamente como texto (sin pasar por `new Date`):
 *  los <input type="date"> siempre guardan fecha en ese formato sin hora, y
 *  `new Date("YYYY-MM-DD")` la interpreta como UTC — en una zona horaria
 *  detrás de UTC (México) eso la recorre un día para atrás y cae en el mes
 *  incorrecto. Comparar el texto evita ese corrimiento. */
function claveMes(fecha: string): string {
  const [anioTexto, mesTexto] = fecha.split('-');
  return `${Number(anioTexto)}-${Number(mesTexto) - 1}`;
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
 * Presupuesto Personal es COMPARTIDO entre todos los usuarios (como
 * Proyectos/Comercio, no personal por usuario): cuentas y categorías ya eran
 * catálogos compartidos (módulo Catálogos), y ahora movimientos/deudas/
 * metas/límites/recurrentes también se ven y se administran entre todos —
 * creadoPorUsuarioId se sigue guardando (quién lo capturó), pero ya NO se
 * usa para filtrar qué se ve, solo como dato de auditoría, igual que
 * VendedorUsuarioId en Comercio. Como CuentaPresupuesto no tiene
 * "saldoInicial", el saldo de cada cuenta se calcula 100% a partir de TODOS
 * los movimientos de todos los usuarios (ingresos suman, gastos restan).
 */
@Component({
  selector: 'app-movimientos',
  standalone: true,
  imports: [ReactiveFormsModule, ConfirmDialogComponent, AdjuntosPanelComponent, DatePipe, DecimalPipe, SelectBuscableComponent],
  templateUrl: './movimientos.component.html',
  styleUrl: './movimientos.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MovimientosComponent implements OnInit, OnDestroy {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly pagoTarjeta = inject(PagoTarjetaService);

  protected readonly presupuestosAnuales = signal<PresupuestoAnual[]>([]);

  protected readonly formatMoneda = formatMoneda;
  protected readonly formatMonedaCompacta = formatMonedaCompacta;
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

  /** Opciones del combo buscable "Cuenta" (filtro) — "Todas" primero. */
  protected readonly opcionesCuentaFiltro = computed(() => [
    { valor: 0, etiqueta: 'Todas' },
    ...opcionesCuentasBuscable(this.cuentas()),
  ]);

  /** Categorías organizadas en raíz + hijas directas (máx. 2 niveles, ver
   *  CategoriaPresupuesto), para el combo buscable "Categoría": antes se
   *  listaban todas iguales, una tras otra, y no se distinguía cuál era una
   *  categoría padre (p. ej. HOGAR) y cuáles sus subcategorías (Hipoteca,
   *  Gas, Luz...). Agrupadas, <app-select-buscable> las agrupa visualmente
   *  (título en negritas, hijas con sangría) igual que hacía el <optgroup>
   *  anterior, pero ahora también se pueden filtrar escribiendo. */
  /** Solo categorías del Tipo elegido en el filtro de arriba (o sin Tipo
   *  definido — catálogo previo a ese campo). Antes el combo de "Categoría"
   *  del filtro mostraba TODAS las categorías sin importar el Tipo elegido,
   *  aunque Categoría depende de Tipo (mismo patrón ya usado en el
   *  formulario Nuevo/Editar movimiento, ver categoriasFiltradas). */
  protected readonly categoriasFiltroPorTipo = computed(() => {
    const tipo = this.filtroTipo();
    return tipo === '' ? this.categorias() : this.categorias().filter((c) => !c.tipo || c.tipo === tipo);
  });

  protected readonly opcionesCategoriaFiltro = computed(() => [
    { valor: 0, etiqueta: 'Todas' },
    ...opcionesCategoriasBuscable(this.categoriasFiltroPorTipo()),
  ]);
  protected readonly tiposMovimiento = signal<ValorLista[]>([]);
  protected readonly cargando = signal(false);

  protected readonly modalAbierto = signal(false);
  protected readonly movimientoEnEdicion = signal<MovimientoPresupuesto | null>(null);
  protected readonly movimientoAEliminar = signal<MovimientoPresupuesto | null>(null);

  /** true cuando el movimiento en edición es una de las dos piernas de una
   *  transferencia entre cuentas (tiene transferenciaId). En ese caso el
   *  formulario bloquea Tipo/Cuenta/Categoría (cambiarlos rompería el par) y
   *  guardar()/confirmarEliminar() también actualizan/eliminan la pierna
   *  contraria para que ambas no se desincronicen. */
  protected readonly esTransferenciaEdicion = computed(() => !!this.movimientoEnEdicion()?.transferenciaId);

  protected readonly filtroTexto = signal('');
  protected readonly filtroCuentaId = signal(0);
  protected readonly filtroCategoriaId = signal(0);
  protected readonly filtroTipo = signal<string>('');

  /** Al cambiar el Tipo del filtro, si la Categoría ya elegida deja de
   *  aplicar a ese Tipo, se limpia a "Todas" — evita dejar un filtro
   *  imposible de cumplir (p.ej. Tipo=Ingreso + Categoría de gasto), igual
   *  que onTipoChange() ya hace en el formulario Nuevo/Editar movimiento. */
  protected establecerFiltroTipo(valor: string): void {
    this.filtroTipo.set(valor);
    const categoria = this.categorias().find((c) => Number(c.id) === Number(this.filtroCategoriaId()));
    if (valor !== '' && categoria?.tipo && categoria.tipo !== valor) {
      this.filtroCategoriaId.set(0);
    }
  }
  /** "" = todos los meses; si no, "año-mes" (mes 0-indexado, ver claveMes()). */
  protected readonly filtroMes = signal<string>('');
  protected readonly anioTrabajo = inject(AnioTrabajoService);

  /** "" = todos los años; si no, año como texto (p.ej. "2026"). Alias de
   *  SOLO LECTURA sobre el año de trabajo COMPARTIDO con Proyección y con
   *  Fijos y Proyección (ver AnioTrabajoService) — para cambiarlo usa
   *  establecerFiltroAnio(), no filtroAnio.set() (ya no existe: es un
   *  computed). */
  protected readonly filtroAnio = computed(() =>
    this.anioTrabajo.seleccionado() === 'todos' ? '' : String(this.anioTrabajo.seleccionado()),
  );

  protected establecerFiltroAnio(valor: string): void {
    this.anioTrabajo.seleccionado.set(valor === '' ? 'todos' : Number(valor));
  }
  /** "" = sin límite; si no, fecha ISO "YYYY-MM-DD" (compara bien como texto). */
  protected readonly filtroFechaDesde = signal<string>('');
  protected readonly filtroFechaHasta = signal<string>('');
  /** 'desc' = más reciente primero (por defecto), 'asc' = más antiguo primero. */
  protected readonly ordenFecha = signal<'desc' | 'asc'>('desc');

  /** El Año ya no cuenta como "filtro activo": ahora es el año de trabajo
   *  compartido (siempre hay uno elegido, no una opción para quitar), así
   *  que "Limpiar filtros" y el aviso de filtros activos solo consideran
   *  los demás campos. */
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

  /** Años dados de alta en Catálogos → "Presupuesto por año" (de más
   *  reciente a más antiguo), para el combo "Año" — antes salían de qué
   *  años ya tenían movimientos; ahora, para que el filtro respete el año
   *  de presupuesto igual que Proyección, sale de ese catálogo. Si un año
   *  con movimientos todavía no está registrado ahí, no aparece como
   *  opción individual (sigue viéndose con "Todos"): regístralo en
   *  Catálogos → Presupuesto por año para poder filtrar solo por ese año. */
  protected readonly aniosDisponibles = computed<string[]>(() => {
    const anios = new Set(this.presupuestosAnuales().map((p) => String(p.anio)));
    return [...anios].sort((a, b) => Number(b) - Number(a));
  });

  /** Ya no hay opción "Todos" en el selector de Año — apenas se conocen
   *  los años registrados, se propone uno real si aún no hay ninguno
   *  elegido (compartido con Proyección y Fijos; ver
   *  AnioTrabajoService.asegurarSeleccion). */
  private readonly _asegurarAnioTrabajo = effect(() =>
    this.anioTrabajo.asegurarSeleccion(this.aniosDisponibles().map(Number)),
  );

  protected readonly movimientosFiltrados = computed(() => {
    const texto = this.filtroTexto().trim().toLowerCase();
    const cuentaId = this.filtroCuentaId();
    const categoriaId = this.filtroCategoriaId();
    const tipo = this.filtroTipo();
    const mes = this.filtroMes();
    const anio = this.filtroAnio();
    const desde = this.filtroFechaDesde();
    const hasta = this.filtroFechaHasta();
    return [...this.movimientos()]
      .filter((m) => !cuentaId || m.cuentaPresupuestoId === cuentaId)
      .filter((m) => !categoriaId || m.categoriaPresupuestoId === categoriaId)
      .filter((m) => !tipo || m.tipo === tipo)
      .filter((m) => !mes || claveMes(m.fecha) === mes)
      .filter((m) => !anio || m.fecha.slice(0, 4) === anio)
      .filter((m) => !desde || m.fecha >= desde)
      .filter((m) => !hasta || m.fecha <= hasta)
      .filter((m) => !texto || m.descripcion.toLowerCase().includes(texto) || String(m.monto).includes(texto))
      .sort((a, b) => {
        const signo = this.ordenFecha() === 'asc' ? 1 : -1;
        return a.fecha < b.fecha ? signo : a.fecha > b.fecha ? -signo : 0;
      });
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

  // Cada grupo (mes) se puede expandir/contraer haciendo clic en su título,
  // igual que los renglones de grupo en Proyección — y arrancan contraídos
  // por default (el set solo guarda las claves que el usuario SÍ expandió)
  // para que la lista no abrume al entrar con muchos meses ya cargados.
  private readonly gruposExpandidos = signal<Set<string>>(new Set());

  protected estaExpandido(clave: string): boolean {
    return this.gruposExpandidos().has(clave);
  }

  protected toggleGrupo(clave: string): void {
    const actualizado = new Set(this.gruposExpandidos());
    if (actualizado.has(clave)) actualizado.delete(clave);
    else actualizado.add(clave);
    this.gruposExpandidos.set(actualizado);
  }

  /** Mes "desde"/"hasta" (1-12) del rango que se grafica — independientes
   *  del filtro de Mes de la lista (ese es un solo mes; aquí es un rango).
   *  El Año en cambio SÍ es el mismo "año de trabajo" compartido (filtroAnio
   *  / AnioTrabajoService) que ya usan Movimientos, Fijos y Proyección y
   *  Proyección, para no tener un cuarto selector de Año desincronizado. */
  /** Como valor de <option> (string "1".."12"), no número — así el
   *  [selected] por opción (ver template) hace la comparación directa,
   *  igual que ya hace el selector de Año (evita el problema conocido de
   *  Angular donde un [value] en el <select> no "encuentra" la opción si
   *  las opciones se generan con @for). */
  protected readonly graficaMesDesde = signal<string>('1');
  protected readonly graficaMesHasta = signal<string>('12');

  /** Opciones fijas (Enero..Diciembre) para los selectores "Desde"/"Hasta" de la gráfica. */
  protected readonly mesesGrafica: OpcionMes[] = Array.from({ length: 12 }, (_, i) => ({
    valor: String(i + 1),
    etiqueta: nombreMes(i),
  }));

  /** Texto del encabezado de la gráfica: el año solo si es Ene-Dic completo,
   *  o "Mes – Mes Año" cuando el usuario acotó el rango. */
  protected readonly etiquetaRangoGrafica = computed(() => {
    const anio = this.filtroAnio() || String(new Date().getFullYear());
    const desde = Math.min(Number(this.graficaMesDesde()), Number(this.graficaMesHasta()));
    const hasta = Math.max(Number(this.graficaMesDesde()), Number(this.graficaMesHasta()));
    if (desde === 1 && hasta === 12) return anio;
    if (desde === hasta) return `${nombreMes(desde - 1)} ${anio}`;
    return `${nombreMes(desde - 1)} – ${nombreMes(hasta - 1)} ${anio}`;
  });

  /** Ingresos vs. gastos del año y rango de meses elegidos (ver
   *  graficaMesDesde/graficaMesHasta y filtroAnio) para la gráfica de barras. */
  protected readonly resumenMensual = computed<ColumnaMensual[]>(() => {
    const anio = this.filtroAnio() ? Number(this.filtroAnio()) : new Date().getFullYear();
    const desde = Math.min(Number(this.graficaMesDesde()), Number(this.graficaMesHasta()));
    const hasta = Math.max(Number(this.graficaMesDesde()), Number(this.graficaMesHasta()));
    const columnas: ColumnaMensual[] = [];
    for (let mes1 = desde; mes1 <= hasta; mes1++) {
      const mes = mes1 - 1; // 0-indexado, igual que claveMes()
      const etiqueta = new Date(anio, mes, 1).toLocaleDateString('es-MX', { month: 'short' });
      const claveColumna = `${anio}-${mes}`;
      const delMes = this.movimientosReales().filter((m) => claveMes(m.fecha) === claveColumna && !m.transferenciaId);
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

  /** Igual que opcionesCategoriaFiltro pero ya filtrado por Tipo, para el
   *  combo del formulario Nuevo/Editar movimiento — antes ese combo listaba
   *  todas las categorías del Tipo actual en fila, una tras otra, sin
   *  distinguir padres de subcategorías (mismo problema que ya se había
   *  arreglado en el filtro de arriba). */
  protected readonly opcionesCategoriaFormulario = computed(() => [
    { valor: 0, etiqueta: 'Sin categoría' },
    ...opcionesCategoriasBuscable(this.categoriasFiltradas()),
  ]);

  /** Opciones del combo buscable "Cuenta"/"Cuenta origen"/"Cuenta destino"
   *  del formulario Nuevo/Editar movimiento (sin "Todas": aquí siempre hay
   *  que elegir una cuenta real). */
  protected readonly opcionesCuentaFormulario = computed(() => [
    { valor: 0, etiqueta: 'Selecciona...' },
    ...opcionesCuentasBuscable(this.cuentas()),
  ]);

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
    // Lista con varios filtros a la vez — usa el ancho "wide" del layout
    // para no apretarlos (ver html[data-wide='grid'] en styles.scss, mismo
    // patrón que Proyección).
    document.documentElement.setAttribute('data-wide', 'grid');
    this.data.list<CuentaPresupuesto>('CuentaPresupuesto').subscribe((cuentas) => this.cuentas.set(cuentas));
    this.data.list<CategoriaPresupuesto>('CategoriaPresupuesto').subscribe((categorias) => this.categorias.set(categorias));
    this.data.list<ValorLista>('ValorLista', { grupo: 'MovimientoPresupuestoTipo' }).subscribe((valores) =>
      this.tiposMovimiento.set(
        valores.filter((v) => v.grupo === 'MovimientoPresupuestoTipo').sort((a, b) => a.orden - b.orden),
      ),
    );
    this.data.list<PresupuestoAnual>('PresupuestoAnual').subscribe((p) => this.presupuestosAnuales.set(p));
    this.cargar();
    this.abrirSolicitudPagoTarjetaSiExiste();
  }

  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
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
    this.data.list<MovimientoPresupuesto>('MovimientoPresupuesto').subscribe({
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
    // El Año (de trabajo, compartido) no se toca aquí — ver hayFiltros.
    this.filtroFechaDesde.set('');
    this.filtroFechaHasta.set('');
    this.ordenFecha.set('desc');
  }

  nombreCuenta(id: number): string {
    return this.cuentas().find((c) => Number(c.id) === Number(id))?.nombre ?? '—';
  }

  nombreCategoria(id: number | null): string {
    if (!id) return 'Sin categoría';
    return this.categorias().find((c) => Number(c.id) === Number(id))?.nombre ?? '—';
  }

  /** Exporta lo que esté filtrado/visible en la lista (respeta buscador,
   *  cuenta, categoría, tipo, mes/año y rango de fechas ya aplicados). */
  exportarCsvArchivo(): void {
    const filas = this.movimientosFiltrados();
    exportarCsv(
      'movimientos.csv',
      [
        { clave: 'fecha', etiqueta: 'Fecha' },
        { clave: 'tipo', etiqueta: 'Tipo' },
        { clave: 'cuenta', etiqueta: 'Cuenta' },
        { clave: 'categoria', etiqueta: 'Categoría' },
        { clave: 'monto', etiqueta: 'Monto' },
        { clave: 'descripcion', etiqueta: 'Descripción' },
      ],
      filas.map((m) => ({
        fecha: m.fecha,
        tipo: m.transferenciaId ? 'Transferencia' : m.tipo,
        cuenta: this.nombreCuenta(m.cuentaPresupuestoId),
        categoria: m.transferenciaId ? '—' : this.nombreCategoria(m.categoriaPresupuestoId),
        monto: m.monto,
        descripcion: m.descripcion,
      })),
    );
    this.toast.exito(`Se descargó movimientos.csv (${filas.length} registro${filas.length === 1 ? '' : 's'}).`);
  }

  /** Saldo actual de una cuenta = suma de sus ingresos menos sus gastos (no hay saldo inicial en el catálogo).
   *  Solo cuenta movimientos reales — uno proyectado a futuro aún no pasó. */
  saldoCuenta(cuentaId: number): number {
    return this.movimientosReales()
      .filter((m) => Number(m.cuentaPresupuestoId) === Number(cuentaId))
      .reduce((s, m) => s + (m.tipo === 'Ingreso' ? m.monto : -m.monto), 0);
  }

  /** Fecha inicial de "Nuevo movimiento": hoy, salvo que haya un año de
   *  trabajo elegido (compartido con Proyección y Fijos y Proyección) —
   *  entonces arranca en ese año, mismo mes/día de hoy, para que la
   *  captura quede alineada al año en el que se está trabajando. */
  private fechaPorDefecto(): string {
    const hoy = new Date();
    const anio = this.anioTrabajo.seleccionado();
    if (anio === 'todos') return hoy.toISOString().slice(0, 10);
    return new Date(anio, hoy.getMonth(), hoy.getDate()).toISOString().slice(0, 10);
  }

  /** Busca la otra pierna de una transferencia (mismo transferenciaId,
   *  distinto id) en la lista ya cargada en memoria — evita otra llamada al
   *  backend solo para encontrarla. */
  private piernaContraria(movimiento: MovimientoPresupuesto): MovimientoPresupuesto | undefined {
    if (!movimiento.transferenciaId) return undefined;
    return this.movimientos().find((m) => m.transferenciaId === movimiento.transferenciaId && m.id !== movimiento.id);
  }

  nuevo(): void {
    this.movimientoEnEdicion.set(null);
    // Por si el modal anterior fue la edición de una pierna de transferencia
    // y quedaron deshabilitados (ver editar()).
    this.form.controls.tipo.enable();
    this.form.controls.cuentaPresupuestoId.enable();
    this.form.controls.categoriaPresupuestoId.enable();
    this.form.reset({
      id: 0,
      fecha: this.fechaPorDefecto(),
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
    // Una pierna de transferencia no puede cambiar de Tipo/Cuenta/Categoría
    // sin romper el par (la otra pierna quedaría apuntando a información
    // inconsistente) — se bloquean esos campos; fecha/monto/descripción sí
    // se pueden editar y guardar() los replica en la pierna contraria.
    const esTransferencia = !!movimiento.transferenciaId;
    this.form.controls.tipo[esTransferencia ? 'disable' : 'enable']();
    this.form.controls.cuentaPresupuestoId[esTransferencia ? 'disable' : 'enable']();
    this.form.controls.categoriaPresupuestoId[esTransferencia ? 'disable' : 'enable']();
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
        // Si esta pierna pertenece a una transferencia, la fecha/monto/
        // descripción/proyectado se replican en la pierna contraria para que
        // ambas no queden desincronizadas (Tipo/Cuenta/Categoría están
        // bloqueados en el formulario para esta pierna — ver editar()).
        const pareja = esEdicion ? this.piernaContraria(resultado) : undefined;
        if (pareja) {
          this.data
            .modificacion<MovimientoPresupuesto>('MovimientoPresupuesto', {
              ...pareja,
              fecha: payload.fecha,
              monto: payload.monto,
              descripcion: payload.descripcion,
              proyectado: payload.proyectado,
            })
            .subscribe({
              error: () =>
                this.toast.advertencia('Se actualizó este movimiento, pero no se pudo sincronizar su transferencia pareja.'),
            });
        }
        this.toast.exito(
          esEdicion ? (pareja ? 'Transferencia actualizada (ambos movimientos).' : 'Movimiento actualizado.') : 'Movimiento creado.',
        );
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

  /** Igual que confirmarProyectado(), pero directo desde el renglón de la
   *  lista (botón "✅ Confirmar") — sin tener que abrir el modal de edición
   *  solo para aceptar un movimiento ya generado por adelantado. */
  confirmarProyectadoRapido(movimiento: MovimientoPresupuesto): void {
    this.data.modificacion<MovimientoPresupuesto>('MovimientoPresupuesto', { ...movimiento, proyectado: false }).subscribe({
      next: () => {
        this.toast.exito('Movimiento confirmado.');
        this.cargar();
      },
    });
  }

  pedirEliminar(movimiento: MovimientoPresupuesto): void {
    this.movimientoAEliminar.set(movimiento);
  }

  /** Texto del diálogo de confirmación de borrado — distinto cuando el
   *  movimiento es una pierna de transferencia, para avisar que se borran
   *  ambos movimientos juntos. */
  protected mensajeEliminar(): string {
    return this.movimientoAEliminar()?.transferenciaId
      ? '¿Eliminar esta transferencia? Se eliminarán los dos movimientos (salida y entrada) juntos.'
      : '¿Eliminar este movimiento?';
  }

  confirmarEliminar(): void {
    const movimiento = this.movimientoAEliminar();
    if (!movimiento) return;
    // Si es una pierna de transferencia, se borra junto con su pareja para
    // no dejar un movimiento huérfano sin su contraparte.
    const pareja = this.piernaContraria(movimiento);

    this.data.baja('MovimientoPresupuesto', movimiento.id).subscribe({
      next: () => {
        const finalizar = (mensaje?: string) => {
          if (mensaje) this.toast.exito(mensaje);
          this.movimientoAEliminar.set(null);
          if (this.movimientoEnEdicion()?.id === movimiento.id) this.modalAbierto.set(false);
          this.cargar();
        };
        if (pareja) {
          this.data.baja('MovimientoPresupuesto', pareja.id).subscribe({
            next: () => finalizar('Transferencia eliminada (ambos movimientos).'),
            error: () => {
              this.toast.advertencia('Se eliminó este movimiento, pero no se pudo eliminar su transferencia pareja; revísala manualmente.');
              finalizar();
            },
          });
        } else {
          finalizar('Movimiento eliminado.');
        }
      },
    });
  }
}

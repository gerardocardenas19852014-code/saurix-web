import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { DataClientService } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { AdjuntosPanelComponent } from '../../../shared/components/adjuntos-panel/adjuntos-panel.component';
import { ToastService } from '../../../shared/services/toast.service';
import { CategoriaPresupuesto } from '../categoria-presupuesto/categoria-presupuesto.model';
import { CuentaPresupuesto } from '../cuenta-presupuesto/cuenta-presupuesto.model';
import { MovimientoPresupuesto } from '../movimientos/movimiento.model';
import { ValorLista } from '../../catalogos/valor-lista/valor-lista.model';
import { MovimientoRecurrentePresupuesto } from './recurrente.model';
import { PresupuestoAnual } from '../presupuesto-anual/presupuesto-anual.model';
import { fechaLocalDeTexto, opcionesCategoriasBuscable, opcionesCuentasBuscable, textoFechaDeLocal } from '../shared/wallet.util';
import { AnioTrabajoService } from '../shared/anio-trabajo.service';
import { SelectBuscableComponent } from '../../../shared/components/select-buscable/select-buscable.component';

/**
 * "Fijos y Proyección": gastos/ingresos recurrentes (renta, nómina,
 * suscripciones, etc.). Cada fijo muestra el estado de su ciclo actual
 * (Registrado / Pendiente / Próximo) y permite "Registrar este ciclo" para
 * generar de un clic el MovimientoPresupuesto correspondiente, ligado de
 * vuelta al fijo vía origenRecurrenteId. Si el ciclo ya venció sin
 * registrarse se avisa una sola vez por ciclo (avisoFaltanteCiclo).
 */
@Component({
  selector: 'app-recurrentes',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, AdjuntosPanelComponent, SelectBuscableComponent],
  templateUrl: './recurrentes.component.html',
  styleUrl: './recurrentes.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecurrentesComponent implements OnInit, OnDestroy {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);

  protected readonly recurrentes = signal<MovimientoRecurrentePresupuesto[]>([]);
  protected readonly movimientosOrigen = signal<MovimientoPresupuesto[]>([]);
  protected readonly cuentas = signal<CuentaPresupuesto[]>([]);
  protected readonly categorias = signal<CategoriaPresupuesto[]>([]);
  protected readonly tiposMovimiento = signal<ValorLista[]>([]);
  protected readonly frecuencias = signal<ValorLista[]>([]);
  protected readonly presupuestosAnuales = signal<PresupuestoAnual[]>([]);
  protected readonly cargando = signal(false);

  /** Años dados de alta en Catálogos → "Presupuesto por año" — el campo
   *  "Desde" de un fijo Anual elige entre estos en vez de escribir el año
   *  libremente. Si todavía no hay ninguno registrado, se cae de vuelta a
   *  un campo numérico libre (ver recurrentes.component.html). */
  protected readonly aniosPresupuesto = computed(() =>
    [...this.presupuestosAnuales()].map((p) => p.anio).sort((a, b) => a - b),
  );

  /** Año de trabajo COMPARTIDO con Movimientos y Proyección — cuando ya hay
   *  uno elegido, "Desde" arranca ahí por defecto (ver resetearDesdeGenerar). */
  protected readonly anioTrabajo = inject(AnioTrabajoService);

  /** Cuántos ciclos futuros generar de una vez con "Generar futuros"
   *  (meses si la frecuencia no es Anual; años si lo es). */
  protected readonly nCiclosAGenerar = signal(6);
  /** Desde cuándo empieza a contar "Generar futuros" — por defecto el mes/año
   *  actual, pero el usuario puede adelantarlo o atrasarlo (p.ej. un fijo que
   *  arranca hasta dentro de unos meses, o retomar la generación desde donde
   *  se quedó en vez de siempre desde hoy). */
  protected readonly mesInicioGenerar = signal('');
  protected readonly anioInicioGenerar = signal(new Date().getFullYear());
  protected readonly generandoFuturos = signal(false);

  protected readonly modalAbierto = signal(false);
  protected readonly enEdicion = signal<MovimientoRecurrentePresupuesto | null>(null);
  protected readonly aEliminar = signal<MovimientoRecurrentePresupuesto | null>(null);

  protected readonly columnas: ColumnaTabla<MovimientoRecurrentePresupuesto>[] = [
    { campo: 'descripcion', etiqueta: 'Descripción' },
    { campo: 'tipo', etiqueta: 'Tipo', claseValor: (fila) => (fila.tipo === 'Ingreso' ? 'grid-badge-success' : 'grid-badge-danger') },
    { campo: 'monto', etiqueta: 'Monto', formatear: (fila) => this.formatMoneda(fila.monto) },
    {
      campo: 'frecuencia',
      etiqueta: 'Frecuencia',
      formatear: (fila) => `${fila.frecuencia} · día ${fila.diaDelMes}${fila.frecuencia === 'Anual' ? ' de ' + this.nombreMesAncla(fila) : ''}`,
    },
    {
      campo: 'diaDelMes',
      etiqueta: 'Ciclo actual',
      formatear: (fila) => this.etiquetaEstadoCiclo(fila),
      claseValor: (fila) => this.claseEstadoCiclo(fila),
    },
  ];

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    descripcion: ['', Validators.required],
    tipo: ['Gasto' as string, Validators.required],
    cuentaPresupuestoId: [0, Validators.required],
    categoriaPresupuestoId: [0],
    monto: [0, [Validators.required, Validators.min(0.01)]],
    frecuencia: ['Mensual' as string, Validators.required],
    diaDelMes: [1, [Validators.required, Validators.min(1), Validators.max(31)]],
  });

  private get usuarioActualId(): number {
    return this.auth.usuarioActual()?.id ?? 0;
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

  /** categoriasFiltradas agrupada en raíz + hijas para el combo buscable del
   *  formulario (mismo agrupado ya usado en Movimientos, para no listar
   *  padres e hijas todas iguales una tras otra ni repetir el padre como
   *  opción dentro de su propio grupo). */
  protected readonly opcionesCategoriaFormulario = computed(() => [
    { valor: 0, etiqueta: 'Sin categoría' },
    ...opcionesCategoriasBuscable(this.categoriasFiltradas()),
  ]);

  /** Opciones del combo buscable "Cuenta" del formulario. */
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

  ngOnInit(): void {
    // Usa el ancho "wide" del layout, igual que Proyección/Movimientos/
    // Dashboard (ver html[data-wide='grid'] en styles.scss).
    document.documentElement.setAttribute('data-wide', 'grid');
    this.data.list<CuentaPresupuesto>('CuentaPresupuesto').subscribe((c) => this.cuentas.set(c));
    this.data.list<CategoriaPresupuesto>('CategoriaPresupuesto').subscribe((c) => this.categorias.set(c));
    this.data.list<ValorLista>('ValorLista', { grupo: 'MovimientoPresupuestoTipo' }).subscribe((v) =>
      this.tiposMovimiento.set(
        v.filter((x) => x.grupo === 'MovimientoPresupuestoTipo').sort((a, b) => a.orden - b.orden),
      ),
    );
    this.data.list<ValorLista>('ValorLista', { grupo: 'MovimientoRecurrenteFrecuencia' }).subscribe((v) =>
      this.frecuencias.set(
        v.filter((x) => x.grupo === 'MovimientoRecurrenteFrecuencia').sort((a, b) => a.orden - b.orden),
      ),
    );
    this.data.list<PresupuestoAnual>('PresupuestoAnual').subscribe((p) => this.presupuestosAnuales.set(p));
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.data
      .list<MovimientoRecurrentePresupuesto>('MovimientoRecurrentePresupuesto', { creadoPorUsuarioId: this.usuarioActualId })
      .subscribe({
        next: (r) => {
          this.recurrentes.set(r);
          this.cargando.set(false);
          this.data
            .list<MovimientoPresupuesto>('MovimientoPresupuesto', { creadoPorUsuarioId: this.usuarioActualId })
            .subscribe((movimientos) => {
              this.movimientosOrigen.set(movimientos.filter((m) => m.origenRecurrenteId !== null));
              this.avisarPendientes();
            });
        },
        error: () => this.cargando.set(false),
      });
  }

  formatMoneda(valor: number): string {
    return '$' + valor.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /** Mes (nombre corto) que ancla el ciclo de un fijo Anual: el mes en que se creó. */
  private mesAncla(fila: MovimientoRecurrentePresupuesto): number {
    return fila.fechaCreacion ? new Date(fila.fechaCreacion).getMonth() : new Date().getMonth();
  }

  protected nombreMesAncla(fila: MovimientoRecurrentePresupuesto): string {
    return new Date(2000, this.mesAncla(fila), 1).toLocaleDateString('es-MX', { month: 'long' });
  }

  /** 'Anual' es la única frecuencia con ciclo propio (una vez al año, anclada
   *  al mes de creación) — cualquier otra frecuencia (Mensual, Quincenal, o
   *  cualquier clave nueva que el usuario dé de alta en el catálogo "Frecuencia
   *  de fijos") se trata con cadencia mensual: un ciclo por mes calendario,
   *  registrable el día indicado (clampado al último día de cada mes en
   *  registrarCiclo). Antes solo 'Mensual' entraba por esta rama y cualquier
   *  frecuencia nueva caía silenciosamente en la rama Anual (un fijo Quincenal,
   *  por ejemplo, terminaba contando una sola vez al año en vez de cada mes). */
  private cicloActual(fila: MovimientoRecurrentePresupuesto): string {
    const hoy = new Date();
    return fila.frecuencia === 'Anual' ? `${hoy.getFullYear()}` : `${hoy.getFullYear()}-${hoy.getMonth() + 1}`;
  }

  private cicloDeFecha(fecha: string, frecuencia: string): string {
    const f = fechaLocalDeTexto(fecha);
    return frecuencia === 'Anual' ? `${f.getFullYear()}` : `${f.getFullYear()}-${f.getMonth() + 1}`;
  }

  /** Solo cuenta como "registrado" un movimiento REAL de este ciclo — uno
   *  proyectado (generado por adelantado con "Generar futuros" y aún sin
   *  confirmar) no cuenta, porque todavía no ocurrió. */
  protected estaRegistradoEsteCiclo(fila: MovimientoRecurrentePresupuesto): boolean {
    const ciclo = this.cicloActual(fila);
    return this.movimientosOrigen().some(
      (m) =>
        Number(m.origenRecurrenteId) === Number(fila.id) && !m.proyectado && this.cicloDeFecha(m.fecha, fila.frecuencia) === ciclo,
    );
  }

  /** El movimiento proyectado (si existe) de un ciclo dado de este fijo — para
   *  "confirmarlo" en vez de duplicarlo cuando ese ciclo por fin ocurre. */
  private movimientoProyectadoDelCiclo(fila: MovimientoRecurrentePresupuesto, ciclo: string): MovimientoPresupuesto | undefined {
    return this.movimientosOrigen().find(
      (m) => Number(m.origenRecurrenteId) === Number(fila.id) && !!m.proyectado && this.cicloDeFecha(m.fecha, fila.frecuencia) === ciclo,
    );
  }

  protected tieneProyectadoEsteCiclo(fila: MovimientoRecurrentePresupuesto): boolean {
    return !!this.movimientoProyectadoDelCiclo(fila, this.cicloActual(fila));
  }

  protected estadoCiclo(fila: MovimientoRecurrentePresupuesto): 'registrado' | 'proyectado' | 'pendiente' | 'proximo' {
    if (this.estaRegistradoEsteCiclo(fila)) return 'registrado';
    if (this.tieneProyectadoEsteCiclo(fila)) return 'proyectado';
    const hoy = new Date();
    if (fila.frecuencia === 'Anual' && hoy.getMonth() !== this.mesAncla(fila)) return 'proximo';
    return hoy.getDate() >= fila.diaDelMes ? 'pendiente' : 'proximo';
  }

  /** Texto largo para el aviso "Ciclo actual" dentro del modal de edición. */
  protected etiquetaCicloActual(fila: MovimientoRecurrentePresupuesto): string {
    switch (this.estadoCiclo(fila)) {
      case 'registrado':
        return '✓ ya registrado';
      case 'proyectado':
        return '🔮 generado como proyección — aún no confirmado';
      case 'pendiente':
        return '⚠ pendiente de registrar';
      default:
        return '· próximo';
    }
  }

  private etiquetaEstadoCiclo(fila: MovimientoRecurrentePresupuesto): string {
    switch (this.estadoCiclo(fila)) {
      case 'registrado':
        return '✓ Registrado';
      case 'proyectado':
        return '🔮 Proyectado';
      case 'pendiente':
        return '⚠ Pendiente';
      default:
        return '· Próximo';
    }
  }

  private claseEstadoCiclo(fila: MovimientoRecurrentePresupuesto): string {
    switch (this.estadoCiclo(fila)) {
      case 'registrado':
        return 'grid-badge-success';
      case 'proyectado':
        return 'grid-badge-neutral';
      case 'pendiente':
        return 'grid-badge-warning';
      default:
        return 'grid-badge-muted';
    }
  }

  /** Avisa (una sola vez por ciclo) los fijos que quedaron pendientes, y guarda el ciclo avisado. */
  private avisarPendientes(): void {
    for (const fila of this.recurrentes()) {
      if (this.estadoCiclo(fila) !== 'pendiente') continue;
      const ciclo = this.cicloActual(fila);
      if (fila.avisoFaltanteCiclo === ciclo) continue;
      this.toast.advertencia(`Fijo sin registrar este ciclo: "${fila.descripcion}".`);
      this.data.modificacion<MovimientoRecurrentePresupuesto>('MovimientoRecurrentePresupuesto', { ...fila, avisoFaltanteCiclo: ciclo }).subscribe({
        next: (actualizado) => {
          this.recurrentes.update((lista) => lista.map((r) => (r.id === actualizado.id ? actualizado : r)));
        },
      });
    }
  }

  /** Genera el MovimientoPresupuesto de este ciclo a partir del fijo (botón "Registrar este ciclo").
   *  Si el ciclo ya tiene un movimiento PROYECTADO (generado por adelantado con
   *  "Generar futuros"), lo confirma (proyectado: false) en vez de crear uno
   *  nuevo — así no se duplica el que ya se había adelantado. */
  registrarCiclo(fila: MovimientoRecurrentePresupuesto): void {
    if (this.estaRegistradoEsteCiclo(fila)) {
      this.toast.info('Este ciclo ya fue registrado.');
      return;
    }

    const ciclo = this.cicloActual(fila);
    const proyectado = this.movimientoProyectadoDelCiclo(fila, ciclo);
    if (proyectado) {
      this.data.modificacion<MovimientoPresupuesto>('MovimientoPresupuesto', { ...proyectado, proyectado: false }).subscribe({
        next: () => {
          this.toast.exito('Movimiento confirmado para este ciclo.');
          this.cargar();
        },
      });
      return;
    }

    const hoy = new Date();
    const ultimoDiaMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
    const fecha = new Date(hoy.getFullYear(), hoy.getMonth(), Math.min(fila.diaDelMes, ultimoDiaMes)).toISOString().slice(0, 10);
    const payload = {
      fecha,
      tipo: fila.tipo,
      cuentaPresupuestoId: Number(fila.cuentaPresupuestoId),
      categoriaPresupuestoId: fila.categoriaPresupuestoId ? Number(fila.categoriaPresupuestoId) : null,
      monto: fila.monto,
      descripcion: fila.descripcion,
      transferenciaId: null,
      origenRecurrenteId: fila.id,
      proyectado: false,
      creadoPorUsuarioId: this.usuarioActualId,
    };
    this.data.alta<MovimientoPresupuesto>('MovimientoPresupuesto', payload).subscribe({
      next: () => {
        this.toast.exito('Movimiento registrado para este ciclo.');
        this.cargar();
      },
    });
  }

  /** Fecha (clampada al último día de ese mes/año) del ciclo que cae N pasos
   *  adelante de hoy: N meses adelante si no es Anual, N años adelante si lo
   *  es (anclado al mes de creación del fijo) — mismo criterio que
   *  proximaFechaMensual/proximaFechaAnual del Calendario, solo que aquí se
   *  necesita la lista completa de ciclos futuros, no solo el próximo. */
  private fechaDelCiclo(fila: MovimientoRecurrentePresupuesto, pasos: number, hoy: Date): { fecha: string; ciclo: string } {
    if (fila.frecuencia === 'Anual') {
      const mesAncla = this.mesAncla(fila);
      const anio = hoy.getFullYear() + pasos;
      const ultimoDia = new Date(anio, mesAncla + 1, 0).getDate();
      const dia = Math.min(fila.diaDelMes, ultimoDia);
      return { fecha: textoFechaDeLocal(anio, mesAncla, dia), ciclo: `${anio}` };
    }
    const base = new Date(hoy.getFullYear(), hoy.getMonth() + pasos, 1);
    const ultimoDia = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    const dia = Math.min(fila.diaDelMes, ultimoDia);
    return { fecha: textoFechaDeLocal(base.getFullYear(), base.getMonth(), dia), ciclo: `${base.getFullYear()}-${base.getMonth() + 1}` };
  }

  /** Etiqueta legible de un ciclo — "Octubre de 2026" para fijos normales,
   *  o el año a secas ("2027") para los Anuales (su ciclo ya es un año). */
  private etiquetaCiclo(ciclo: string, frecuencia: string): string {
    if (frecuencia === 'Anual') return ciclo;
    const [anioTexto, mesTexto] = ciclo.split('-');
    const anio = Number(anioTexto);
    const mes = Number(mesTexto) - 1;
    const texto = new Date(anio, mes, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  /** Punto de partida para "Generar futuros" — el mes/año que el usuario
   *  eligió en "Desde" (por defecto el actual, ver resetearDesdeGenerar). */
  private baseGenerar(fila: MovimientoRecurrentePresupuesto): Date {
    if (fila.frecuencia === 'Anual') {
      const anio = this.anioInicioGenerar() || new Date().getFullYear();
      return new Date(anio, this.mesAncla(fila), 1);
    }
    const texto = this.mesInicioGenerar();
    if (!texto) return new Date();
    const [anioTexto, mesTexto] = texto.split('-');
    const anio = Number(anioTexto);
    const mes = Number(mesTexto) - 1;
    if (!Number.isFinite(anio) || !Number.isFinite(mes)) return new Date();
    return new Date(anio, mes, 1);
  }

  /** Reinicia "Desde" al mes/año actual — se llama al abrir el modal (nuevo
   *  o editar) para que cada fijo arranque mostrando "hoy" salvo que el
   *  usuario lo cambie a mano. */
  private resetearDesdeGenerar(): void {
    const hoy = new Date();
    const anios = this.aniosPresupuesto();
    const trabajo = this.anioTrabajo.seleccionado();
    // Si ya hay un "año de trabajo" elegido (compartido con Movimientos y
    // Proyección) y sigue registrado en el catálogo, "Desde" arranca ahí en
    // vez de en el año calendario actual — así las 3 pantallas quedan
    // alineadas al mismo año sin tener que volver a elegirlo aquí.
    const anioBase = trabajo !== 'todos' && anios.includes(trabajo) ? trabajo : hoy.getFullYear();
    this.mesInicioGenerar.set(`${anioBase}-${String(hoy.getMonth() + 1).padStart(2, '0')}`);
    // Si "Presupuesto por año" ya tiene años registrados y anioBase no es
    // uno de ellos, el <select> de "Desde" (ver html) no tendría dónde
    // caer — se ajusta al más cercano disponible (el primero igual o
    // posterior a anioBase, o el último si todos quedaron en el pasado).
    if (anios.length === 0) {
      this.anioInicioGenerar.set(anioBase);
      return;
    }
    if (anios.includes(anioBase)) {
      this.anioInicioGenerar.set(anioBase);
      return;
    }
    const siguiente = anios.find((a) => a >= anioBase);
    this.anioInicioGenerar.set(siguiente ?? anios[anios.length - 1]);
  }

  /** Texto para el modal: a qué meses/años (y de cuál a cuál) aplicará
   *  "Generar futuros" con el número de ciclos y el "Desde" actualmente
   *  escritos — así no hay que adivinar qué cubre un número a secas como "6". */
  protected readonly rangoAGenerar = computed<string>(() => {
    const fila = this.enEdicion();
    if (!fila) return '';
    // computed() debe leer las señales de "Desde" para recalcular cuando cambian
    this.mesInicioGenerar();
    this.anioInicioGenerar();
    const n = Math.max(1, Math.min(60, Math.trunc(this.nCiclosAGenerar()) || 1));
    const base = this.baseGenerar(fila);
    const primero = this.fechaDelCiclo(fila, 0, base);
    const etiquetaPrimero = this.etiquetaCiclo(primero.ciclo, fila.frecuencia);
    if (n === 1) return fila.frecuencia === 'Anual' ? `año ${etiquetaPrimero}` : etiquetaPrimero;
    const ultimo = this.fechaDelCiclo(fila, n - 1, base);
    const etiquetaUltimo = this.etiquetaCiclo(ultimo.ciclo, fila.frecuencia);
    return fila.frecuencia === 'Anual' ? `años ${etiquetaPrimero} a ${etiquetaUltimo}` : `de ${etiquetaPrimero} a ${etiquetaUltimo}`;
  });

  /** "Generar futuros": crea de una vez los MovimientoPresupuesto de los
   *  próximos N ciclos (empezando por el actual si aún no está registrado),
   *  con la fecha de cada ciclo ya clampada al último día de su mes/año —
   *  así un fijo con día 31, por ejemplo, no truena en febrero ni en ningún
   *  mes de 30 días: simplemente cae en el último día disponible de ese mes.
   *  Salta cualquier ciclo que ya tenga su movimiento (no duplica). */
  generarFuturos(fila: MovimientoRecurrentePresupuesto): void {
    const n = Math.max(1, Math.min(60, Math.trunc(this.nCiclosAGenerar()) || 1));
    const hoy = this.baseGenerar(fila);

    const ciclosYaRegistrados = new Set(
      this.movimientosOrigen()
        .filter((m) => Number(m.origenRecurrenteId) === Number(fila.id))
        .map((m) => this.cicloDeFecha(m.fecha, fila.frecuencia)),
    );

    const pendientes: { fecha: string; ciclo: string }[] = [];
    for (let pasos = 0; pasos < n; pasos++) {
      const candidato = this.fechaDelCiclo(fila, pasos, hoy);
      if (!ciclosYaRegistrados.has(candidato.ciclo)) pendientes.push(candidato);
    }

    if (pendientes.length === 0) {
      this.toast.info('Esos ciclos ya estaban generados.');
      return;
    }

    this.generandoFuturos.set(true);
    this.generarSiguientePendiente(fila, pendientes, 0);
  }

  /** Alta secuencial de uno por uno — el DataClientService no tiene alta en
   *  lote, así que se encadenan en vez de disparar N peticiones a la vez. */
  private generarSiguientePendiente(
    fila: MovimientoRecurrentePresupuesto,
    pendientes: { fecha: string; ciclo: string }[],
    indice: number,
  ): void {
    if (indice >= pendientes.length) {
      this.generandoFuturos.set(false);
      this.toast.exito(`${pendientes.length} movimiento(s) futuro(s) generado(s).`);
      this.cargar();
      return;
    }
    const payload = {
      fecha: pendientes[indice].fecha,
      tipo: fila.tipo,
      cuentaPresupuestoId: Number(fila.cuentaPresupuestoId),
      categoriaPresupuestoId: fila.categoriaPresupuestoId ? Number(fila.categoriaPresupuestoId) : null,
      monto: fila.monto,
      descripcion: fila.descripcion,
      transferenciaId: null,
      origenRecurrenteId: fila.id,
      // Es una proyección a futuro, no un movimiento real todavía: no debe
      // contar en saldo/ingresos/gastos/reportes hasta que se confirme
      // (con "↻ Registrar ciclo" cuando ese ciclo sí llegue, o editándolo).
      proyectado: true,
      creadoPorUsuarioId: this.usuarioActualId,
    };
    this.data.alta<MovimientoPresupuesto>('MovimientoPresupuesto', payload).subscribe({
      next: () => this.generarSiguientePendiente(fila, pendientes, indice + 1),
      error: () => {
        this.generandoFuturos.set(false);
        this.toast.error(`Se generaron ${indice} de ${pendientes.length}; ocurrió un error y se detuvo.`);
        this.cargar();
      },
    });
  }

  nuevo(): void {
    this.enEdicion.set(null);
    this.form.reset({ id: 0, descripcion: '', tipo: 'Gasto', cuentaPresupuestoId: 0, categoriaPresupuestoId: 0, monto: 0, frecuencia: 'Mensual', diaDelMes: 1 });
    this.resetearDesdeGenerar();
    this.modalAbierto.set(true);
  }

  editar(item: MovimientoRecurrentePresupuesto): void {
    this.enEdicion.set(item);
    this.resetearDesdeGenerar();
    this.form.reset({
      id: item.id,
      descripcion: item.descripcion,
      tipo: item.tipo,
      cuentaPresupuestoId: Number(item.cuentaPresupuestoId),
      categoriaPresupuestoId: item.categoriaPresupuestoId ? Number(item.categoriaPresupuestoId) : 0,
      monto: item.monto,
      frecuencia: item.frecuencia,
      diaDelMes: item.diaDelMes,
    });
    this.modalAbierto.set(true);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const valor = this.form.getRawValue();
    const esEdicion = this.enEdicion() !== null;
    const payload = {
      ...valor,
      cuentaPresupuestoId: Number(valor.cuentaPresupuestoId),
      categoriaPresupuestoId: valor.categoriaPresupuestoId ? Number(valor.categoriaPresupuestoId) : null,
      creadoPorUsuarioId: this.usuarioActualId,
      avisoFaltanteCiclo: this.enEdicion()?.avisoFaltanteCiclo ?? null,
    };
    const peticion = esEdicion
      ? this.data.modificacion<MovimientoRecurrentePresupuesto>('MovimientoRecurrentePresupuesto', payload)
      : this.data.alta<MovimientoRecurrentePresupuesto>('MovimientoRecurrentePresupuesto', payload);
    peticion.subscribe({
      next: (resultado) => {
        this.toast.exito(esEdicion ? 'Fijo actualizado.' : 'Fijo creado.');
        this.enEdicion.set(resultado);
        this.cargar();
        if (!esEdicion) this.modalAbierto.set(false);
      },
    });
  }

  pedirEliminar(item: MovimientoRecurrentePresupuesto): void {
    this.aEliminar.set(item);
  }

  confirmarEliminar(): void {
    const item = this.aEliminar();
    if (!item) return;
    this.data.baja('MovimientoRecurrentePresupuesto', item.id).subscribe({
      next: () => {
        this.toast.exito('Fijo eliminado.');
        this.aEliminar.set(null);
        if (this.enEdicion()?.id === item.id) this.modalAbierto.set(false);
        this.cargar();
      },
    });
  }

  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }
}

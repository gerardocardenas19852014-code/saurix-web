import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { forkJoin } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { DataClientService } from '../../../core/services/data-client.service';
import { ToastService } from '../../../shared/services/toast.service';
import { CategoriaPresupuesto } from '../../catalogos/categoria-presupuesto/categoria-presupuesto.model';
import { CuentaPresupuesto } from '../../catalogos/cuenta-presupuesto/cuenta-presupuesto.model';
import { MovimientoPresupuesto } from '../movimientos/movimiento.model';
import { MovimientoRecurrentePresupuesto } from '../recurrentes/recurrente.model';
import { formatMoneda } from '../shared/wallet.util';
import { ProyeccionAjuste } from './proyeccion-ajuste.model';

/** Una quincena (1-15 / 16-fin de mes) de la ventana de proyección. */
interface Quincena {
  anio: number;
  mes: number; // 0-indexado
  mitad: 1 | 2;
  clave: string; // "<año>-<mes>-<mitad>"
}

interface Celda {
  valor: number;
  manual: boolean;
  editable: boolean;
}

/** Un renglón de la tabla — resumen, título de sección, grupo (categoría con
 *  subcategorías, solo etiqueta), hoja (renglón editable) o subtotal/total. */
interface RenglonProyeccion {
  id: string;
  tipo: 'resumen' | 'seccion-titulo' | 'grupo' | 'hoja' | 'subtotal' | 'total';
  clave: string | null;
  nombre: string;
  celdas: Celda[];
  /** false solo para Saldo inicial/Saldo final proyectado: son un saldo en
   *  un punto del tiempo, sumarlos entre quincenas no tiene sentido. */
  sumable: boolean;
}

interface RaizFila {
  clave: string;
  nombre: string;
  hijos: { clave: string; nombre: string }[];
}

/**
 * "Proyección": vista tipo hoja de cálculo del flujo de efectivo a futuro,
 * en quincenas (1-15 / 16-fin de mes), inspirada en el Excel personal del
 * usuario. Cada celda se calcula sola a partir de Fijos y Proyección +
 * Movimientos (reales y ya proyectados), pero se puede sobreescribir a mano
 * — el valor manual queda guardado en ProyeccionAjuste y tiene prioridad
 * sobre el automático hasta que se borra (dejando la celda vacía).
 *
 * Para las quincenas que un fijo aún no tiene generadas como movimiento
 * (real o proyectado, vía "Generar futuros" en Fijos y Proyección), esta
 * pantalla las extrapola sola a partir de la definición del fijo — así la
 * proyección llega a las 24 quincenas sin depender de que cada fijo se
 * haya generado a mano hasta ahí.
 */
@Component({
  selector: 'app-proyeccion',
  standalone: true,
  templateUrl: './proyeccion.component.html',
  styleUrl: './proyeccion.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProyeccionComponent implements OnInit, OnDestroy {
  private readonly data = inject(DataClientService);
  private readonly auth = inject(AuthService);
  protected readonly toast = inject(ToastService);

  protected readonly formatMoneda = formatMoneda;

  protected readonly cargando = signal(false);
  protected readonly categorias = signal<CategoriaPresupuesto[]>([]);
  protected readonly cuentas = signal<CuentaPresupuesto[]>([]);
  protected readonly movimientos = signal<MovimientoPresupuesto[]>([]);
  protected readonly recurrentes = signal<MovimientoRecurrentePresupuesto[]>([]);
  protected readonly ajustes = signal<ProyeccionAjuste[]>([]);

  protected readonly editando = signal<{ clave: string; quincenaClave: string } | null>(null);
  protected readonly valorEditando = signal('');

  private get usuarioActualId(): number {
    return this.auth.usuarioActual()?.id ?? 0;
  }

  ngOnInit(): void {
    // Tabla con muchas columnas (24 quincenas); usa el ancho "wide" del
    // layout para aprovechar el espacio en vez del ancho angosto por
    // defecto (ver html[data-wide='grid'] en styles.scss, mismo patrón que
    // usuarios-list.component.ts).
    document.documentElement.setAttribute('data-wide', 'grid');
    this.cargar();
  }

  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  cargar(): void {
    this.cargando.set(true);
    forkJoin({
      categorias: this.data.list<CategoriaPresupuesto>('CategoriaPresupuesto'),
      cuentas: this.data.list<CuentaPresupuesto>('CuentaPresupuesto'),
      movimientos: this.data.list<MovimientoPresupuesto>('MovimientoPresupuesto', { creadoPorUsuarioId: this.usuarioActualId }),
      recurrentes: this.data.list<MovimientoRecurrentePresupuesto>('MovimientoRecurrentePresupuesto', {
        creadoPorUsuarioId: this.usuarioActualId,
      }),
      ajustes: this.data.list<ProyeccionAjuste>('ProyeccionAjuste', { creadoPorUsuarioId: this.usuarioActualId }),
    }).subscribe({
      next: ({ categorias, cuentas, movimientos, recurrentes, ajustes }) => {
        this.categorias.set(categorias);
        this.cuentas.set(cuentas);
        this.movimientos.set(movimientos);
        this.recurrentes.set(recurrentes);
        this.ajustes.set(ajustes);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  // ---------------------------------------------------------------------
  // Quincenas de la ventana mostrada (24 = 1 año, empezando en la quincena
  // de hoy).
  // ---------------------------------------------------------------------

  protected readonly quincenas = computed<Quincena[]>(() => {
    const hoy = new Date();
    const resultado: Quincena[] = [];
    let anio = hoy.getFullYear();
    let mes = hoy.getMonth();
    let mitad: 1 | 2 = hoy.getDate() <= 15 ? 1 : 2;
    for (let i = 0; i < 24; i++) {
      resultado.push({ anio, mes, mitad, clave: `${anio}-${mes}-${mitad}` });
      if (mitad === 1) {
        mitad = 2;
      } else {
        mitad = 1;
        mes++;
        if (mes > 11) {
          mes = 0;
          anio++;
        }
      }
    }
    return resultado;
  });

  /** "todos" = las 24 quincenas de la ventana; un año = solo sus quincenas
   *  dentro de esa ventana (la ventana sigue siendo la misma de 24 hacia
   *  adelante desde hoy — un año puede verse incompleto si cae en la punta). */
  protected readonly filtroAnio = signal<'todos' | number>('todos');

  protected readonly aniosDisponibles = computed<number[]>(() => {
    const anios = new Set(this.quincenas().map((q) => q.anio));
    return [...anios].sort((a, b) => a - b);
  });

  /** Quincenas a pintar como columnas, ya filtradas por año — cada una trae
   *  el índice que le corresponde dentro de `quincenas()`/`celdas`, porque el
   *  cálculo (saldo en cadena, etc.) siempre corre sobre las 24 completas. */
  protected readonly quincenasVisibles = computed<{ q: Quincena; indice: number }[]>(() => {
    const anio = this.filtroAnio();
    return this.quincenas()
      .map((q, indice) => ({ q, indice }))
      .filter(({ q }) => anio === 'todos' || q.anio === anio);
  });

  /** Encabezado superior: una banda por mes, con el colspan de cuántas
   *  quincenas VISIBLES de ese mes hay. */
  protected readonly bandasMes = computed<{ etiqueta: string; colspan: number }[]>(() => {
    const bandas: { etiqueta: string; colspan: number }[] = [];
    for (const { q } of this.quincenasVisibles()) {
      const texto = new Date(q.anio, q.mes, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
      const etiqueta = texto.charAt(0).toUpperCase() + texto.slice(1);
      const anterior = bandas[bandas.length - 1];
      if (anterior && anterior.etiqueta === etiqueta) anterior.colspan++;
      else bandas.push({ etiqueta, colspan: 1 });
    }
    return bandas;
  });

  /** Suma de un renglón a lo largo de las quincenas actualmente visibles
   *  (respeta el filtro de año) — la columna "Total" de la tabla. */
  protected totalFila(celdas: Celda[]): number {
    return this.quincenasVisibles().reduce((s, { indice }) => s + (celdas[indice]?.valor ?? 0), 0);
  }

  // ---------------------------------------------------------------------
  // Categorías/cuentas que arman los renglones de cada sección.
  // ---------------------------------------------------------------------

  private categoriasDeTipo(tipo: 'Ingreso' | 'Gasto'): CategoriaPresupuesto[] {
    return this.categorias().filter((c) => !c.tipo || c.tipo === tipo);
  }

  private raicesDeCategorias(tipo: 'Ingreso' | 'Gasto', prefijo: 'ing' | 'gas'): RaizFila[] {
    const categorias = this.categoriasDeTipo(tipo);
    return categorias
      .filter((c) => c.categoriaPresupuestoPadreId === null)
      .map((raiz) => ({
        clave: `${prefijo}:${raiz.id}`,
        nombre: raiz.nombre,
        hijos: categorias
          .filter((c) => c.categoriaPresupuestoPadreId === Number(raiz.id))
          .map((h) => ({ clave: `${prefijo}:${h.id}`, nombre: h.nombre }))
          .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es-MX')),
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es-MX'));
  }

  private raicesDeCuentasAhorro(): RaizFila[] {
    return this.cuentas()
      .filter((c) => c.tipo === 'Ahorro')
      .map((c) => ({ clave: `aho:${c.id}`, nombre: c.nombre, hijos: [] as { clave: string; nombre: string }[] }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es-MX'));
  }

  // ---------------------------------------------------------------------
  // Motor de cálculo automático: Movimientos (reales + ya proyectados) y,
  // para las quincenas que un fijo todavía no tiene generadas, su propia
  // extrapolación a partir de la definición del fijo.
  // ---------------------------------------------------------------------

  private quincenaDeFecha(fecha: string): string {
    const [anioTexto, mesTexto, diaTexto] = fecha.split('-');
    const anio = Number(anioTexto);
    const mes = Number(mesTexto) - 1;
    const dia = Number(diaTexto);
    return `${anio}-${mes}-${dia <= 15 ? 1 : 2}`;
  }

  private mesAnclaFijo(fila: MovimientoRecurrentePresupuesto): number {
    return fila.fechaCreacion ? new Date(fila.fechaCreacion).getMonth() : new Date().getMonth();
  }

  /** ¿Este fijo tiene un ciclo dentro de esta quincena específica? (mismo
   *  clamp de día-al-último-día-del-mes que usa Fijos y Proyección). */
  private fijoFiraEnQuincena(fila: MovimientoRecurrentePresupuesto, q: Quincena): boolean {
    if (fila.frecuencia === 'Anual' && q.mes !== this.mesAnclaFijo(fila)) return false;
    const ultimoDia = new Date(q.anio, q.mes + 1, 0).getDate();
    const dia = Math.min(fila.diaDelMes, ultimoDia);
    const diaInicio = q.mitad === 1 ? 1 : 16;
    const diaFin = q.mitad === 1 ? 15 : ultimoDia;
    return dia >= diaInicio && dia <= diaFin;
  }

  /** Mapa clave → (quincenaClave → monto), calculado una sola vez a partir
   *  de movimientos + fijos extrapolados (sin contar dos veces un ciclo que
   *  ya tiene su movimiento real/proyectado). */
  private readonly valoresAuto = computed(() => {
    const mapa = new Map<string, Map<string, number>>();
    const sumar = (clave: string, quincenaClave: string, monto: number) => {
      let porQuincena = mapa.get(clave);
      if (!porQuincena) {
        porQuincena = new Map<string, number>();
        mapa.set(clave, porQuincena);
      }
      porQuincena.set(quincenaClave, (porQuincena.get(quincenaClave) ?? 0) + monto);
    };

    const quincenasVentana = new Set(this.quincenas().map((q) => q.clave));
    const cuentasAhorroIds = new Set(this.cuentas().filter((c) => c.tipo === 'Ahorro').map((c) => Number(c.id)));
    const cubiertoPorMovimiento = new Set<string>(); // `${origenRecurrenteId}:${quincenaClave}`

    for (const m of this.movimientos()) {
      const quincenaClave = this.quincenaDeFecha(m.fecha);
      if (!quincenasVentana.has(quincenaClave)) continue;
      if (!m.transferenciaId && m.categoriaPresupuestoId) {
        if (m.tipo === 'Ingreso') sumar(`ing:${m.categoriaPresupuestoId}`, quincenaClave, m.monto);
        else if (m.tipo === 'Gasto') sumar(`gas:${m.categoriaPresupuestoId}`, quincenaClave, m.monto);
      }
      if (cuentasAhorroIds.has(Number(m.cuentaPresupuestoId))) {
        sumar(`aho:${m.cuentaPresupuestoId}`, quincenaClave, m.tipo === 'Ingreso' ? m.monto : -m.monto);
      }
      if (m.origenRecurrenteId != null) cubiertoPorMovimiento.add(`${m.origenRecurrenteId}:${quincenaClave}`);
    }

    for (const fila of this.recurrentes()) {
      if (fila.activo === false) continue;
      for (const q of this.quincenas()) {
        if (cubiertoPorMovimiento.has(`${fila.id}:${q.clave}`)) continue;
        if (!this.fijoFiraEnQuincena(fila, q)) continue;
        if (fila.categoriaPresupuestoId) {
          if (fila.tipo === 'Ingreso') sumar(`ing:${fila.categoriaPresupuestoId}`, q.clave, fila.monto);
          else if (fila.tipo === 'Gasto') sumar(`gas:${fila.categoriaPresupuestoId}`, q.clave, fila.monto);
        }
        if (cuentasAhorroIds.has(Number(fila.cuentaPresupuestoId))) {
          sumar(`aho:${fila.cuentaPresupuestoId}`, q.clave, fila.tipo === 'Ingreso' ? fila.monto : -fila.monto);
        }
      }
    }

    return mapa;
  });

  protected readonly ajustesPorClave = computed(() => {
    const mapa = new Map<string, number>();
    for (const a of this.ajustes()) mapa.set(`${a.clave}|${a.quincena}`, a.monto);
    return mapa;
  });

  private celda(clave: string, quincenaClave: string, editable = true): Celda {
    const ajuste = this.ajustesPorClave().get(`${clave}|${quincenaClave}`);
    if (ajuste !== undefined) return { valor: ajuste, manual: true, editable };
    return { valor: this.valoresAuto().get(clave)?.get(quincenaClave) ?? 0, manual: false, editable };
  }

  /** Saldo real (hoy) de todas las cuentas, sin proyectar nada — punto de
   *  partida de la primera quincena mostrada (igual que saldoTotal del
   *  Dashboard). */
  private saldoActualReal(): number {
    return this.movimientos()
      .filter((m) => !m.proyectado)
      .reduce((s, m) => s + (m.tipo === 'Ingreso' ? m.monto : -m.monto), 0);
  }

  // ---------------------------------------------------------------------
  // Construcción de las secciones (renglones ya resueltos para pintar).
  // ---------------------------------------------------------------------

  private construirSeccion(idSeccion: string, titulo: string, raices: RaizFila[]): RenglonProyeccion[] {
    const quincenas = this.quincenas();
    const renglones: RenglonProyeccion[] = [
      { id: `sec:${idSeccion}`, tipo: 'seccion-titulo', clave: null, nombre: titulo, celdas: [], sumable: false },
    ];
    const totalSeccion = quincenas.map(() => 0);

    for (const raiz of raices) {
      if (raiz.hijos.length === 0) {
        const celdas = quincenas.map((q) => this.celda(raiz.clave, q.clave));
        celdas.forEach((c, i) => (totalSeccion[i] += c.valor));
        renglones.push({ id: `hoja:${raiz.clave}`, tipo: 'hoja', clave: raiz.clave, nombre: raiz.nombre, celdas, sumable: true });
        continue;
      }
      renglones.push({ id: `grupo:${raiz.clave}`, tipo: 'grupo', clave: null, nombre: raiz.nombre, celdas: [], sumable: false });
      const subtotal = quincenas.map(() => 0);
      for (const hijo of raiz.hijos) {
        const celdas = quincenas.map((q) => this.celda(hijo.clave, q.clave));
        celdas.forEach((c, i) => (subtotal[i] += c.valor));
        renglones.push({ id: `hoja:${hijo.clave}`, tipo: 'hoja', clave: hijo.clave, nombre: hijo.nombre, celdas, sumable: true });
      }
      subtotal.forEach((v, i) => (totalSeccion[i] += v));
      renglones.push({
        id: `subtotal:${raiz.clave}`,
        tipo: 'subtotal',
        clave: null,
        nombre: `Subtotal ${raiz.nombre}`,
        celdas: subtotal.map((valor) => ({ valor, manual: false, editable: false })),
        sumable: true,
      });
    }

    renglones.push({
      id: `total:${idSeccion}`,
      tipo: 'total',
      clave: null,
      nombre: `TOTAL ${titulo}`,
      celdas: totalSeccion.map((valor) => ({ valor, manual: false, editable: false })),
      sumable: true,
    });
    return renglones;
  }

  private readonly renglonesIngreso = computed(() =>
    this.construirSeccion('ingreso', 'INGRESO', this.raicesDeCategorias('Ingreso', 'ing')),
  );
  private readonly renglonesGasto = computed(() =>
    this.construirSeccion('gasto', 'GASTOS', this.raicesDeCategorias('Gasto', 'gas')),
  );
  private readonly renglonesAhorro = computed(() =>
    this.construirSeccion('ahorro', 'AHORROS', this.raicesDeCuentasAhorro()),
  );

  private readonly resumen = computed<RenglonProyeccion[]>(() => {
    const quincenas = this.quincenas();
    const totalIngreso = this.renglonesIngreso().find((r) => r.tipo === 'total')!.celdas;
    const totalGasto = this.renglonesGasto().find((r) => r.tipo === 'total')!.celdas;
    const totalAhorro = this.renglonesAhorro().find((r) => r.tipo === 'total')!.celdas;

    const saldoInicial: Celda[] = [];
    const neto: Celda[] = [];
    const saldoFinal: Celda[] = [];
    let saldoPrevio = 0;

    for (let i = 0; i < quincenas.length; i++) {
      const netoValor = totalIngreso[i].valor - totalGasto[i].valor;
      neto.push({ valor: netoValor, manual: false, editable: false });

      let inicial: Celda;
      if (i === 0) {
        inicial = this.celda('saldoInicial', quincenas[0].clave, true);
        if (!inicial.manual) inicial = { valor: this.saldoActualReal(), manual: false, editable: true };
      } else {
        inicial = { valor: saldoPrevio, manual: false, editable: false };
      }
      saldoInicial.push(inicial);
      saldoPrevio = inicial.valor + netoValor;
      saldoFinal.push({ valor: saldoPrevio, manual: false, editable: false });
    }

    return [
      {
        id: 'resumen:saldoInicial',
        tipo: 'resumen',
        clave: 'saldoInicial',
        nombre: 'Saldo inicial',
        celdas: saldoInicial,
        sumable: false,
      },
      { id: 'resumen:totalIngreso', tipo: 'resumen', clave: null, nombre: 'Total ingresos', celdas: totalIngreso, sumable: true },
      { id: 'resumen:totalGasto', tipo: 'resumen', clave: null, nombre: 'Total gastos', celdas: totalGasto, sumable: true },
      { id: 'resumen:neto', tipo: 'resumen', clave: null, nombre: 'Ingreso neto', celdas: neto, sumable: true },
      { id: 'resumen:ahorro', tipo: 'resumen', clave: null, nombre: 'Ahorro', celdas: totalAhorro, sumable: true },
      {
        id: 'resumen:saldoFinal',
        tipo: 'resumen',
        clave: null,
        nombre: 'Saldo final proyectado',
        celdas: saldoFinal,
        sumable: false,
      },
    ];
  });

  /** Todos los renglones de la tabla, en el orden en que se pintan. */
  protected readonly filasTabla = computed<RenglonProyeccion[]>(() => [
    ...this.resumen(),
    ...this.renglonesIngreso(),
    ...this.renglonesGasto(),
    ...this.renglonesAhorro(),
  ]);

  // ---------------------------------------------------------------------
  // Edición manual de una celda.
  // ---------------------------------------------------------------------

  protected estaEditando(clave: string | null, quincenaClave: string): boolean {
    const actual = this.editando();
    return !!clave && !!actual && actual.clave === clave && actual.quincenaClave === quincenaClave;
  }

  protected iniciarEdicion(clave: string | null, quincenaClave: string, valorActual: number): void {
    if (!clave) return;
    this.editando.set({ clave, quincenaClave });
    this.valorEditando.set(valorActual === 0 ? '' : String(Math.round(valorActual * 100) / 100));
  }

  protected cancelarEdicion(): void {
    this.editando.set(null);
  }

  protected confirmarEdicion(): void {
    const objetivo = this.editando();
    if (!objetivo) return;
    const texto = this.valorEditando().trim();
    this.editando.set(null);
    if (texto === '') {
      this.quitarAjuste(objetivo.clave, objetivo.quincenaClave);
      return;
    }
    const monto = Number(texto);
    if (!Number.isFinite(monto)) {
      this.toast.error('Ese valor no es un número válido.');
      return;
    }
    this.guardarAjuste(objetivo.clave, objetivo.quincenaClave, monto);
  }

  private guardarAjuste(clave: string, quincenaClave: string, monto: number): void {
    const existente = this.ajustes().find((a) => a.clave === clave && a.quincena === quincenaClave);
    const payload = { clave, quincena: quincenaClave, monto, creadoPorUsuarioId: this.usuarioActualId };
    const peticion = existente
      ? this.data.modificacion<ProyeccionAjuste>('ProyeccionAjuste', { ...existente, ...payload })
      : this.data.alta<ProyeccionAjuste>('ProyeccionAjuste', payload);
    peticion.subscribe({
      next: (resultado) => {
        this.ajustes.update((lista) => [...lista.filter((a) => a.id !== resultado.id), resultado]);
      },
    });
  }

  private quitarAjuste(clave: string, quincenaClave: string): void {
    const existente = this.ajustes().find((a) => a.clave === clave && a.quincena === quincenaClave);
    if (!existente) return;
    this.data.baja('ProyeccionAjuste', existente.id).subscribe({
      next: () => {
        this.ajustes.update((lista) => lista.filter((a) => a.id !== existente.id));
      },
    });
  }
}

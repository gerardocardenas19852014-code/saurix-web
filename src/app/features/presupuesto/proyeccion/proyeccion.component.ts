import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { forkJoin } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { DataClientService } from '../../../core/services/data-client.service';
import { ToastService } from '../../../shared/services/toast.service';
import { CategoriaPresupuesto } from '../categoria-presupuesto/categoria-presupuesto.model';
import { CuentaPresupuesto } from '../cuenta-presupuesto/cuenta-presupuesto.model';
import { MovimientoPresupuesto } from '../movimientos/movimiento.model';
import { MovimientoRecurrentePresupuesto } from '../recurrentes/recurrente.model';
import { formatMoneda, formatMonedaCompacta, textoFechaDeLocal } from '../shared/wallet.util';
import { AnioTrabajoService } from '../shared/anio-trabajo.service';
import { PresupuestoAnual } from '../presupuesto-anual/presupuesto-anual.model';
import { ProyeccionAjuste } from './proyeccion-ajuste.model';
import { ColumnaCsv, exportarCsv } from '../../../shared/utils/csv.util';

/** Meses ANTES de hoy que también se muestran en la ventana (contexto
 *  histórico — además de los 12 meses hacia adelante que ya existían), para
 *  poder comparar cómo quedó realmente un mes pasado contra lo proyectado
 *  entonces. Cada mes son 2 quincenas. */
const MESES_ATRAS = 3;
const MESES_ADELANTE = 12;
const TOTAL_QUINCENAS = (MESES_ATRAS + MESES_ADELANTE) * 2;

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
  /** Solo en el renglón de comparación con el año anterior: true cuando
   *  no hay NINGÚN movimiento real en esa quincena de hace un año — se
   *  distingue de un $0 real (si de verdad no gastó nada) para no dar a
   *  entender que "el año pasado no gastaste nada" cuando en realidad
   *  todavía no existía el registro. */
  sinDatos?: boolean;
}

/** Un renglón de la tabla — resumen, título de sección, grupo (categoría con
 *  subcategorías, solo etiqueta), hoja (renglón editable) o subtotal/total. */
interface RenglonProyeccion {
  id: string;
  tipo: 'resumen' | 'seccion-titulo' | 'grupo' | 'hoja' | 'detalle' | 'subtotal' | 'total';
  clave: string | null;
  nombre: string;
  celdas: Celda[];
  /** false solo para Saldo inicial/Saldo final proyectado: son un saldo en
   *  un punto del tiempo, sumarlos entre quincenas no tiene sentido. */
  sumable: boolean;
  /** Solo en las hojas/detalles que cuelgan de un renglón 'grupo': la clave
   *  de ese grupo (misma que su `clave` de toggle), para poder ocultarlas
   *  cuando el usuario lo colapsa. null en todo lo demás (siempre visible). */
  grupoId: string | null;
  /** Solo en los renglones 'detalle' (desglose por cuenta): la clave de SU
   *  PROPIA hoja (categoría) — un segundo nivel de colapsar/expandir,
   *  independiente de `grupoId` (que es del grupo ANCESTRO, si lo hay). Así
   *  "SALARIO" se puede contraer aunque no cuelgue de ningún grupo. */
  hojaId?: string | null;
  /** Solo en los renglones 'hoja': true cuando junta más de una cuenta (por
   *  eso tiene renglones 'detalle' debajo) — controla si se le pinta la
   *  flechita de contraer/expandir en la plantilla. */
  tieneDetalle?: boolean;
  /** A qué sección pertenece (Ingreso/Gasto/Ahorro/Resumen) — solo para
   *  pintar un tinte de fondo sutil por sección y ayudar a no perderse
   *  al leer la tabla; no afecta ningún cálculo. */
  seccion?: 'resumen' | 'ingreso' | 'gasto' | 'ahorro';
  /** Solo en los 2 renglones de referencia "(año anterior)" que se
   *  agregan al resumen cuando se activa "Comparar con el año anterior"
   *  — para poder darles un estilo distinto (más discreto) sin tener que
   *  adivinarlo por el nombre. */
  esComparacion?: boolean;
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
  protected readonly formatMonedaCompacta = formatMonedaCompacta;

  protected readonly cargando = signal(false);
  protected readonly categorias = signal<CategoriaPresupuesto[]>([]);
  protected readonly cuentas = signal<CuentaPresupuesto[]>([]);
  protected readonly movimientos = signal<MovimientoPresupuesto[]>([]);
  protected readonly recurrentes = signal<MovimientoRecurrentePresupuesto[]>([]);
  protected readonly ajustes = signal<ProyeccionAjuste[]>([]);
  protected readonly presupuestosAnuales = signal<PresupuestoAnual[]>([]);

  protected readonly editando = signal<{ clave: string; quincenaClave: string } | null>(null);
  protected readonly valorEditando = signal('');

  /** El <input> de la celda que se está editando ahora mismo (si hay una) —
   *  se usa para enfocarlo apenas aparece: sin esto, ni el primer clic para
   *  editar una celda ni la navegación con flechas servirían de nada (lo
   *  que se teclee no llegaría a ningún lado). */
  private readonly inputEditando = viewChild<ElementRef<HTMLInputElement>>('inputEditando');

  /** El contenedor con scroll horizontal de la tabla — para "Ir a hoy"
   *  (regresar de un salto a la quincena actual sin tener que arrastrar
   *  la barra de scroll a mano). */
  private readonly scrollContenedor = viewChild<ElementRef<HTMLDivElement>>('scrollContenedor');

  private readonly _enfocarAlEditar = effect(() => {
    const editandoAhora = this.editando();
    const el = this.inputEditando()?.nativeElement;
    if (editandoAhora && el) {
      el.focus();
      el.select();
    }
  });

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
      presupuestosAnuales: this.data.list<PresupuestoAnual>('PresupuestoAnual'),
    }).subscribe({
      next: ({ categorias, cuentas, movimientos, recurrentes, ajustes, presupuestosAnuales }) => {
        this.categorias.set(categorias);
        this.cuentas.set(cuentas);
        this.movimientos.set(movimientos);
        this.recurrentes.set(recurrentes);
        this.presupuestosAnuales.set(presupuestosAnuales);
        this.ajustes.set(ajustes);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  // ---------------------------------------------------------------------
  // Quincenas de la ventana mostrada: MESES_ATRAS meses de contexto
  // histórico (arrancando el día 1 de ese mes) + MESES_ADELANTE meses hacia
  // el futuro desde hoy — antes la ventana arrancaba siempre EN hoy, sin
  // nada anterior (no se podía "jalar" más a la izquierda); ver
  // indiceHoy() para ubicar la columna de hoy dentro de este arreglo más
  // ancho.
  // ---------------------------------------------------------------------

  protected readonly quincenas = computed<Quincena[]>(() => {
    const hoy = new Date();
    const resultado: Quincena[] = [];
    let anio = hoy.getFullYear();
    let mes = hoy.getMonth() - MESES_ATRAS;
    while (mes < 0) {
      mes += 12;
      anio--;
    }
    let mitad: 1 | 2 = 1;
    for (let i = 0; i < TOTAL_QUINCENAS; i++) {
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

  /** Índice (dentro de `quincenas()`) de la quincena de HOY — ya no es
   *  siempre 0 ahora que la ventana incluye meses anteriores (ver
   *  MESES_ATRAS). Se usa para resaltar esa columna y para que "Ir a hoy"
   *  sepa a dónde desplazarse. */
  protected readonly indiceHoy = computed<number>(() => {
    const hoy = new Date();
    const mitadHoy: 1 | 2 = hoy.getDate() <= 15 ? 1 : 2;
    const claveHoy = `${hoy.getFullYear()}-${hoy.getMonth()}-${mitadHoy}`;
    const indice = this.quincenas().findIndex((q) => q.clave === claveHoy);
    return indice === -1 ? 0 : indice;
  });

  /** "todos" = las 24 quincenas de la ventana; un año = solo sus quincenas
   *  dentro de esa ventana (la ventana sigue siendo la misma de 24 hacia
   *  adelante desde hoy — un año puede verse incompleto si cae en la punta). */
  protected readonly anioTrabajo = inject(AnioTrabajoService);

  /** Año de trabajo COMPARTIDO con Movimientos y con Fijos y Proyección —
   *  no es un filtro propio de esta pantalla: es la misma selección en las
   *  3 (ver AnioTrabajoService). Ya no existe "Todos": si todavía no hay
   *  nada elegido, se propone un año real apenas se conoce el catálogo
   *  (ver el effect de más abajo). */
  protected readonly filtroAnio = this.anioTrabajo.seleccionado;

  /** Solo los años dados de alta en Catálogos → "Presupuesto por año" —
   *  antes salían de la ventana de 24 quincenas (podía ofrecer un año que
   *  ni siquiera se ha "creado" todavía). Con "Todos" la tabla sigue
   *  mostrando la ventana completa igual que antes; lo que cambia es que
   *  ya no se puede aislar un año suelto hasta registrarlo ahí. */
  protected readonly aniosDisponibles = computed<number[]>(() => {
    const anios = new Set(this.presupuestosAnuales().map((p) => Number(p.anio)));
    return [...anios].sort((a, b) => a - b);
  });

  /** Ya no hay opción "Todos" en el selector de Año — apenas se conocen
   *  los años registrados, se propone uno real si aún no hay ninguno
   *  elegido (ver AnioTrabajoService.asegurarSeleccion). */
  private readonly _asegurarAnioTrabajo = effect(() => this.anioTrabajo.asegurarSeleccion(this.aniosDisponibles()));

  /** "Ver meses anteriores" (checkbox) — oculta/muestra las quincenas de
   *  antes de hoy (ver MESES_ATRAS) sin dejar de calcularlas: el Saldo
   *  inicial/final sigue encadenando sobre la ventana completa
   *  (quincenas()), esto solo decide cuáles de esas columnas se pintan.
   *  Arranca en true (mostrarlas) — recién agregadas, tiene sentido que se
   *  vean por default; igual que "Comparar con el año anterior", no se
   *  recuerda entre sesiones (ver ese otro checkbox, mismo patrón). */
  protected readonly mostrarMesesAnteriores = signal(true);

  /** Quincenas a pintar como columnas, ya filtradas por año y por
   *  "Ver meses anteriores" — cada una trae el índice que le corresponde
   *  dentro de `quincenas()`/`celdas`, porque el cálculo (saldo en cadena,
   *  etc.) siempre corre sobre la ventana completa. */
  protected readonly quincenasVisibles = computed<{ q: Quincena; indice: number }[]>(() => {
    const anio = this.filtroAnio();
    const ocultarAnteriores = !this.mostrarMesesAnteriores();
    const indiceHoy = this.indiceHoy();
    return this.quincenas()
      .map((q, indice) => ({ q, indice }))
      .filter(({ q, indice }) => (anio === 'todos' || q.anio === anio) && (!ocultarAnteriores || indice >= indiceHoy));
  });

  /** Índice de color cíclico por mes (6 tonos, dan la vuelta y se
   *  repiten) — dos meses consecutivos siempre caen en colores distintos.
   *  Ayuda visual para ubicarse en qué mes se está al desplazarse por las
   *  24 quincenas ("agregar visualmente que pueda ver como que mes
   *  estoy moviendo"), inspirado en las bandas de color por mes del Excel
   *  original del usuario. */
  protected colorMes(anio: number, mes: number): number {
    return (anio * 12 + mes) % 6;
  }

  /** Encabezado superior: una banda por mes, con el colspan de cuántas
   *  quincenas VISIBLES de ese mes hay. */
  protected readonly bandasMes = computed<{ etiqueta: string; colspan: number; colorIndex: number }[]>(() => {
    const bandas: { etiqueta: string; colspan: number; colorIndex: number }[] = [];
    for (const { q } of this.quincenasVisibles()) {
      const texto = new Date(q.anio, q.mes, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
      const etiqueta = texto.charAt(0).toUpperCase() + texto.slice(1);
      const anterior = bandas[bandas.length - 1];
      if (anterior && anterior.etiqueta === etiqueta) anterior.colspan++;
      else bandas.push({ etiqueta, colspan: 1, colorIndex: this.colorMes(q.anio, q.mes) });
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

  /** Mapa clave → (quincenaClave → monto), calculado SOLO a partir de
   *  movimientos ya existentes (reales o generados por adelantado con
   *  "Generar futuros" en Fijos y Proyección) — NO extrapola en vivo la
   *  regla de un Fijo para una quincena que todavía no tiene su movimiento
   *  generado ahí (antes sí lo hacía; se quitó porque predecía dinero en
   *  quincenas sin nada capturado, incluso antes de que el Fijo existiera).
   *  Una quincena sin movimiento para una categoría se ve en $0 hasta que
   *  se corra "Generar futuros" o se capture algo a mano. También arma,
   *  por cada clave de categoría (ing:X / gas:X), el desglose por cuenta
   *  (clave::cta:Y) y qué cuentas la componen — para poder mostrar "de qué
   *  cuentas sale" cuando una categoría junta movimientos de más de una
   *  cuenta. */
  private readonly valoresAuto = computed(() => {
    const mapa = new Map<string, Map<string, number>>();
    const cuentasPorClave = new Map<string, Set<number>>();
    const sumar = (clave: string, quincenaClave: string, monto: number) => {
      let porQuincena = mapa.get(clave);
      if (!porQuincena) {
        porQuincena = new Map<string, number>();
        mapa.set(clave, porQuincena);
      }
      porQuincena.set(quincenaClave, (porQuincena.get(quincenaClave) ?? 0) + monto);
    };
    const sumarPorCategoria = (
      prefijo: 'ing' | 'gas',
      categoriaId: number,
      cuentaId: number | null | undefined,
      quincenaClave: string,
      monto: number,
    ) => {
      const clave = `${prefijo}:${categoriaId}`;
      sumar(clave, quincenaClave, monto);
      const cuenta = Number(cuentaId ?? 0);
      sumar(`${clave}::cta:${cuenta}`, quincenaClave, monto);
      let cuentasClave = cuentasPorClave.get(clave);
      if (!cuentasClave) {
        cuentasClave = new Set<number>();
        cuentasPorClave.set(clave, cuentasClave);
      }
      cuentasClave.add(cuenta);
    };

    const quincenasVentana = new Set(this.quincenas().map((q) => q.clave));
    const cuentasAhorroIds = new Set(this.cuentas().filter((c) => c.tipo === 'Ahorro').map((c) => Number(c.id)));

    for (const m of this.movimientos()) {
      const quincenaClave = this.quincenaDeFecha(m.fecha);
      if (!quincenasVentana.has(quincenaClave)) continue;
      if (!m.transferenciaId && m.categoriaPresupuestoId) {
        if (m.tipo === 'Ingreso') sumarPorCategoria('ing', m.categoriaPresupuestoId, m.cuentaPresupuestoId, quincenaClave, m.monto);
        else if (m.tipo === 'Gasto') sumarPorCategoria('gas', m.categoriaPresupuestoId, m.cuentaPresupuestoId, quincenaClave, m.monto);
      }
      if (cuentasAhorroIds.has(Number(m.cuentaPresupuestoId))) {
        sumar(`aho:${m.cuentaPresupuestoId}`, quincenaClave, m.tipo === 'Ingreso' ? m.monto : -m.monto);
      }
    }

    return { mapa, cuentasPorClave };
  });

  protected readonly ajustesPorClave = computed(() => {
    const mapa = new Map<string, number>();
    for (const a of this.ajustes()) mapa.set(`${a.clave}|${a.quincena}`, a.monto);
    return mapa;
  });

  /** Años cuyo "Presupuesto por año" (Catálogos) ya está Autorizado o
   *  Ejecutado — sus celdas en esta pantalla dejan de poder editarse a
   *  mano (ver quincenaBloqueada/celda). Un año sin registro en ese
   *  catálogo se trata como libre (no bloqueado). */
  private readonly aniosBloqueados = computed(() => {
    const claves = new Set(['Autorizado', 'Ejecutado']);
    return new Set(this.presupuestosAnuales().filter((p) => claves.has(p.estatusClave)).map((p) => Number(p.anio)));
  });

  protected quincenaBloqueada(quincenaClave: string): boolean {
    const anio = Number(quincenaClave.split('-')[0]);
    return this.aniosBloqueados().has(anio);
  }

  private celda(clave: string, quincenaClave: string, editable = true): Celda {
    const editableFinal = editable && !this.quincenaBloqueada(quincenaClave);
    const ajuste = this.ajustesPorClave().get(`${clave}|${quincenaClave}`);
    if (ajuste !== undefined) return { valor: ajuste, manual: true, editable: editableFinal };
    return { valor: this.valoresAuto().mapa.get(clave)?.get(quincenaClave) ?? 0, manual: false, editable: editableFinal };
  }

  /** Cuentas (≥2) que componen una categoría de Ingreso/Gasto — para
   *  desglosarla en sub-renglones de solo lectura, uno por cuenta. Si solo
   *  usa una cuenta (o ninguna), regresa vacío y la categoría se muestra
   *  como un solo renglón, igual que antes. */
  private cuentasDeCategoria(clave: string): { id: number; nombre: string }[] {
    const ids = this.valoresAuto().cuentasPorClave.get(clave);
    if (!ids || ids.size < 2) return [];
    const nombresPorId = new Map(this.cuentas().map((c) => [Number(c.id), c.nombre]));
    return [...ids]
      .map((id) => ({ id, nombre: id === 0 ? 'Sin cuenta' : (nombresPorId.get(id) ?? `Cuenta #${id}`) }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es-MX'));
  }

  /** Si una categoría solo ha usado UNA cuenta hasta ahora, se agrega el
   *  nombre de esa cuenta a la etiqueta del renglón (p.ej. "SALARIO ·
   *  Banorte") — antes solo se avisaba de qué cuentas se compone cuando
   *  eran 2 o más (sub-renglones); con una sola no se veía en ningún lado
   *  cuál era. Con 0 o "Sin cuenta" no se agrega nada (no aporta info). */
  private nombreConCuentaUnica(clave: string, nombre: string): string {
    const ids = this.valoresAuto().cuentasPorClave.get(clave);
    if (!ids || ids.size !== 1) return nombre;
    const id = [...ids][0];
    if (id === 0) return nombre;
    const cuenta = this.cuentas().find((c) => Number(c.id) === id);
    return cuenta ? `${nombre} · ${cuenta.nombre}` : nombre;
  }

  /** Renglón(es) de una categoría hoja: el renglón normal y, si junta más
   *  de una cuenta, un sub-renglón informativo por cuenta debajo — así se
   *  ve de dónde sale sin duplicar el total.
   *
   *  El renglón de la categoría solo es editable a mano cuando NO tiene
   *  desglose (una sola cuenta o ninguna): en cuanto junta 2+ cuentas es
   *  pura sumatoria de sus propios sub-renglones (igual que un Subtotal o
   *  un Total), así que se le ignora cualquier ajuste manual que pudiera
   *  tener guardado de antes — de lo contrario el número de arriba dejaría
   *  de cuadrar con la suma de las cuentas de abajo. */
  private filasHoja(clave: string, nombre: string, grupoId: string | null = null): RenglonProyeccion[] {
    const quincenas = this.quincenas();
    const cuentas = this.cuentasDeCategoria(clave);
    const tieneDetalle = cuentas.length > 0;
    const celdas = tieneDetalle
      ? quincenas.map((q) => ({ valor: this.valoresAuto().mapa.get(clave)?.get(q.clave) ?? 0, manual: false, editable: false }))
      : quincenas.map((q) => this.celda(clave, q.clave));
    const nombreFinal = this.nombreConCuentaUnica(clave, nombre);
    const filas: RenglonProyeccion[] = [
      { id: `hoja:${clave}`, tipo: 'hoja', clave, nombre: nombreFinal, celdas, sumable: true, grupoId, tieneDetalle },
    ];

    for (const cuenta of cuentas) {
      const claveCuenta = `${clave}::cta:${cuenta.id}`;
      const celdasCuenta = quincenas.map((q) => ({
        valor: this.valoresAuto().mapa.get(claveCuenta)?.get(q.clave) ?? 0,
        manual: false,
        editable: false,
      }));
      filas.push({
        id: `detalle:${claveCuenta}`,
        tipo: 'detalle',
        clave: null,
        nombre: cuenta.nombre,
        celdas: celdasCuenta,
        sumable: true,
        grupoId,
        hojaId: clave,
      });
    }

    return filas;
  }

  /** Saldo real de todas las cuentas justo ANTES del inicio de la ventana
   *  mostrada — punto de partida de la primera quincena. Antes la ventana
   *  siempre arrancaba HOY y este cálculo era simplemente "el saldo de
   *  todos los movimientos reales" (igual que saldoTotal del Dashboard);
   *  ahora que la ventana puede empezar unos meses antes de hoy (ver
   *  MESES_ATRAS), hay que cortar la suma en la fecha de esa primera
   *  quincena para no arrastrar también los movimientos reales que ya
   *  pertenecen a quincenas visibles más adelante en la propia tabla (esos
   *  los suma la cadena de Saldo inicial/Saldo final quincena por
   *  quincena, no este punto de partida). */
  private saldoRealAlInicioDeVentana(): number {
    const primera = this.quincenas()[0];
    if (!primera) return 0;
    const dia = primera.mitad === 1 ? 1 : 16;
    const fechaInicio = `${primera.anio}-${String(primera.mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    return this.movimientos()
      .filter((m) => !m.proyectado && m.fecha < fechaInicio)
      .reduce((s, m) => s + (m.tipo === 'Ingreso' ? m.monto : -m.monto), 0);
  }

  // ---------------------------------------------------------------------
  // Construcción de las secciones (renglones ya resueltos para pintar).
  // ---------------------------------------------------------------------

  private construirSeccion(idSeccion: string, titulo: string, raices: RaizFila[]): RenglonProyeccion[] {
    const quincenas = this.quincenas();
    // El título de sección (INGRESO/GASTOS/AHORROS) también es colapsable
    // ahora: usa su propia idSeccion ('ingreso'/'gasto'/'ahorro') como llave
    // de toggle (mismo Set gruposColapsados de siempre) — al contraerlo se
    // ocultan todos los grupos/hojas/detalles/subtotales de la sección (ver
    // filasTabla), dejando visibles solo el título y el TOTAL de la
    // sección, igual que un grupo colapsado deja ver su Subtotal.
    const renglones: RenglonProyeccion[] = [
      { id: `sec:${idSeccion}`, tipo: 'seccion-titulo', clave: idSeccion, nombre: titulo, celdas: [], sumable: false, grupoId: null },
    ];
    const totalSeccion = quincenas.map(() => 0);

    for (const raiz of raices) {
      if (raiz.hijos.length === 0) {
        const filas = this.filasHoja(raiz.clave, raiz.nombre);
        filas[0].celdas.forEach((c, i) => (totalSeccion[i] += c.valor));
        renglones.push(...filas);
        continue;
      }
      // clave del renglón 'grupo' = la clave de la propia categoría raíz —
      // se reutiliza como llave de colapsar/expandir (toggleGrupo), ya que
      // un renglón 'grupo' nunca tiene celdas editables que la necesiten.
      renglones.push({ id: `grupo:${raiz.clave}`, tipo: 'grupo', clave: raiz.clave, nombre: raiz.nombre, celdas: [], sumable: false, grupoId: null });
      const subtotal = quincenas.map(() => 0);
      for (const hijo of raiz.hijos) {
        const filas = this.filasHoja(hijo.clave, hijo.nombre, raiz.clave);
        filas[0].celdas.forEach((c, i) => (subtotal[i] += c.valor));
        renglones.push(...filas);
      }
      subtotal.forEach((v, i) => (totalSeccion[i] += v));
      renglones.push({
        id: `subtotal:${raiz.clave}`,
        tipo: 'subtotal',
        clave: null,
        nombre: `Subtotal ${raiz.nombre}`,
        celdas: subtotal.map((valor) => ({ valor, manual: false, editable: false })),
        sumable: true,
        grupoId: null,
      });
    }

    renglones.push({
      id: `total:${idSeccion}`,
      tipo: 'total',
      clave: null,
      nombre: `TOTAL ${titulo}`,
      celdas: totalSeccion.map((valor) => ({ valor, manual: false, editable: false })),
      sumable: true,
      grupoId: null,
    });
    renglones.forEach((r) => (r.seccion = idSeccion as 'ingreso' | 'gasto' | 'ahorro'));
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
    const saldoFinal: Celda[] = [];
    let saldoPrevio = 0;

    for (let i = 0; i < quincenas.length; i++) {
      // Ingreso neto ya no se muestra como renglón aparte, pero se sigue
      // calculando: el saldo final proyectado depende de él.
      const netoValor = totalIngreso[i].valor - totalGasto[i].valor;

      let inicial: Celda;
      if (i === 0) {
        inicial = this.celda('saldoInicial', quincenas[0].clave, true);
        if (!inicial.manual) inicial = { valor: this.saldoRealAlInicioDeVentana(), manual: false, editable: true };
      } else {
        // Antes esta rama nunca llamaba a celda(): el Saldo inicial de la
        // quincena 2 en adelante quedaba SIEMPRE fijo al Saldo final de la
        // quincena anterior, sin poder ajustarlo a mano (a diferencia de
        // cualquier otro renglón de la tabla). Ahora se sigue el mismo
        // patrón que la quincena 0: si hay un ajuste manual guardado para
        // esta quincena se respeta, y si no, se sigue encadenando el saldo
        // previo mientras se deja editable (mismo "clic para escribir un
        // valor a mano" que ya tienen categorías/cuentas).
        inicial = this.celda('saldoInicial', quincenas[i].clave, true);
        if (!inicial.manual) inicial = { valor: saldoPrevio, manual: false, editable: true };
      }
      saldoInicial.push(inicial);
      saldoPrevio = inicial.valor + netoValor;
      saldoFinal.push({ valor: saldoPrevio, manual: false, editable: false });
    }

    // "Saldo inicial" hace de renglón-cabecera colapsable de todo el bloque
    // resumen (mismo patrón que una hoja con >1 cuenta, ej. SALARIO): se
    // reutiliza su propia clave ('saldoInicial') como llave de toggle, y los
    // demás renglones del bloque cuelgan de ella vía hojaId — así el usuario
    // puede contraer Total ingresos/Total gastos/Ahorro/Saldo final para
    // ganar espacio vertical sin perder de vista el saldo inicial.
    const comparacion = this.compararAnioAnterior() ? this.comparacionAnioAnterior() : null;

    const filas: RenglonProyeccion[] = [
      {
        id: 'resumen:saldoInicial',
        tipo: 'resumen',
        clave: 'saldoInicial',
        nombre: 'Saldo inicial',
        celdas: saldoInicial,
        sumable: false,
        grupoId: null,
        tieneDetalle: true,
      },
      {
        id: 'resumen:totalIngreso',
        tipo: 'resumen',
        clave: null,
        nombre: 'Total ingresos',
        celdas: totalIngreso,
        sumable: true,
        grupoId: null,
        hojaId: 'saldoInicial',
      },
      ...(comparacion
        ? [
            {
              id: 'resumen:totalIngresoAnioAnterior',
              tipo: 'resumen' as const,
              clave: null,
              nombre: 'Total ingresos (año anterior)',
              celdas: comparacion.map((c) => ({ valor: c.ingreso, manual: false, editable: false, sinDatos: !c.hayDatos })),
              sumable: true,
              grupoId: null,
              hojaId: 'saldoInicial',
              esComparacion: true,
            },
          ]
        : []),
      {
        id: 'resumen:totalGasto',
        tipo: 'resumen',
        clave: null,
        nombre: 'Total gastos',
        celdas: totalGasto,
        sumable: true,
        grupoId: null,
        hojaId: 'saldoInicial',
      },
      ...(comparacion
        ? [
            {
              id: 'resumen:totalGastoAnioAnterior',
              tipo: 'resumen' as const,
              clave: null,
              nombre: 'Total gastos (año anterior)',
              celdas: comparacion.map((c) => ({ valor: c.gasto, manual: false, editable: false, sinDatos: !c.hayDatos })),
              sumable: true,
              grupoId: null,
              hojaId: 'saldoInicial',
              esComparacion: true,
            },
          ]
        : []),
      {
        id: 'resumen:ahorro',
        tipo: 'resumen',
        clave: null,
        nombre: 'Ahorro',
        celdas: totalAhorro,
        sumable: true,
        grupoId: null,
        hojaId: 'saldoInicial',
      },
      {
        id: 'resumen:saldoFinal',
        tipo: 'resumen',
        clave: null,
        nombre: 'Saldo final proyectado',
        celdas: saldoFinal,
        sumable: false,
        grupoId: null,
        hojaId: 'saldoInicial',
      },
    ];
    filas.forEach((r) => (r.seccion = 'resumen'));
    return filas;
  });

  /** Para cada quincena de la ventana visible, el total real de
   *  ingresos/gastos de la MISMA quincena (1-15/16-fin) pero un año
   *  antes — NO es una proyección: son movimientos reales ya capturados
   *  (si los hay). `hayDatos` distingue "de verdad gastó $0 esa
   *  quincena" de "todavía no existía ningún registro esa fecha", para
   *  no confundir al usuario con puros ceros de una época sin captura. */
  protected readonly comparacionAnioAnterior = computed(() => {
    const quincenas = this.quincenas();
    const totales = new Map<string, { ingreso: number; gasto: number }>();
    for (const m of this.movimientos()) {
      if (m.transferenciaId || (m.tipo !== 'Ingreso' && m.tipo !== 'Gasto')) continue;
      const quincenaClave = this.quincenaDeFecha(m.fecha);
      const entrada = totales.get(quincenaClave) ?? { ingreso: 0, gasto: 0 };
      if (m.tipo === 'Ingreso') entrada.ingreso += m.monto;
      else entrada.gasto += m.monto;
      totales.set(quincenaClave, entrada);
    }
    return quincenas.map((q) => {
      const claveHaceUnAnio = `${q.anio - 1}-${q.mes}-${q.mitad}`;
      const entrada = totales.get(claveHaceUnAnio);
      return { ingreso: entrada?.ingreso ?? 0, gasto: entrada?.gasto ?? 0, hayDatos: !!entrada };
    });
  });

  // ---------------------------------------------------------------------
  // Colapsar/expandir grupos (categorías con subcategorías) para lectura.
  // ---------------------------------------------------------------------

  protected readonly gruposColapsados = signal<Set<string>>(new Set());

  /** Buscador por nombre de categoría/cuenta — solo oculta renglones hoja/
   *  detalle (las hojas y su desglose por cuenta); los títulos de sección,
   *  grupo, subtotal y total de cada bloque se mantienen visibles siempre
   *  para no romper la estructura ni los subtotales ya calculados. */
  protected readonly filtroTextoProyeccion = signal('');
  private gruposColapsadosInicializados = false;

  /** "Comparar con el año anterior": agrega 2 renglones de referencia
   *  (Total ingresos/Total gastos de la misma quincena, un año antes) al
   *  bloque de resumen — ver comparacionAnioAnterior(). */
  protected readonly compararAnioAnterior = signal(false);

  /** Mostrar/ocultar la lista desplegable de celdas con ajuste manual
   *  (ver celdasManuales()). */
  protected readonly mostrarManuales = signal(false);

  /** Pestaña activa: la tabla de quincenas o el gráfico de tendencia
   *  del saldo final proyectado (ver graficoSaldo()). */
  protected readonly vista = signal<'tabla' | 'grafica'>('tabla');

  /** La primera vez que ya se conocen los grupos (categorías con
   *  subcategorías, p.ej. CARRO/CREDITOS/HOGAR) y las hojas con desglose
   *  por cuenta (p.ej. SALARIO con Banorte/Afirme), arrancan TODOS
   *  contraídos — antes había que contraerlos uno por uno cada vez que se
   *  entraba a la pantalla; ahora se ven así desde el inicio y el usuario
   *  expande a mano solo los que quiera revisar. */
  /** Todas las claves de renglones colapsables que existen AHORA MISMO:
   *  grupos de categorías con subcategorías, hojas con desglose por
   *  cuenta, títulos de sección (INGRESO/GASTOS/AHORROS) y "Saldo
   *  inicial" — se reutiliza tanto para el colapsado por defecto de un
   *  usuario nuevo como para "Contraer todo". */
  private todasLasClavesColapsables(): string[] {
    const todas = [...this.resumen(), ...this.renglonesIngreso(), ...this.renglonesGasto(), ...this.renglonesAhorro()];
    return todas
      .filter(
        (r) =>
          (r.tipo === 'grupo' || r.tipo === 'seccion-titulo' || ((r.tipo === 'hoja' || r.tipo === 'resumen') && r.tieneDetalle)) &&
          r.clave,
      )
      .map((r) => r.clave as string);
  }

  /** Clave de localStorage donde se recuerda qué grupos dejó contraídos/
   *  expandidos este usuario la última vez — por usuario, para no mezclar
   *  la preferencia de "root" con la de otra cuenta en el mismo navegador. */
  private get claveStorageColapsados(): string {
    return `saurix.proyeccion.colapsados.${this.usuarioActualId}`;
  }

  private leerColapsadosGuardados(): Set<string> | null {
    try {
      const texto = localStorage.getItem(this.claveStorageColapsados);
      if (!texto) return null;
      const arreglo: unknown = JSON.parse(texto);
      if (!Array.isArray(arreglo)) return null;
      return new Set(arreglo.filter((v): v is string => typeof v === 'string'));
    } catch {
      // Modo privado, cuota llena, JSON corrupto, etc. — se ignora y se
      // cae de vuelta al colapsado por defecto, no es un error fatal.
      return null;
    }
  }

  private guardarColapsadosEnStorage(): void {
    try {
      localStorage.setItem(this.claveStorageColapsados, JSON.stringify([...this.gruposColapsados()]));
    } catch {
      // No es crítico: en el peor de los casos, simplemente no se
      // recuerda el estado la próxima vez que se entre a esta pantalla.
    }
  }

  /** La primera vez que ya se conoce la tabla completa (cargando() ===
   *  false), se restaura el colapsado que este usuario dejó guardado la
   *  última vez (localStorage) — o, si es la primera vez que entra aquí,
   *  arranca con TODO contraído (ver todasLasClavesColapsables). */
  private readonly _colapsarGruposPorDefecto = effect(() => {
    if (this.gruposColapsadosInicializados || this.cargando()) return;
    this.gruposColapsadosInicializados = true;
    const guardados = this.leerColapsadosGuardados();
    this.gruposColapsados.set(guardados ?? new Set(this.todasLasClavesColapsables()));
  });

  protected estaColapsado(clave: string | null): boolean {
    return !!clave && this.gruposColapsados().has(clave);
  }

  protected toggleGrupo(clave: string | null): void {
    if (!clave) return;
    this.gruposColapsados.update((actual) => {
      const nuevo = new Set(actual);
      if (nuevo.has(clave)) nuevo.delete(clave);
      else nuevo.add(clave);
      return nuevo;
    });
    this.guardarColapsadosEnStorage();
  }

  /** "Contraer todo"/"Expandir todo" — para no tener que darle clic
   *  renglón por renglón cuando se quiere lo opuesto al estado actual. */
  protected contraerTodo(): void {
    this.gruposColapsados.set(new Set(this.todasLasClavesColapsables()));
    this.guardarColapsadosEnStorage();
  }

  protected expandirTodo(): void {
    this.gruposColapsados.set(new Set());
    this.guardarColapsadosEnStorage();
  }

  /** Regresa el scroll horizontal de la tabla al principio (columna de
   *  "hoy") de un salto — solo tiene sentido mostrar el botón cuando esa
   *  columna sigue visible con el filtro de Año actual (ver el html). */
  /** Ancho de la columna fija de etiquetas (.proy-esquina/.proy-etiqueta en
   *  proyeccion.component.scss, min-width/max-width: 190px) — la columna de
   *  "hoy" (.proy-col-hoy) tiene su propio position:sticky con ese mismo
   *  "left: 190px" para quedarse pegada justo después de las etiquetas; acá
   *  se reutiliza el mismo número para saber a dónde scrollear. */
  private static readonly ANCHO_COLUMNA_ETIQUETA_PX = 190;

  protected irAHoy(): void {
    const contenedor = this.scrollContenedor()?.nativeElement;
    if (!contenedor) return;
    // La columna de hoy ya no es siempre la primera (puede haber meses
    // anteriores a la izquierda, ver MESES_ATRAS): se calcula cuánto le
    // falta para llegar a su posición "pegada" (sticky) de siempre, en vez
    // de asumir siempre left:0 como antes (cuando hoy SÍ era la primera).
    const columnaHoy = contenedor.querySelector<HTMLElement>('.proy-col-hoy');
    if (columnaHoy) {
      const distanciaActual = columnaHoy.getBoundingClientRect().left - contenedor.getBoundingClientRect().left;
      const faltante = distanciaActual - ProyeccionComponent.ANCHO_COLUMNA_ETIQUETA_PX;
      contenedor.scrollTo({ left: contenedor.scrollLeft + faltante, behavior: 'smooth' });
    } else {
      contenedor.scrollTo({ left: 0, behavior: 'smooth' });
    }
  }

  /** Todos los renglones de la tabla, en el orden en que se pintan — sin las
   *  hojas/detalles de los grupos que el usuario colapsó (el título del
   *  grupo y su Subtotal se quedan siempre visibles). */
  protected readonly filasTabla = computed<RenglonProyeccion[]>(() => {
    const todas = [...this.resumen(), ...this.renglonesIngreso(), ...this.renglonesGasto(), ...this.renglonesAhorro()];
    const colapsados = this.gruposColapsados();
    const texto = this.filtroTextoProyeccion().trim().toLowerCase();
    if (colapsados.size === 0 && !texto) return todas;

    // Buscar "hipoteca" no servía de nada si esa hoja vivía dentro de un
    // grupo contraído (el colapsado la ocultaba de todos modos, antes de
    // que el buscador tuviera oportunidad de mostrarla) — con texto de
    // búsqueda activo se ignora el colapsado manual por completo. Una hoja
    // también cuenta como match si el nombre no coincide pero sí el de
    // alguno de sus detalles (desglose por cuenta), para no dejarlo huérfano.
    const hojaConDetalleQueMatchea = new Set<string>();
    if (texto) {
      for (const r of todas) {
        if (r.tipo === 'detalle' && r.hojaId && r.nombre.toLowerCase().includes(texto)) {
          hojaConDetalleQueMatchea.add(r.hojaId);
        }
      }
    }

    return todas.filter((r) => {
      if (!texto) {
        if (r.grupoId && colapsados.has(r.grupoId)) return false;
        if (r.hojaId && colapsados.has(r.hojaId)) return false;
        // Sección (INGRESO/GASTOS/AHORROS) colapsada: oculta todo lo de
        // adentro (grupo/hoja/detalle/subtotal), pero deja ver el propio
        // título de sección y su TOTAL — igual que un grupo colapsado deja
        // ver su Subtotal.
        if (r.seccion && r.tipo !== 'seccion-titulo' && r.tipo !== 'total' && colapsados.has(r.seccion)) return false;
        return true;
      }
      if (r.tipo === 'hoja') {
        return r.nombre.toLowerCase().includes(texto) || (r.clave !== null && hojaConDetalleQueMatchea.has(r.clave));
      }
      if (r.tipo === 'detalle') {
        return r.nombre.toLowerCase().includes(texto);
      }
      return true; // resumen/seccion-titulo/grupo/subtotal/total: siempre visibles
    });
  });

  // ---------------------------------------------------------------------
  // Ayudas de lectura: celdas con ajuste manual, quincenas en rojo y la
  // tendencia del saldo final proyectado.
  // ---------------------------------------------------------------------

  /** Todas las celdas con un valor escrito a mano (ProyeccionAjuste, o el
   *  primer saldo inicial si se sobreescribió) dentro de la ventana de año
   *  visible — SIN filtrar por colapsado/búsqueda: el punto de esta lista
   *  es poder auditar los ajustes manuales aunque su renglón esté
   *  contraído en este momento. */
  protected readonly celdasManuales = computed(() => {
    const todas = [...this.resumen(), ...this.renglonesIngreso(), ...this.renglonesGasto(), ...this.renglonesAhorro()];
    const visibles = this.quincenasVisibles();
    const resultado: { id: string; renglon: string; quincenaEtiqueta: string; valor: number }[] = [];
    for (const r of todas) {
      if (r.celdas.length === 0) continue;
      for (const { q, indice } of visibles) {
        const celda = r.celdas[indice];
        if (celda?.manual) {
          resultado.push({ id: `${r.id}|${q.clave}`, renglon: r.nombre, quincenaEtiqueta: this.etiquetaQuincena(q), valor: celda.valor });
        }
      }
    }
    return resultado;
  });

  /** Quincenas visibles donde "Saldo final proyectado" queda en negativo
   *  — para el aviso arriba de la tabla; no reemplaza el color rojo que ya
   *  trae cada celda negativa, solo lo resume en una sola línea. */
  protected readonly quincenasSaldoNegativo = computed(() => {
    const saldoFinal = this.resumen().find((r) => r.id === 'resumen:saldoFinal');
    if (!saldoFinal) return [];
    const resultado: { etiqueta: string; valor: number }[] = [];
    for (const { q, indice } of this.quincenasVisibles()) {
      const celda = saldoFinal.celdas[indice];
      if (celda && celda.valor < 0) resultado.push({ etiqueta: this.etiquetaQuincena(q), valor: celda.valor });
    }
    return resultado;
  });

  private etiquetaQuincena(q: Quincena): string {
    const mes = new Date(q.anio, q.mes, 1).toLocaleDateString('es-MX', { month: 'short', year: '2-digit' });
    return `${mes.charAt(0).toUpperCase()}${mes.slice(1)} Q${q.mitad}`;
  }

  /** Puntos (x,y en un viewBox de 640×120) de la línea de tendencia del
   *  Saldo final proyectado a lo largo de las quincenas visibles — mismo
   *  patrón de "serie → puntos SVG" que el chart de Patrimonio neto de
   *  Reportes, para quedar visualmente consistente con esa pantalla. */
  protected readonly graficoSaldo = computed(() => {
    const saldoFinal = this.resumen().find((r) => r.id === 'resumen:saldoFinal');
    const visibles = this.quincenasVisibles();
    const vacio = { puntos: [] as { x: number; y: number; valor: number; etiqueta: string; esHoy: boolean }[], puntosSvg: '', areaSvg: '', ejeCeroY: 0 };
    if (!saldoFinal || visibles.length < 2) return vacio;

    const valores = visibles.map(({ indice }) => saldoFinal.celdas[indice]?.valor ?? 0);
    const minValor = Math.min(0, ...valores);
    const maxValor = Math.max(1, ...valores);
    const rango = maxValor - minValor || 1;
    const ancho = 640;
    const alto = 120;
    const paso = ancho / (visibles.length - 1);
    const y = (valor: number) => Math.round(alto - ((valor - minValor) / rango) * alto);

    const puntos = visibles.map(({ q, indice }, i) => ({
      x: Math.round(i * paso),
      y: y(saldoFinal.celdas[indice]?.valor ?? 0),
      valor: saldoFinal.celdas[indice]?.valor ?? 0,
      etiqueta: this.etiquetaQuincena(q),
      esHoy: indice === this.indiceHoy(),
    }));
    const puntosSvg = puntos.map((p) => `${p.x},${p.y}`).join(' ');
    const areaSvg = `${puntos[0].x},${alto} ${puntosSvg} ${puntos[puntos.length - 1].x},${alto}`;
    return { puntos, puntosSvg, areaSvg, ejeCeroY: y(0) };
  });

  // ---------------------------------------------------------------------
  // Edición manual de una celda.
  // ---------------------------------------------------------------------

  protected estaEditando(clave: string | null, quincenaClave: string): boolean {
    const actual = this.editando();
    return !!clave && !!actual && actual.clave === clave && actual.quincenaClave === quincenaClave;
  }

  protected iniciarEdicion(clave: string | null, quincenaClave: string, valorActual: number): void {
    if (!clave) return;
    if (this.quincenaBloqueada(quincenaClave)) {
      this.toast.advertencia('Este año ya está Autorizado o Ejecutado — la Proyección no se puede editar a mano.');
      return;
    }
    this.editando.set({ clave, quincenaClave });
    this.valorEditando.set(valorActual === 0 ? '' : String(Math.round(valorActual * 100) / 100));
  }

  protected cancelarEdicion(): void {
    this.editando.set(null);
  }

  /** Claves de renglón con una celda realmente editable (hoja/resumen con
   *  `clave`) en el orden en que se están pintando AHORA MISMO — respeta
   *  los grupos/hojas colapsados. Los 'detalle' (desglose por cuenta, solo
   *  lectura) y los renglones sin `clave` (grupo/subtotal/total/título de
   *  sección) se excluyen. Se usa para moverse con flechas entre celdas. */
  private clavesFilasEditables(): string[] {
    return this.filasTabla()
      .filter((r) => r.clave !== null && (r.tipo === 'hoja' || r.tipo === 'resumen'))
      .map((r) => r.clave as string);
  }

  /** Navegar entre celdas con las flechas mientras se edita, como en Excel:
   *  la flecha primero confirma el valor actual (igual que salir de la
   *  celda) y luego intenta abrir para editar la celda vecina en esa
   *  dirección — saltándose celdas no editables (bloqueadas por año
   *  Autorizado/Ejecutado, o renglones de solo lectura) hasta encontrar
   *  una válida o salirse de la tabla, en cuyo caso simplemente se queda
   *  sin editar ninguna (el valor ya quedó confirmado). */
  protected moverEdicion(direccion: 'up' | 'down' | 'left' | 'right'): void {
    const objetivo = this.editando();
    if (!objetivo) return;
    const { clave, quincenaClave } = objetivo;

    const quincenasVis = this.quincenasVisibles();
    const filas = this.clavesFilasEditables();
    const indiceCol = quincenasVis.findIndex((q) => q.q.clave === quincenaClave);
    const indiceFila = filas.indexOf(clave);

    this.confirmarEdicion();
    if (indiceCol === -1 || indiceFila === -1) return;

    let col = indiceCol;
    let fila = indiceFila;
    const maxIntentos = Math.max(quincenasVis.length, filas.length);
    for (let i = 0; i < maxIntentos; i++) {
      if (direccion === 'left') col--;
      else if (direccion === 'right') col++;
      else if (direccion === 'up') fila--;
      else fila++;

      if (col < 0 || col >= quincenasVis.length || fila < 0 || fila >= filas.length) return;

      const claveDestino = filas[fila];
      const quincenaDestino = quincenasVis[col].q.clave;
      const celdaDestino = this.celda(claveDestino, quincenaDestino);
      if (celdaDestino.editable) {
        this.iniciarEdicion(claveDestino, quincenaDestino, celdaDestino.valor);
        return;
      }
    }
  }

  /** Claves de categoría de Ingreso/Gasto (ej. "gas:12") — SOLO estas
   *  editan/crean/borran el MovimientoPresupuesto real de esa quincena en
   *  vez de un ProyeccionAjuste (ver confirmarEdicionMovimiento). Las demás
   *  (Ahorro "aho:X", Saldo inicial, etc.) siguen usando el ajuste manual
   *  de siempre — no hay forma segura de resolver "el" movimiento cuando
   *  la celda es neta de varios movimientos con signos distintos. */
  private static readonly RE_CATEGORIA = /^(ing|gas):(\d+)$/;

  protected confirmarEdicion(): void {
    const objetivo = this.editando();
    if (!objetivo) return;
    const texto = this.valorEditando().trim();
    this.editando.set(null);

    const match = objetivo.clave.match(ProyeccionComponent.RE_CATEGORIA);
    if (match) {
      this.confirmarEdicionMovimiento(match[1] as 'ing' | 'gas', Number(match[2]), objetivo.quincenaClave, texto);
      return;
    }

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

  /** El Fijo (si hay exactamente uno, sin movimiento propio todavía) que
   *  explica el valor automático de esta celda — para poder ligarle un
   *  MovimientoPresupuesto real cuando el usuario captura un monto ahí. */
  private fijoParaCelda(categoriaId: number, prefijo: 'ing' | 'gas', q: Quincena): MovimientoRecurrentePresupuesto | undefined {
    const tipo = prefijo === 'ing' ? 'Ingreso' : 'Gasto';
    return this.recurrentes().find(
      (f) =>
        f.activo !== false &&
        f.tipo === tipo &&
        Number(f.categoriaPresupuestoId) === categoriaId &&
        this.fijoFiraEnQuincena(f, q) &&
        !this.movimientos().some(
          (m) => m.origenRecurrenteId != null && Number(m.origenRecurrenteId) === Number(f.id) && this.quincenaDeFecha(m.fecha) === q.clave,
        ),
    );
  }

  /** Edita/crea/borra el MovimientoPresupuesto real de una celda de
   *  categoría Ingreso/Gasto (en vez de un ProyeccionAjuste aparte):
   *  - Si ya hay un movimiento real de esa categoría en esa quincena, se
   *    edita (o se borra, si se deja vacía). Si hay más de uno, se toca
   *    solo el más reciente y se avisa.
   *  - Si no hay movimiento pero SÍ un Fijo que la explica (aún no
   *    generado para esa quincena), se crea un movimiento ligado a ese
   *    Fijo (origenRecurrenteId), marcado "proyectado" — igual que
   *    "Generar futuros".
   *  - Si no hay ni movimiento ni Fijo, se crea un movimiento suelto,
   *    usando la única cuenta que históricamente haya usado esta
   *    categoría; si no se puede identificar una sola cuenta, se guarda
   *    como ajuste manual (comportamiento anterior) y se avisa. */
  private confirmarEdicionMovimiento(prefijo: 'ing' | 'gas', categoriaId: number, quincenaClave: string, texto: string): void {
    // Escribir "0" a mano equivale a dejar la celda vacía: un movimiento de
    // $0 no aporta nada a la proyección, así que se trata igual que borrar
    // (elimina el movimiento existente o no crea uno nuevo) en vez de dejar
    // un movimiento fantasma en $0 sin cuenta asignada.
    if (texto !== '' && Number(texto) === 0) {
      texto = '';
    }

    const clave = `${prefijo}:${categoriaId}`;
    const q = this.quincenas().find((qq) => qq.clave === quincenaClave);
    if (!q) return;

    const tipo = prefijo === 'ing' ? 'Ingreso' : 'Gasto';
    const existentes = this.movimientos()
      .filter(
        (m) =>
          !m.transferenciaId &&
          m.tipo === tipo &&
          Number(m.categoriaPresupuestoId) === categoriaId &&
          this.quincenaDeFecha(m.fecha) === quincenaClave,
      )
      .sort((a, b) => {
        const claveA = a.fechaModificacion ?? a.fechaCreacion ?? '';
        const claveB = b.fechaModificacion ?? b.fechaCreacion ?? '';
        return claveB.localeCompare(claveA) || Number(b.id) - Number(a.id);
      });

    if (existentes.length > 1) {
      this.toast.advertencia(
        `Esta celda junta ${existentes.length} movimientos — se edita solo el más reciente ("${existentes[0].descripcion}"). Los demás se editan desde Movimientos.`,
      );
    }

    // Esta celda ya se maneja por Movimiento (real o ligado a un Fijo) de
    // aquí en adelante — si quedó un ProyeccionAjuste manual de antes (de
    // una edición anterior a que existiera esta vinculación, o de la propia
    // celda vacía), se quita: si no, celda() lo seguiría mostrando en vez
    // del monto real del movimiento, porque el ajuste tiene prioridad.
    this.quitarAjuste(clave, quincenaClave);

    if (texto === '') {
      if (existentes.length > 0) {
        const objetivo = existentes[0];
        this.data.baja('MovimientoPresupuesto', objetivo.id).subscribe({
          next: () => {
            this.movimientos.update((lista) => lista.filter((m) => m.id !== objetivo.id));
            this.toast.exito('Movimiento eliminado.');
          },
          error: () => this.toast.error('No se pudo eliminar el movimiento.'),
        });
        return;
      }
      // No hay movimiento real (puede que el valor visible fuera de un
      // ajuste manual de antes de este cambio) — se limpia por si acaso.
      this.quitarAjuste(clave, quincenaClave);
      return;
    }

    const monto = Number(texto);
    if (!Number.isFinite(monto)) {
      this.toast.error('Ese valor no es un número válido.');
      return;
    }

    if (existentes.length > 0) {
      const objetivo = existentes[0];
      this.data.modificacion<MovimientoPresupuesto>('MovimientoPresupuesto', { ...objetivo, monto }).subscribe({
        next: (actualizado) => {
          this.movimientos.update((lista) => lista.map((m) => (m.id === actualizado.id ? actualizado : m)));
          this.toast.exito('Movimiento actualizado.');
        },
        error: () => this.toast.error('No se pudo actualizar el movimiento.'),
      });
      return;
    }

    const fijo = this.fijoParaCelda(categoriaId, prefijo, q);
    if (fijo) {
      const ultimoDia = new Date(q.anio, q.mes + 1, 0).getDate();
      const dia = Math.min(fijo.diaDelMes, ultimoDia);
      const payload = {
        fecha: textoFechaDeLocal(q.anio, q.mes, dia),
        tipo: fijo.tipo,
        cuentaPresupuestoId: Number(fijo.cuentaPresupuestoId),
        categoriaPresupuestoId: categoriaId,
        monto,
        descripcion: fijo.descripcion,
        transferenciaId: null,
        origenRecurrenteId: fijo.id,
        proyectado: true,
        creadoPorUsuarioId: this.usuarioActualId,
      };
      this.data.alta<MovimientoPresupuesto>('MovimientoPresupuesto', payload).subscribe({
        next: (creado) => {
          this.movimientos.update((lista) => [...lista, creado]);
          this.toast.exito(`Movimiento creado y ligado al fijo "${fijo.descripcion}".`);
        },
        error: () => this.toast.error('No se pudo crear el movimiento.'),
      });
      return;
    }

    // Sin fijo que ligar: se crea el movimiento de todos modos aunque no se
    // pueda identificar una sola cuenta histórica para esta categoría — la
    // cuenta ya NO es obligatoria para poder capturar aquí (antes, en ese
    // caso, se guardaba solo como ajuste manual y no se creaba movimiento).
    // Con 0 o más de una cuenta distinta se crea "Sin cuenta" (id 0); se
    // puede asignar una cuenta después desde Movimientos.
    const cuentaIds = [...(this.valoresAuto().cuentasPorClave.get(clave) ?? [])].filter((id) => id !== 0);
    const cuentaResuelta = cuentaIds.length === 1 ? cuentaIds[0] : 0;

    const diaInicio = q.mitad === 1 ? 1 : 16;
    const payload = {
      fecha: textoFechaDeLocal(q.anio, q.mes, diaInicio),
      tipo,
      cuentaPresupuestoId: cuentaResuelta,
      categoriaPresupuestoId: categoriaId,
      monto,
      descripcion: this.categorias().find((c) => Number(c.id) === categoriaId)?.nombre ?? '',
      transferenciaId: null,
      origenRecurrenteId: null,
      // Se crea desde Proyección (una pantalla de flujo A FUTURO), no desde
      // Movimientos — igual que lo que genera "Generar futuros", se marca
      // proyectado en vez de real; se "confirma" luego editándolo desde
      // Movimientos si hace falta (p.ej. cuando de verdad ya ocurrió).
      proyectado: true,
      creadoPorUsuarioId: this.usuarioActualId,
    };
    this.data.alta<MovimientoPresupuesto>('MovimientoPresupuesto', payload).subscribe({
      next: (creado) => {
        this.movimientos.update((lista) => [...lista, creado]);
        if (cuentaResuelta === 0) {
          this.toast.exito('Movimiento creado sin cuenta asignada — captúralo desde Movimientos si quieres ligarlo a una.');
        } else {
          this.toast.exito('Movimiento creado.');
        }
      },
      error: () => this.toast.error('No se pudo crear el movimiento.'),
    });
  }

  // ---------------------------------------------------------------------
  // Exportar a CSV (mismo botón/patrón que Movimientos, Deudas, Metas y
  // Reportes) — exporta lo que esté visible AHORA MISMO en pantalla
  // (filtro de Año, colapsado y buscador), una columna por quincena.
  // ---------------------------------------------------------------------

  exportarCsvArchivo(): void {
    const visibles = this.quincenasVisibles();
    const columnas: ColumnaCsv<FilaCsvProyeccion>[] = [
      { clave: 'renglon', etiqueta: 'Renglón' },
      ...visibles.map(({ q }, i) => ({ clave: `q${i}`, etiqueta: `${this.etiquetaQuincena(q)} ${q.anio}` }) as ColumnaCsv<FilaCsvProyeccion>),
      { clave: 'total', etiqueta: 'Total' },
    ];
    const filas: FilaCsvProyeccion[] = this.filasTabla()
      .filter((r) => r.tipo !== 'seccion-titulo' && r.tipo !== 'grupo')
      .map((r) => {
        const fila: FilaCsvProyeccion = { renglon: r.nombre, total: r.sumable ? this.totalFila(r.celdas) : '' };
        visibles.forEach(({ indice }, i) => {
          fila[`q${i}`] = r.celdas[indice]?.valor ?? 0;
        });
        return fila;
      });
    exportarCsv<FilaCsvProyeccion>('proyeccion.csv', columnas, filas);
    this.toast.exito(`Se descargó proyeccion.csv (${filas.length} renglones).`);
  }
}

/** Fila plana para el CSV de Proyección: un renglón de la tabla, con una
 *  columna dinámica "qN" por cada quincena visible (N = su posición en
 *  `quincenasVisibles()`, no el índice real de la ventana de 24). */
interface FilaCsvProyeccion {
  renglon: string;
  total: number | string;
  [quincena: string]: string | number;
}

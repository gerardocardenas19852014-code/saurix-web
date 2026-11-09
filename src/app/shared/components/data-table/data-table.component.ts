import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

export interface ColumnaTabla<T> {
  campo: keyof T & string;
  /**
   * Opcional: clave única para el `track` de la columna en el @for de
   * data-table.component.html. Solo hace falta cuando dos columnas leen el
   * mismo `campo` con dos formateadores distintos (p.ej. "Tipo" y
   * "Existencia" ambas derivadas de Producto.existencia en
   * productos.component.ts) — sin esto, Angular lanza NG0955 por claves de
   * tracking duplicadas. Si no se da, se usa `campo`.
   */
  claveColumna?: string;
  etiqueta: string;
  /** Formateador opcional para mostrar el valor de la celda */
  formatear?: (fila: T) => string;
  /**
   * Opcional: si se define, la celda se pinta como una "píldora" (badge) en
   * vez de texto plano, usando la(s) clase(s) CSS que esta función devuelva
   * (p.ej. 'grid-badge-success'). Pensado para columnas de estado
   * (Activo, Vigencia, etc.) — ver .grid-badge en styles.scss.
   */
  claseValor?: (fila: T) => string;
  /** Opcional: texto para el atributo title/tooltip de la celda — útil cuando
   *  formatear() devuelve una versión recortada del valor real (p.ej. el nombre
   *  corto de un sprint) y se quiere poder ver el valor completo al pasar el
   *  mouse, sin ocupar espacio extra en el renglón. */
  titulo?: (fila: T) => string;
  /**
   * Opcional (requiere `titulo`): en vez de recortar el valor a una sola línea
   * (grid-cell-truncada), lo envuelve en hasta 2 renglones y solo ahí lo
   * recorta con elipsis — pensado para texto libre más largo (p.ej. el
   * Título de un ticket) donde una sola línea esconde demasiado, pero
   * tampoco se quiere que el renglón de la tabla crezca sin límite. El
   * texto completo sigue disponible al pasar el mouse. Ver
   * grid-cell-truncada-multilinea en styles.scss.
   */
  multilinea?: boolean;
  /**
   * Opcional: en vez de mostrarse como una columna más (compitiendo por
   * ancho horizontal con el resto), el valor se muestra en un renglón
   * propio, de ancho completo, debajo de la fila principal — con la
   * etiqueta de la columna como prefijo (p.ej. "Título: ..."). Pensado
   * para texto libre largo (el Título de un ticket) que de otra forma
   * aprieta demasiado a las demás columnas. Solo se usa la PRIMERA
   * columna marcada así — no está pensado para más de una por tabla. Ver
   * columnasFila/columnaSubfila más abajo y grid-subfila-* en styles.scss.
   */
  subfila?: boolean;
  /**
   * Opcional (requiere `titulo`, para que el valor completo siga disponible
   * al pasar el mouse): límite de ancho en px para la celda truncada --
   * aparte de .grid-cell-truncada en styles.scss (pensado para texto libre
   * tipo nombre/título, hasta 420px). Pensado para columnas tipo "código"
   * (p.ej. el Folio de un ticket) donde un valor ocasionalmente largo no
   * debe estirar el renglón tanto como un nombre -- ver columnasLista en
   * kanban.component.ts (auditoría "Mejoras de experiencia en lista de
   * tickets", nov-2026). Sin este campo, el comportamiento de las demás
   * columnas/pantallas que usan DataTableComponent no cambia.
   */
  anchoMaximo?: number;
  /**
   * Opcional: ancho (px) que se le pide a la COLUMNA completa (encabezado y
   * todas sus celdas), como pista para el layout automático de la tabla
   * (`table-layout` sigue en `auto` -- esto no lo fuerza, solo lo sugiere,
   * y el espacio que una columna angosta deja libre lo absorben las demás
   * columnas que no tienen `anchoColumna`). Pensado para columnas de valor
   * corto (p.ej. Prioridad/Estado/Planeado/Vigencia de un ticket) que no
   * necesitan competir por espacio con columnas de texto libre (Folio,
   * Módulo, Asignado a) -- ver columnasLista en kanban.component.ts
   * (mandato "Ajuste visual de Lista de tickets", nov-2026). En móvil
   * (`@media max-width:640px`, vista de tarjeta) esta pista se ignora
   * (ver `.grid-table td { width: 100% !important }` en styles.scss), así
   * que no afecta esa vista. Sin este campo, ninguna columna/pantalla
   * existente cambia.
   */
  anchoColumna?: number;
  /**
   * Opcional: una segunda línea, compacta, DENTRO de la misma celda (no un
   * renglón de ancho completo como `subfila`) -- pensado para mostrar un
   * dato secundario pegado al principal sin inflar la altura del renglón
   * (p.ej. el Título de un ticket debajo de su Folio). Se recorta a una
   * línea con elipsis; el valor completo queda disponible al pasar el
   * mouse. Ver `.grid-cell-sub`/`.grid-cell-contenido` en styles.scss.
   */
  subEtiqueta?: (fila: T) => string;
}

/**
 * Grid genérico reutilizable en todas las "ventanas administradoras":
 * paginación en cliente, columnas configurables y acciones de
 * editar/eliminar por fila. Pensado para usarse igual en cualquier
 * catálogo o entidad del sistema.
 */
@Component({
  selector: 'app-data-table',
  standalone: true,
  templateUrl: './data-table.component.html',
  styleUrl: './data-table.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataTableComponent<T extends { id: number }> {
  readonly columnas = input.required<ColumnaTabla<T>[]>();
  readonly filas = input.required<T[]>();
  readonly tamanoPagina = input<number>(10);
  readonly cargando = input<boolean>(false);
  /** true = renglones más compactos (menos padding vertical en encabezado y
   *  celdas) vía la clase `grid-table-compacta` -- pensado para tablas con
   *  muchas columnas/registros por pantalla (p.ej. Lista de tickets, ver
   *  mandato "Ajuste visual de Lista de tickets", nov-2026). Sin este input
   *  (`false` por defecto) ninguna pantalla existente cambia de aspecto. */
  readonly compacto = input<boolean>(false);
  /** true = solo lectura: oculta por completo la columna "Acciones" (Editar/Eliminar).
   *  Pensado para bitácoras/históricos donde no tiene sentido editar o borrar un registro
   *  ya generado (p.ej. el historial de cambios de estado de un ticket). */
  readonly soloLectura = input<boolean>(false);
  /** true = oculta SOLO los botones Editar/Eliminar (a diferencia de
   *  soloLectura, que oculta toda la columna Acciones incluyendo
   *  accionExtra/accionExtra2) — pensado para listas de solo-consulta que
   *  sí necesitan una acción propia (p.ej. "Restaurar" en el historial de
   *  versiones de WikiDocs), donde editar/eliminar el registro tal cual no
   *  tiene sentido. */
  readonly ocultarEditarEliminar = input<boolean>(false);

  readonly editar = output<T>();
  readonly eliminar = output<T>();

  /** Botón de acción extra opcional por fila (p.ej. "Descargar", "Convertir a venta"). */
  readonly accionExtraEtiqueta = input<string | undefined>(undefined);
  /** Título/aria-label de esa acción extra (si no se da, se usa la etiqueta tal cual). */
  readonly accionExtraTitulo = input<string | undefined>(undefined);
  /** true = el botón se dibuja cuadrado/compacto como los de Editar/Eliminar
   *  (clase grid-action-icon), pensado para cuando accionExtraEtiqueta es un
   *  solo emoji en vez de texto (p.ej. "⚙️" en vez de "Opciones") — el
   *  texto completo sigue disponible vía accionExtraTitulo (tooltip).
   *  Por defecto false para no afectar las pantallas que ya usan esta
   *  acción con una etiqueta de texto normal. */
  readonly accionExtraIcono = input<boolean>(false);
  readonly accionExtra = output<T>();

  /** Segundo botón de acción extra opcional por fila, con etiqueta DINÁMICA
   *  por renglón (a diferencia de accionExtraEtiqueta, que es fija) — pensado
   *  para un icono que cambia según el estado de esa fila (p.ej. ⭐/☆ de
   *  favorito en WikiDocs). Si no se define esta función, el botón no se
   *  muestra, igual que accionExtraEtiqueta. */
  readonly accionExtra2EtiquetaFn = input<((fila: T) => string) | undefined>(undefined);
  readonly accionExtra2Titulo = input<string | undefined>(undefined);
  readonly accionExtra2 = output<T>();

  /** Tercer botón de acción extra opcional por fila, con etiqueta fija (igual
   *  patrón que accionExtraEtiqueta) — pensado para cuando ya se usan
   *  accionExtra y accionExtra2 (p.ej. Empresas: "Primer admin" + "Entrar" +
   *  "Módulos"). */
  readonly accionExtra3Etiqueta = input<string | undefined>(undefined);
  readonly accionExtra3Titulo = input<string | undefined>(undefined);
  /** Mismo criterio que accionExtraIcono — ver su comentario arriba. */
  readonly accionExtra3Icono = input<boolean>(false);
  readonly accionExtra3 = output<T>();

  /**
   * Modo servidor (opcional, por defecto false — ver auditoría de
   * rendimiento de Usuarios, nov-2026): cuando está activo, [filas] ya
   * viene exactamente como se debe mostrar (ya filtrada, ordenada y
   * paginada por el servidor) — esta tabla deja de ordenar/paginar en
   * cliente y en vez de eso EMITE lo que el usuario pide (ordenCambio al
   * hacer click en un encabezado, paginaCambio al cambiar de página), para
   * que el componente padre decida qué pedir. Por defecto (false) el
   * comportamiento es IDÉNTICO al de siempre — ninguna otra pantalla que ya
   * usa <app-data-table> se ve afectada.
   */
  readonly modoServidor = input<boolean>(false);
  /** Modo servidor: página actual (1-based) que ya traen las `filas`. */
  readonly paginaExterna = input<number>(1);
  /** Modo servidor: total de filas que cumplen el filtro actual (antes de
   *  paginar) — para "N resultados" y para calcular el total de páginas. */
  readonly totalExterno = input<number>(0);
  /** Modo servidor: columna/dirección de orden actual (para pintar la
   *  flechita ↑/↓ en el encabezado correcto). */
  readonly campoOrdenExterno = input<(keyof T & string) | null>(null);
  readonly direccionOrdenExterno = input<'asc' | 'desc'>('asc');
  /** Modo servidor: se emite al hacer click en "Anterior"/"Siguiente". */
  readonly paginaCambio = output<number>();
  /** Modo servidor: se emite al hacer click en un encabezado ordenable. */
  readonly ordenCambio = output<{ campo: keyof T & string; direccion: 'asc' | 'desc' }>();

  readonly paginaActual = signal(1);
  readonly campoOrden = signal<keyof T & string | null>(null);
  readonly direccionOrden = signal<'asc' | 'desc'>('asc');

  private readonly campoOrdenEfectivo = computed(() =>
    this.modoServidor() ? this.campoOrdenExterno() : this.campoOrden(),
  );
  private readonly direccionOrdenEfectiva = computed(() =>
    this.modoServidor() ? this.direccionOrdenExterno() : this.direccionOrden(),
  );

  /** En modo servidor, `filas()` ya viene ordenada por el backend — aquí no
   *  se reordena nada (evita un doble criterio de orden silencioso). */
  readonly filasOrdenadas = computed(() => {
    if (this.modoServidor()) return this.filas();
    const campo = this.campoOrden();
    if (!campo) return this.filas();

    const direccion = this.direccionOrden() === 'asc' ? 1 : -1;
    return this.filas()
      .map((fila, indice) => ({ fila, indice }))
      .sort((a, b) => {
        const resultado = this.compararValores(a.fila[campo], b.fila[campo]);
        return resultado === 0 ? a.indice - b.indice : resultado * direccion;
      })
      .map(({ fila }) => fila);
  });

  /** "N resultados" del pie — en modo servidor es el total filtrado real
   *  (no solo las filas de esta página). */
  readonly totalFilasMostrado = computed(() =>
    this.modoServidor() ? this.totalExterno() : this.filasOrdenadas().length,
  );

  /** Página actual a mostrar en el pie — en modo servidor es la que el
   *  padre dice que trajo (paginaExterna), nunca el signal interno (que en
   *  ese modo no se usa: los clicks de página se emiten, no se aplican
   *  aquí). */
  readonly paginaActualEfectiva = computed(() => (this.modoServidor() ? this.paginaExterna() : this.paginaActual()));

  readonly totalPaginas = computed(() =>
    Math.max(1, Math.ceil(this.totalFilasMostrado() / Math.max(1, this.tamanoPagina()))),
  );

  /** En modo servidor, `filas()` ya viene exactamente paginada por el
   *  backend — aquí no se vuelve a recortar. */
  readonly filasPagina = computed(() => {
    if (this.modoServidor()) return this.filas();
    const inicio = (this.paginaActual() - 1) * this.tamanoPagina();
    return this.filasOrdenadas().slice(inicio, inicio + this.tamanoPagina());
  });

  /** Columnas que se muestran de forma normal (encabezado + celda propia) —
   *  todas excepto la marcada con `subfila`, ver columnaSubfila. */
  readonly columnasFila = computed(() => this.columnas().filter((c) => !c.subfila));

  /** La columna (si hay una) que en vez de celda propia se muestra en un
   *  renglón de ancho completo debajo de cada fila — ver ColumnaTabla.subfila. */
  readonly columnaSubfila = computed(() => this.columnas().find((c) => c.subfila) ?? null);

  ordenarPor(columna: ColumnaTabla<T>): void {
    const mismaColumna = this.campoOrdenEfectivo() === columna.campo;
    const nuevaDireccion: 'asc' | 'desc' = mismaColumna && this.direccionOrdenEfectiva() === 'asc' ? 'desc' : 'asc';
    if (this.modoServidor()) {
      this.ordenCambio.emit({ campo: columna.campo, direccion: nuevaDireccion });
      return;
    }
    if (mismaColumna) {
      this.direccionOrden.update((direccion) => (direccion === 'asc' ? 'desc' : 'asc'));
    } else {
      this.campoOrden.set(columna.campo);
      this.direccionOrden.set('asc');
    }
    this.paginaActual.set(1);
  }

  indicadorOrden(columna: ColumnaTabla<T>): string {
    if (this.campoOrdenEfectivo() !== columna.campo) return '↕';
    return this.direccionOrdenEfectiva() === 'asc' ? '↑' : '↓';
  }

  valorCelda(fila: T, columna: ColumnaTabla<T>): string {
    if (columna.formatear) {
      return columna.formatear(fila);
    }
    const valor = fila[columna.campo];
    return valor === null || valor === undefined ? '' : String(valor);
  }

  irAPagina(pagina: number): void {
    if (pagina < 1 || pagina > this.totalPaginas()) return;
    if (this.modoServidor()) {
      this.paginaCambio.emit(pagina);
      return;
    }
    this.paginaActual.set(pagina);
  }

  private compararValores(a: unknown, b: unknown): number {
    if (a === b) return 0;
    if (a === null || a === undefined || a === '') return -1;
    if (b === null || b === undefined || b === '') return 1;
    if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : 1;
    if (typeof a === 'boolean' && typeof b === 'boolean') return a === false ? -1 : 1;
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }
}

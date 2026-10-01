import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

export interface ColumnaTabla<T> {
  campo: keyof T & string;
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
  readonly accionExtra = output<T>();

  /** Segundo botón de acción extra opcional por fila, con etiqueta DINÁMICA
   *  por renglón (a diferencia de accionExtraEtiqueta, que es fija) — pensado
   *  para un icono que cambia según el estado de esa fila (p.ej. ⭐/☆ de
   *  favorito en WikiDocs). Si no se define esta función, el botón no se
   *  muestra, igual que accionExtraEtiqueta. */
  readonly accionExtra2EtiquetaFn = input<((fila: T) => string) | undefined>(undefined);
  readonly accionExtra2Titulo = input<string | undefined>(undefined);
  readonly accionExtra2 = output<T>();

  readonly paginaActual = signal(1);
  readonly campoOrden = signal<keyof T & string | null>(null);
  readonly direccionOrden = signal<'asc' | 'desc'>('asc');

  readonly filasOrdenadas = computed(() => {
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

  readonly totalPaginas = computed(() =>
    Math.max(1, Math.ceil(this.filasOrdenadas().length / this.tamanoPagina())),
  );

  readonly filasPagina = computed(() => {
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
    if (this.campoOrden() === columna.campo) {
      this.direccionOrden.update((direccion) => (direccion === 'asc' ? 'desc' : 'asc'));
    } else {
      this.campoOrden.set(columna.campo);
      this.direccionOrden.set('asc');
    }
    this.paginaActual.set(1);
  }

  indicadorOrden(columna: ColumnaTabla<T>): string {
    if (this.campoOrden() !== columna.campo) return '↕';
    return this.direccionOrden() === 'asc' ? '↑' : '↓';
  }

  valorCelda(fila: T, columna: ColumnaTabla<T>): string {
    if (columna.formatear) {
      return columna.formatear(fila);
    }
    const valor = fila[columna.campo];
    return valor === null || valor === undefined ? '' : String(valor);
  }

  irAPagina(pagina: number): void {
    if (pagina >= 1 && pagina <= this.totalPaginas()) {
      this.paginaActual.set(pagina);
    }
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

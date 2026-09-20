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

  readonly editar = output<T>();
  readonly eliminar = output<T>();

  /** Botón de acción extra opcional por fila (p.ej. "Descargar", "Convertir a venta"). */
  readonly accionExtraEtiqueta = input<string | undefined>(undefined);
  /** Título/aria-label de esa acción extra (si no se da, se usa la etiqueta tal cual). */
  readonly accionExtraTitulo = input<string | undefined>(undefined);
  readonly accionExtra = output<T>();

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

import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DataClientService, FILTRO_BUSQUEDA } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { ClienteFormModalComponent } from './cliente-form-modal.component';
import { ClienteService } from './cliente.service';
import { Cliente } from './cliente.model';

/** Catálogo de clientes de Ventas — mismo patrón de catálogo CRUD que
 *  ProveedoresComponent, salvo que el formulario vive aparte
 *  (ClienteFormModalComponent, ver ese archivo) porque Cobro también lo usa.
 *  El contacto "Público en General" (esGenerico) se siembra solo la primera
 *  vez que se entra aquí (o a Cobro) y no se puede eliminar.
 *
 * HOMOLOGACIÓN DE RENDIMIENTO (Fase 1, "Prompt maestro" nov-2026): esta
 * pantalla descargaba `list('Cliente')` completo (SIN paginación ni
 * filtro server-side) y filtraba/paginaba todo en memoria vía
 * `clientesFiltrados()` + `[tamanoPagina]` de <app-data-table> — con miles
 * de clientes eso significaba traer la tabla entera para mostrar 20.
 * Ahora sigue el mismo patrón ya homologado en Productos/Kardex/Órdenes de
 * compra: `listarPagina()` (server-side, con `count` real), un botón
 * "🔍 Buscar" + Enter como único disparador de una consulta nueva (ningún
 * filtro —incluido "Mostrar inactivos"— consulta por sí solo), y
 * paginación real contra el servidor (Anterior/Siguiente). A diferencia de
 * Productos (catálogo potencialmente de cientos de miles de filas), aquí
 * SÍ se carga la página 1 de inmediato al entrar (mismo criterio que
 * Órdenes de compra/Usuarios): el catálogo de clientes de una empresa
 * normal es chico, así que no tiene sentido obligar a buscar antes de ver
 * nada. La búsqueda es una sola caja de texto que busca, server-side y con
 * OR, sobre nombre/razón social, RFC, correo y teléfono (FILTRO_BUSQUEDA,
 * misma infraestructura que ya usan Imprimir etiquetas/Kardex). */
@Component({
  selector: 'app-clientes',
  standalone: true,
  imports: [DataTableComponent, ConfirmDialogComponent, ClienteFormModalComponent],
  templateUrl: './clientes.component.html',
  styleUrl: './clientes.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClientesComponent implements OnInit, OnDestroy {
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);
  private readonly clienteService = inject(ClienteService);

  /** Solo la página actual, ya filtrada/ordenada/recortada por el
   *  servidor — ver cargar(). `totalFiltrado` es el total real que cumple
   *  el filtro aplicado (antes de paginar), para "N resultados" y el total
   *  de páginas. */
  protected readonly clientesPagina = signal<Cliente[]>([]);
  protected readonly totalFiltrado = signal(0);
  protected readonly cargando = signal(false);

  /** Filtros EN EDICIÓN (lo que el usuario está escribiendo/marcando) —
   *  nunca disparan una consulta por sí solos. Solo cambiarFiltro()
   *  (botón "🔍 Buscar" o Enter) los aplica de verdad. */
  protected readonly busqueda = signal('');
  protected readonly mostrarInactivos = signal(false);

  protected readonly paginaActual = signal(1);
  protected readonly totalPaginas = computed(() =>
    Math.max(1, Math.ceil(this.totalFiltrado() / Math.max(1, this.preferenciasGrid.tamanoPagina()))),
  );

  protected readonly modalAbierto = signal(false);
  protected readonly clienteEnEdicion = signal<Cliente | null>(null);
  protected readonly clienteAEliminar = signal<Cliente | null>(null);

  protected readonly columnas: ColumnaTabla<Cliente>[] = [
    { campo: 'nombre', etiqueta: 'Nombre / Razón social' },
    { campo: 'rfc', etiqueta: 'RFC' },
    { campo: 'correo', etiqueta: 'Correo', formatear: (fila) => fila.correo ?? '—' },
    { campo: 'telefono', etiqueta: 'Teléfono', formatear: (fila) => fila.telefono ?? '—' },
    {
      campo: 'esGenerico',
      etiqueta: 'Tipo',
      formatear: (fila) => (fila.esGenerico ? 'Genérico' : 'Cliente'),
      claseValor: (fila) => (fila.esGenerico ? 'grid-badge-warning' : 'grid-badge-muted'),
    },
    {
      campo: 'activo',
      etiqueta: 'Activo',
      formatear: (fila) => (fila.activo !== false ? 'Sí' : 'No'),
      claseValor: (fila) => (fila.activo !== false ? 'grid-badge-success' : 'grid-badge-muted'),
    },
  ];

  async ngOnInit(): Promise<void> {
    document.documentElement.setAttribute('data-wide', 'grid');
    await this.clienteService.obtenerOCrearGenerico(); // asegura que el genérico ya exista
    this.cargar();
  }

  /** Filtro actual para Cliente: una sola caja de texto busca, server-side
   *  y con OR (ilike), sobre nombre/razón social, RFC, correo y teléfono.
   *  `activo` solo se manda cuando NO se quieren inactivos (mandarlo en
   *  false excluiría los activos, justo lo opuesto de "Mostrar
   *  inactivos" — omitirlo trae ambos). */
  private filtroActual(): Record<string, unknown> {
    const filtro: Record<string, unknown> = {};
    const texto = this.busqueda().trim();
    if (texto) filtro[FILTRO_BUSQUEDA] = { columnas: ['nombre', 'rfc', 'correo', 'telefono'], texto };
    if (!this.mostrarInactivos()) filtro['activo'] = true;
    return filtro;
  }

  /** Trae SOLO la página actual del catálogo que cumple el filtro
   *  aplicado — nunca la tabla completa. Mismo patrón que
   *  ProductosComponent.cargar()/KardexComponent.cargarListado(). */
  cargar(): void {
    this.cargando.set(true);
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActual() - 1) * tamanio;
    this.data.listarPagina<Cliente>('Cliente', this.filtroActual(), desde, tamanio, { columna: 'nombre' }).subscribe({
      next: ({ filas, total }) => {
        this.totalFiltrado.set(total);
        // Si la página en la que estábamos quedó vacía (p.ej. se acaba de
        // eliminar el último cliente de la última página, o un filtro
        // nuevo tiene menos páginas que la posición actual), retrocede a
        // la última página real en vez de dejar la tabla en blanco.
        if (filas.length === 0 && this.paginaActual() > 1 && total > 0) {
          this.paginaActual.set(Math.max(1, Math.ceil(total / tamanio)));
          this.cargar();
          return;
        }
        this.clientesPagina.set(filas);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  /** Único disparador de una consulta nueva (botón "🔍 Buscar" o Enter en
   *  la caja de búsqueda) — cambiar el texto o "Mostrar inactivos" nunca
   *  consulta por sí solo. Vuelve a la página 1: quedarse en la página 4
   *  de un filtro nuevo casi siempre cae fuera de rango. */
  protected cambiarFiltro(): void {
    this.paginaActual.set(1);
    this.cargar();
  }

  protected irAPaginaAnterior(): void {
    if (this.paginaActual() <= 1) return;
    this.paginaActual.update((p) => p - 1);
    this.cargar();
  }

  protected irAPaginaSiguiente(): void {
    if (this.paginaActual() >= this.totalPaginas()) return;
    this.paginaActual.update((p) => p + 1);
    this.cargar();
  }

  nuevo(): void {
    this.clienteEnEdicion.set(null);
    this.modalAbierto.set(true);
  }

  editar(cliente: Cliente): void {
    this.clienteEnEdicion.set(cliente);
    this.modalAbierto.set(true);
  }

  alGuardar(): void {
    this.modalAbierto.set(false);
    this.cargar(); // refresca solo la página actual, con el filtro ya aplicado.
  }

  pedirEliminar(cliente: Cliente): void {
    if (cliente.esGenerico) {
      this.toast.advertencia('El contacto "Público en General" no se puede eliminar.');
      return;
    }
    this.clienteAEliminar.set(cliente);
  }

  confirmarEliminar(): void {
    const cliente = this.clienteAEliminar();
    if (!cliente) return;

    this.data.baja('Cliente', cliente.id).subscribe({
      next: () => {
        this.toast.exito('Cliente eliminado.');
        this.clienteAEliminar.set(null);
        this.cargar();
      },
    });
  }
}

import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { forkJoin, from } from 'rxjs';
import { DataClientService, FiltroBusqueda, FILTRO_BUSQUEDA } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { ToastService } from '../../../shared/services/toast.service';
import { Usuario, nombreCompletoUsuario } from '../../seguridad/usuarios/usuario.model';
import { ComisionVendedor, TipoComisionVendedor } from './comision-vendedor.model';
import { ComisionVendedorService } from './comision-vendedor.service';

const COLUMNAS_BUSQUEDA: (keyof Usuario & string)[] = [
  'nombreUsuario',
  'nombre',
  'apellidoPaterno',
  'apellidoMaterno',
  'email',
];

interface FilaVendedor {
  /** Mismo id del Usuario — DataTableComponent exige id:number por fila. */
  id: number;
  usuario: Usuario;
  comision: ComisionVendedor | null;
}

/**
 * Mandato 85 (homologación SAURIX-CAT-001 v1.1, adaptada): a diferencia de
 * los catálogos de entidades propias (Bodegas, Regímenes fiscales, etc.),
 * cada fila aquí es un Usuario (vendedor) ya existente — no hay nada que
 * "crear" desde esta pantalla (los vendedores se dan de alta en Usuarios/
 * Seguridad) ni nada que "eliminar" (quitar una comisión no es una función
 * expuesta hoy). Por eso el estándar se aplica sin botón "+ Nueva" y sin
 * acción "Eliminar" en la cuadrícula — se conserva el único flujo
 * existente, "Editar" (accionExtra), para fijar tipo/valor de comisión.
 *
 * Config de comisión por vendedor (% o monto fijo por venta) — ver
 * ComisionVendedor.model.ts. Solo configura el porcentaje/monto; el
 * cálculo real por periodo está en ReporteComisionesComponent (fuera de
 * este mandato, sin cambios).
 */
@Component({
  selector: 'app-comisiones-vendedores',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent],
  templateUrl: './comisiones-vendedores.component.html',
  styleUrl: './comisiones-vendedores.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComisionesVendedoresComponent implements OnInit, OnDestroy {
  private readonly data = inject(DataClientService);
  private readonly comisionService = inject(ComisionVendedorService);
  protected readonly toast = inject(ToastService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);
  private readonly fb = inject(FormBuilder);

  protected readonly comisiones = signal<ComisionVendedor[]>([]);
  protected readonly totalFiltrado = signal(0);
  protected readonly paginaActual = signal(1);
  protected readonly cargando = signal(false);
  /** false hasta que el usuario presione "Buscar" por primera vez -- igual
   *  criterio que el resto de catálogos homologados (Mandato 85): no se
   *  consulta nada al abrir la pantalla. */
  protected readonly haBuscado = signal(false);

  protected readonly busquedaEnEdicion = signal('');
  protected readonly mostrarInactivosEnEdicion = signal(false);
  private busquedaAplicada = '';
  private mostrarInactivosAplicado = false;

  private secuencia = 0;

  protected readonly filas = signal<FilaVendedor[]>([]);

  protected readonly columnas: ColumnaTabla<FilaVendedor>[] = [
    { campo: 'usuario', etiqueta: 'Vendedor', formatear: (f) => nombreCompletoUsuario(f.usuario) },
    {
      campo: 'comision',
      etiqueta: 'Comisión configurada',
      formatear: (f) =>
        f.comision
          ? f.comision.tipo === 'Porcentaje'
            ? `${f.comision.valor}%`
            : `$${f.comision.valor.toFixed(2)} por venta`
          : 'Sin comisión',
    },
  ];

  protected readonly filaEditando = signal<FilaVendedor | null>(null);
  protected readonly guardando = signal(false);
  protected readonly avisoCierreVisible = signal(false);

  private valoresOriginales = '';
  private elementoDisparador: HTMLElement | null = null;

  private readonly primerCampo = viewChild<ElementRef<HTMLInputElement>>('primerCampo');

  protected readonly form = this.fb.nonNullable.group({
    tipo: ['Porcentaje' as TipoComisionVendedor, Validators.required],
    valor: [0, [Validators.required, Validators.min(0)]],
  });

  constructor() {
    effect(() => {
      if (!this.filaEditando()) return;
      queueMicrotask(() => this.primerCampo()?.nativeElement.focus());
    });
  }

  ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid');
    // Mandato 85: no se consulta nada al abrir la pantalla. La cuadrícula
    // arranca vacía con la invitación a buscar (ver plantilla) hasta que el
    // usuario presione "Buscar" o Enter -- ver buscar() más abajo.
  }

  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  // ── Búsqueda y paginación ───────────────────────────────────────────────

  private filtroActual(): Record<string, unknown> {
    const filtro: Record<string, unknown> = {};
    const texto = this.busquedaAplicada.trim();
    if (texto) {
      filtro[FILTRO_BUSQUEDA] = { columnas: COLUMNAS_BUSQUEDA, texto } satisfies FiltroBusqueda;
    }
    if (!this.mostrarInactivosAplicado) filtro['activo'] = true;
    return filtro;
  }

  /** Usuario (paginado/filtrado en servidor) + ComisionVendedor (catálogo
   *  acotado al número de vendedores -- se trae completo en paralelo, igual
   *  que antes de esta homologación, no uno por fila). */
  private cargar(): void {
    this.cargando.set(true);
    const miSecuencia = ++this.secuencia;
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActual() - 1) * tamanio;

    forkJoin({
      pagina: this.data.listarPagina<Usuario>('Usuario', this.filtroActual(), desde, tamanio),
      comisiones: from(this.comisionService.listar()),
    }).subscribe({
      next: ({ pagina, comisiones }) => {
        if (miSecuencia !== this.secuencia) return;
        this.comisiones.set(comisiones);
        this.filas.set(
          pagina.filas.map((usuario) => ({
            id: usuario.id,
            usuario,
            comision: comisiones.find((c) => c.usuarioId === usuario.id) ?? null,
          })),
        );
        this.totalFiltrado.set(pagina.total);
        this.cargando.set(false);
      },
      error: () => {
        if (miSecuencia !== this.secuencia) return;
        this.cargando.set(false);
      },
    });
  }

  private reiniciarYCargar(): void {
    this.paginaActual.set(1);
    this.cargar();
  }

  protected buscar(): void {
    this.haBuscado.set(true);
    this.busquedaAplicada = this.busquedaEnEdicion();
    this.mostrarInactivosAplicado = this.mostrarInactivosEnEdicion();
    this.reiniciarYCargar();
  }

  protected limpiarFiltros(): void {
    this.busquedaEnEdicion.set('');
    this.mostrarInactivosEnEdicion.set(false);
  }

  protected onPaginaCambio(pagina: number): void {
    this.paginaActual.set(pagina);
    this.cargar();
  }

  // ── Edición (única acción -- no hay alta ni eliminación en esta pantalla) ──

  abrirEditar(fila: FilaVendedor): void {
    this.elementoDisparador = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.filaEditando.set(fila);
    this.form.reset({ tipo: fila.comision?.tipo ?? 'Porcentaje', valor: fila.comision?.valor ?? 0 });
    this.valoresOriginales = JSON.stringify(this.form.getRawValue());
  }

  private hayCambiosSinGuardar(): boolean {
    return JSON.stringify(this.form.getRawValue()) !== this.valoresOriginales;
  }

  private cerrarEditar(): void {
    this.filaEditando.set(null);
    const elemento = this.elementoDisparador;
    this.elementoDisparador = null;
    if (elemento) queueMicrotask(() => elemento.focus());
  }

  protected onClicFondoModal(evento: MouseEvent): void {
    if (evento.isTrusted) return;
    this.cerrarEditar();
  }

  protected cancelar(): void {
    if (!this.hayCambiosSinGuardar()) {
      this.cerrarEditar();
      return;
    }
    this.avisoCierreVisible.set(true);
  }

  protected confirmarCierreSinGuardar(): void {
    this.avisoCierreVisible.set(false);
    this.cerrarEditar();
  }

  protected cancelarCierreSinGuardar(): void {
    this.avisoCierreVisible.set(false);
  }

  protected onTabDentroDelModal(evento: Event): void {
    if (!(evento instanceof KeyboardEvent) || evento.key !== 'Tab') return;
    const contenedor = evento.currentTarget as HTMLElement | null;
    if (!contenedor) return;
    const enfocables = Array.from(
      contenedor.querySelectorAll<HTMLElement>(
        'input, textarea, select, button, [href], [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.hasAttribute('disabled'));
    if (enfocables.length === 0) return;

    const primero = enfocables[0];
    const ultimo = enfocables[enfocables.length - 1];
    const activo = document.activeElement;

    if (evento.shiftKey && activo === primero) {
      evento.preventDefault();
      ultimo.focus();
    } else if (!evento.shiftKey && activo === ultimo) {
      evento.preventDefault();
      primero.focus();
    }
  }

  @HostListener('keydown', ['$event'])
  protected onAtajoTeclado(evento: KeyboardEvent): void {
    // Sin Alt+N: no existe un "nuevo" en esta pantalla (ver comentario de clase).
    if (evento.altKey && !evento.ctrlKey && !evento.metaKey && !this.filaEditando()) {
      const tecla = evento.key.toLowerCase();
      if (tecla === 'b') {
        evento.preventDefault();
        this.buscar();
        return;
      }
      if (tecla === 'l') {
        evento.preventDefault();
        this.limpiarFiltros();
        return;
      }
    }

    if (evento.ctrlKey && evento.key === 'Enter' && this.filaEditando()) {
      if (this.form.invalid || this.guardando()) return;
      evento.preventDefault();
      this.guardar();
    }
  }

  async guardar(): Promise<void> {
    const fila = this.filaEditando();
    if (!fila || this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const valor = this.form.getRawValue();
    this.guardando.set(true);
    try {
      await this.comisionService.guardar(fila.usuario.id, valor.tipo, valor.valor);
      this.toast.exito('Comisión guardada.');
      this.cerrarEditar();
      if (this.haBuscado()) this.cargar();
    } finally {
      this.guardando.set(false);
    }
  }
}

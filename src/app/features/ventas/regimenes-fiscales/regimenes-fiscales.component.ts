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
import { map } from 'rxjs';
import { DataClientService, FiltroBusqueda, FILTRO_BUSQUEDA } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { Cliente } from '../clientes/cliente.model';
import { RegimenFiscal } from './regimen-fiscal.model';

const COLUMNAS_BUSQUEDA: (keyof RegimenFiscal & string)[] = ['clave', 'nombre'];

/**
 * Mandato 85 (homologación SAURIX-CAT-001 v1.1): catálogo "Régimen fiscal"
 * llevado al mismo estándar que Categorías de producto / Bodegas / etc.
 *
 * Particularidad frente a esos catálogos: Cliente NO referencia este
 * catálogo por id, sino por `regimenFiscalClave` (texto) -- confirmado en
 * cliente.model.ts / cliente-form-modal.component.ts. Verificado contra
 * producción: no existe ninguna restricción FOREIGN KEY entre
 * cliente.regimen_fiscal_clave y regimen_fiscal.clave (information_schema,
 * cero resultados) -- a diferencia de Bodegas/Proveedores/Unidades de
 * medida/Tipos de lista de precio, aquí NINGÚN respaldo de la base de
 * datos protege esta relación. El chequeo de dependencias de este
 * componente (antes de eliminar, y antes de permitir cambiar la clave de
 * un régimen ya en uso) es la ÚNICA protección existente -- queda una
 * condición de carrera teórica sin cerrar (una fila de Cliente insertada
 * justo después del chequeo), más seria aquí que en los otros catálogos
 * porque no hay ningún backstop de Postgres detrás. Cerrarla del todo
 * requeriría una restricción real de integridad referencial (FK por
 * clave) -- se presenta aparte, bajo autorización explícita (Mandato 85),
 * no se ejecuta aquí.
 *
 * La siembra automática de los 12 regímenes del SAT (antes disparada como
 * efecto colateral de la carga automática al abrir -- ver
 * REGIMENES_FISCALES_SEMILLA en regimen-fiscal.model.ts) se retiró de este
 * componente por instrucción explícita del Mandato 85 ("no ejecutar
 * siembras automáticas al abrir ni escrituras inesperadas al buscar"). La
 * capacidad de inicializar el catálogo se conserva como dato (la
 * constante sigue existiendo en el modelo), pero el mecanismo explícito
 * para dispararla se propone por separado -- no se implementa en este
 * cambio.
 */
@Component({
  selector: 'app-regimenes-fiscales',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent],
  templateUrl: './regimenes-fiscales.component.html',
  styleUrl: './regimenes-fiscales.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RegimenesFiscalesComponent implements OnInit, OnDestroy {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);
  private readonly fb = inject(FormBuilder);

  protected readonly regimenesPagina = signal<RegimenFiscal[]>([]);
  protected readonly totalFiltrado = signal(0);
  protected readonly paginaActual = signal(1);
  protected readonly cargando = signal(false);
  /** false hasta que el usuario presione "Buscar" por primera vez -- nunca
   *  arranca en true: ya no se consulta nada al abrir la pantalla (ver
   *  ngOnInit() más abajo, Mandato 85). Antes de eso la cuadrícula no debe
   *  mostrar la tabla vacía sino una invitación a buscar. */
  protected readonly haBuscado = signal(false);

  protected readonly busquedaEnEdicion = signal('');
  protected readonly mostrarInactivosEnEdicion = signal(false);
  private busquedaAplicada = '';
  private mostrarInactivosAplicado = false;

  private secuencia = 0;

  protected readonly modalAbierto = signal(false);
  protected readonly regimenEnEdicion = signal<RegimenFiscal | null>(null);
  protected readonly guardando = signal(false);
  protected readonly avisoCierreVisible = signal(false);

  private valoresOriginales = '';
  private elementoDisparador: HTMLElement | null = null;

  protected readonly regimenAEliminar = signal<RegimenFiscal | null>(null);

  private readonly primerCampo = viewChild<ElementRef<HTMLInputElement>>('primerCampo');

  protected readonly columnas: ColumnaTabla<RegimenFiscal>[] = [
    { campo: 'clave', etiqueta: 'Clave' },
    { campo: 'nombre', etiqueta: 'Nombre' },
    {
      campo: 'activo',
      etiqueta: 'Activo',
      formatear: (fila) => (fila.activo !== false ? 'Sí' : 'No'),
      claseValor: (fila) => (fila.activo !== false ? 'grid-badge-success' : 'grid-badge-muted'),
    },
  ];

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    clave: ['', Validators.required],
    nombre: ['', Validators.required],
    activo: [true],
  });

  constructor() {
    effect(() => {
      if (!this.modalAbierto()) return;
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

  private cargar(): void {
    this.cargando.set(true);
    const miSecuencia = ++this.secuencia;
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActual() - 1) * tamanio;

    this.data.listarPagina<RegimenFiscal>('RegimenFiscal', this.filtroActual(), desde, tamanio).subscribe({
      next: ({ filas, total }) => {
        if (miSecuencia !== this.secuencia) return;
        this.regimenesPagina.set(filas);
        this.totalFiltrado.set(total);
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

  // ── Dependencias (Cliente.regimenFiscalClave) ───────────────────────────

  /** Única protección real contra orfandad silenciosa: no hay FK en la base
   *  de datos entre cliente.regimen_fiscal_clave y regimen_fiscal.clave
   *  (confirmado contra producción, ver comentario de clase). Se usa tanto
   *  antes de eliminar como antes de permitir que se cambie la clave de un
   *  régimen ya en uso -- aislamiento multiempresa ya resuelto por
   *  DataClientService/RLS, igual que el resto de las consultas de este
   *  componente. */
  private contarClientesConClave(clave: string) {
    return this.data.listarPagina<Cliente>('Cliente', { regimenFiscalClave: clave }, 0, 1).pipe(map((r) => r.total));
  }

  // ── Alta / edición ──────────────────────────────────────────────────────

  nuevo(): void {
    this.elementoDisparador = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.regimenEnEdicion.set(null);
    this.form.reset({ id: 0, clave: '', nombre: '', activo: true });
    this.valoresOriginales = JSON.stringify(this.form.getRawValue());
    this.modalAbierto.set(true);
  }

  editar(regimen: RegimenFiscal): void {
    this.elementoDisparador = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.regimenEnEdicion.set(regimen);
    this.form.reset({
      id: regimen.id,
      clave: regimen.clave,
      nombre: regimen.nombre,
      activo: regimen.activo !== false,
    });
    this.valoresOriginales = JSON.stringify(this.form.getRawValue());
    this.modalAbierto.set(true);
  }

  private hayCambiosSinGuardar(): boolean {
    return JSON.stringify(this.form.getRawValue()) !== this.valoresOriginales;
  }

  private cerrarModal(): void {
    this.modalAbierto.set(false);
    const elemento = this.elementoDisparador;
    this.elementoDisparador = null;
    if (elemento) queueMicrotask(() => elemento.focus());
  }

  protected onClicFondoModal(evento: MouseEvent): void {
    if (evento.isTrusted) return;
    this.cerrarModal();
  }

  protected cancelar(): void {
    if (!this.hayCambiosSinGuardar()) {
      this.cerrarModal();
      return;
    }
    this.avisoCierreVisible.set(true);
  }

  protected confirmarCierreSinGuardar(): void {
    this.avisoCierreVisible.set(false);
    this.cerrarModal();
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
    if (evento.altKey && !evento.ctrlKey && !evento.metaKey && !this.modalAbierto()) {
      const tecla = evento.key.toLowerCase();
      if (tecla === 'n') {
        evento.preventDefault();
        this.nuevo();
        return;
      }
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

    if (evento.ctrlKey && evento.key === 'Enter' && this.modalAbierto()) {
      if (this.form.invalid || this.guardando()) return;
      evento.preventDefault();
      this.guardar();
    }
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    if (this.guardando()) return;

    const valor = this.form.getRawValue();
    const payload = {
      ...valor,
      clave: valor.clave.trim(),
      nombre: valor.nombre.trim(),
    };
    const regimenOriginal = this.regimenEnEdicion();
    const esEdicion = regimenOriginal !== null;

    this.guardando.set(true);

    // Mandato 85: no permitir cambiar la clave de un régimen que ya usan
    // clientes -- como Cliente guarda la clave como texto (sin FK real),
    // cambiarla dejaría a esos clientes apuntando a un valor que ya no
    // existe en el catálogo, sin que la base de datos lo impida.
    if (regimenOriginal !== null && regimenOriginal.clave !== payload.clave) {
      const claveAnterior = regimenOriginal.clave;
      this.contarClientesConClave(claveAnterior).subscribe({
        next: (total) => {
          if (total > 0) {
            this.guardando.set(false);
            this.toast.advertencia(`No se puede cambiar la clave: ${total} cliente(s) la están usando actualmente.`);
            return;
          }
          this.ejecutarGuardado(payload, esEdicion);
        },
        error: () => this.guardando.set(false),
      });
      return;
    }

    this.ejecutarGuardado(payload, esEdicion);
  }

  private ejecutarGuardado(
    payload: { id: number; clave: string; nombre: string; activo: boolean },
    esEdicion: boolean,
  ): void {
    const peticion = esEdicion
      ? this.data.modificacion<RegimenFiscal>('RegimenFiscal', payload)
      : this.data.alta<RegimenFiscal>('RegimenFiscal', payload);

    peticion.subscribe({
      next: () => {
        this.guardando.set(false);
        this.toast.exito(esEdicion ? 'Régimen actualizado.' : 'Régimen creado.');
        this.cerrarModal();
        if (this.haBuscado()) this.cargar();
      },
      error: () => this.guardando.set(false),
    });
  }

  // ── Eliminación ───────────────────────────────────────────────────────

  pedirEliminar(regimen: RegimenFiscal): void {
    this.contarClientesConClave(regimen.clave).subscribe((total) => {
      if (total > 0) {
        this.toast.advertencia(`No se puede eliminar: ${total} cliente(s) usan esta clave.`);
        return;
      }
      this.regimenAEliminar.set(regimen);
    });
  }

  confirmarEliminar(): void {
    const regimen = this.regimenAEliminar();
    if (!regimen) return;
    this.data.baja('RegimenFiscal', regimen.id).subscribe({
      next: () => {
        this.toast.exito('Régimen eliminado.');
        this.regimenAEliminar.set(null);
        if (this.regimenesPagina().length === 1 && this.paginaActual() > 1) {
          this.paginaActual.update((p) => p - 1);
        }
        if (this.haBuscado()) this.cargar();
      },
    });
  }
}

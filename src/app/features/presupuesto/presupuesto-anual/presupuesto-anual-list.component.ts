import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { DataClientService } from '../../../core/services/data-client.service';
import { BitacoraComponent } from '../../../shared/components/bitacora/bitacora.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { BitacoraService } from '../../../shared/services/bitacora.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { ToastService } from '../../../shared/services/toast.service';
import { exportarCsv } from '../../../shared/utils/csv.util';
import { ValorLista } from '../../../shared/valor-lista/valor-lista.model';
import { PresupuestoAnual } from './presupuesto-anual.model';

const MODULO_BITACORA = 'Catálogos / Presupuesto por año';
const ENTIDAD = 'PresupuestoAnual';
const GRUPO_ESTATUS = 'PresupuestoAnualEstatus';
const ESTATUS_BLOQUEA = ['Autorizado', 'Ejecutado'];

function hoyTexto(): string {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
}

/**
 * Catálogo "Presupuesto por año" (Presupuesto Personal, compartido entre
 * todos los usuarios) — lleva el control de en qué etapa está el
 * presupuesto de cada año: Creación → Proyección → Autorizado → Ejecutado
 * (o cualquier estatus nuevo que se agregue en Catálogos → Estatus de
 * presupuesto anual). Cuando un año queda Autorizado o Ejecutado, la
 * pantalla de Proyección deja de permitir editar a mano sus celdas de ese
 * año (ver aniosBloqueados en proyeccion.component.ts) — ya se
 * revisó/aprobó y no debería seguir moviéndose.
 */
@Component({
  selector: 'app-presupuesto-anual-list',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, BitacoraComponent],
  templateUrl: './presupuesto-anual-list.component.html',
  styleUrl: './presupuesto-anual-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PresupuestoAnualListComponent implements OnInit, OnDestroy {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly bitacora = inject(BitacoraService);
  private readonly auth = inject(AuthService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);

  protected readonly registrosTodos = signal<PresupuestoAnual[]>([]);
  protected readonly estatus = signal<ValorLista[]>([]);
  protected readonly cargando = signal(false);
  protected readonly busqueda = signal('');

  protected readonly mostrarInactivos = signal(false);

  protected readonly registros = computed(() => {
    const texto = this.busqueda().trim().toLowerCase();
    const todos = [...this.registrosTodos()]
      .filter((r) => this.mostrarInactivos() || r.activo !== false)
      .sort((a, b) => b.anio - a.anio);
    if (!texto) return todos;
    return todos.filter((r) => String(r.anio).includes(texto) || r.descripcion.toLowerCase().includes(texto));
  });

  protected readonly modalAbierto = signal(false);
  protected readonly registroEnEdicion = signal<PresupuestoAnual | null>(null);
  protected readonly registroAEliminar = signal<PresupuestoAnual | null>(null);

  protected readonly columnas: ColumnaTabla<PresupuestoAnual>[] = [
    { campo: 'anio', etiqueta: 'Año', formatear: (r) => `Año ${r.anio}` },
    {
      campo: 'estatusClave',
      etiqueta: 'Estatus',
      formatear: (r) => this.etiquetaEstatus(r.estatusClave),
      claseValor: (r) => (ESTATUS_BLOQUEA.includes(r.estatusClave) ? 'grid-badge-success' : 'grid-badge-neutral'),
    },
    { campo: 'descripcion', etiqueta: 'Descripción' },
    { campo: 'fechaAlta', etiqueta: 'Fecha alta' },
    {
      campo: 'activo',
      etiqueta: 'Activo',
      formatear: (r) => (r.activo !== false ? 'Sí' : 'No'),
      claseValor: (r) => (r.activo !== false ? 'grid-badge-success' : 'grid-badge-muted'),
    },
  ];

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    anio: [new Date().getFullYear(), [Validators.required, Validators.min(2000), Validators.max(2100)]],
    fechaAlta: [hoyTexto(), Validators.required],
    descripcion: ['', [Validators.required, Validators.maxLength(200)]],
    estatusClave: ['', Validators.required],
    activo: [true],
  });

  ngOnInit(): void {
    // Catálogo angosto atrapado en el ancho de lectura de 980px — usa el
    // ancho "wide" del layout para aprovechar mejor el espacio (ver
    // html[data-wide='grid'] en styles.scss, mismo patrón que Movimientos).
    document.documentElement.setAttribute('data-wide', 'grid');
    this.data.list<ValorLista>('ValorLista', { grupo: GRUPO_ESTATUS }).subscribe((valores) =>
      this.estatus.set(valores.filter((v) => v.grupo === GRUPO_ESTATUS).sort((a, b) => a.orden - b.orden)),
    );
    this.cargar();
  }

  etiquetaEstatus(clave: string): string {
    return this.estatus().find((e) => e.clave === clave)?.etiqueta ?? clave;
  }

  cargar(): void {
    this.cargando.set(true);
    this.data.list<PresupuestoAnual>(ENTIDAD).subscribe({
      next: (registros) => {
        this.registrosTodos.set(registros);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  /** Mientras la Descripción siga vacía o siga siendo el default "Año N" de
   *  un año anterior, la refresca sola al cambiar el Año — así se parece al
   *  patrón del catálogo original (descripción = "AÑO 2027" por defecto),
   *  sin pisarla si el usuario ya escribió algo propio. */
  onAnioChange(): void {
    const anio = this.form.controls.anio.value;
    const actual = this.form.controls.descripcion.value.trim();
    const esDefaultAnterior = /^Año \d+$/.test(actual);
    if (!actual || esDefaultAnterior) {
      this.form.controls.descripcion.setValue(`Año ${anio}`);
    }
  }

  nuevo(): void {
    this.registroEnEdicion.set(null);
    const anio = new Date().getFullYear();
    const primerEstatus = this.estatus()[0]?.clave ?? '';
    this.form.reset({ id: 0, anio, fechaAlta: hoyTexto(), descripcion: `Año ${anio}`, estatusClave: primerEstatus, activo: true });
    this.modalAbierto.set(true);
  }

  editar(registro: PresupuestoAnual): void {
    this.registroEnEdicion.set(registro);
    this.form.reset({
      id: registro.id,
      anio: registro.anio,
      fechaAlta: registro.fechaAlta,
      descripcion: registro.descripcion,
      estatusClave: registro.estatusClave,
      activo: registro.activo !== false,
    });
    this.modalAbierto.set(true);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toast.error('Captura año, fecha alta, descripción y estatus.');
      return;
    }

    const valor = this.form.getRawValue();
    const registroPrevio = this.registroEnEdicion();
    const esEdicion = registroPrevio !== null;
    const usuarioActual = this.auth.usuarioActual()?.nombreUsuario ?? 'Sistema';

    const yaExiste = this.registrosTodos().some((r) => r.anio === valor.anio && r.id !== valor.id);
    if (yaExiste) {
      this.toast.error(`Ya existe un registro para el año ${valor.anio}.`);
      return;
    }

    const peticion = esEdicion
      ? this.data.modificacion<PresupuestoAnual>(ENTIDAD, valor)
      : this.data.alta<PresupuestoAnual>(ENTIDAD, valor);

    peticion.subscribe({
      next: (resultado) => {
        this.bitacora
          .registrar({
            modulo: MODULO_BITACORA,
            entidad: ENTIDAD,
            accion: esEdicion ? 'Modificación' : 'Alta',
            usuario: usuarioActual,
            registroId: resultado.id,
            anterior: registroPrevio as unknown as Record<string, unknown> | null,
            actual: resultado as unknown as Record<string, unknown>,
          })
          .subscribe();
        this.toast.exito(esEdicion ? 'Presupuesto anual actualizado.' : 'Presupuesto anual creado.');
        this.modalAbierto.set(false);
        this.cargar();
      },
      error: () => this.toast.error('No se pudo guardar. Intenta de nuevo.'),
    });
  }

  exportarCsvArchivo(): void {
    const filas = this.registros();
    exportarCsv(
      'presupuesto-anual.csv',
      [
        { clave: 'anio', etiqueta: 'Año' },
        { clave: 'estatus', etiqueta: 'Estatus' },
        { clave: 'descripcion', etiqueta: 'Descripción' },
        { clave: 'fechaAlta', etiqueta: 'Fecha alta' },
      ],
      filas.map((f) => ({ anio: f.anio, estatus: this.etiquetaEstatus(f.estatusClave), descripcion: f.descripcion, fechaAlta: f.fechaAlta })),
    );
    this.toast.exito(`Se descargó presupuesto-anual.csv (${filas.length} registro${filas.length === 1 ? '' : 's'}).`);
  }

  pedirEliminar(registro: PresupuestoAnual): void {
    this.registroAEliminar.set(registro);
  }

  confirmarEliminar(): void {
    const registro = this.registroAEliminar();
    if (!registro) return;

    this.data.baja(ENTIDAD, registro.id).subscribe({
      next: () => {
        this.bitacora
          .registrar({
            modulo: MODULO_BITACORA,
            entidad: ENTIDAD,
            accion: 'Baja',
            usuario: this.auth.usuarioActual()?.nombreUsuario ?? 'Sistema',
            registroId: registro.id,
            anterior: registro as unknown as Record<string, unknown>,
            actual: null,
          })
          .subscribe();
        this.toast.exito('Presupuesto anual eliminado.');
        this.registroAEliminar.set(null);
        this.cargar();
      },
      error: () => this.toast.error('No se pudo eliminar. Intenta de nuevo.'),
    });
  }


  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }
}

import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
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
import { CuentaPresupuesto, TipoCuentaPresupuesto } from './cuenta-presupuesto.model';
import { ValorLista } from '../../catalogos/valor-lista/valor-lista.model';

const MODULO_BITACORA = 'Catálogos / Cuentas de presupuesto';
const ENTIDAD = 'CuentaPresupuesto';
const GRUPO_VALOR_LISTA = 'CuentaPresupuestoTipo';
// Iconos best-effort para los tipos ya conocidos; cualquier tipo nuevo que
// se agregue desde "Listas de valores" cae en el emoji genérico de abajo.
const ICONOS_TIPO_CONOCIDOS: Record<string, string> = { Efectivo: '💵', Banco: '🏦', Tarjeta: '💳', Ahorro: '🐷' };

/**
 * Catálogo "Cuentas de presupuesto" (Presupuesto Personal) — mismo estándar
 * que Usuarios. Cuando el tipo es "Tarjeta" se piden además los campos de
 * tarjeta de crédito (límite, día de corte/pago, pago mínimo/sin intereses),
 * necesarios para el Calendario de pagos.
 */
@Component({
  selector: 'app-cuenta-presupuesto-list',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, BitacoraComponent],
  templateUrl: './cuenta-presupuesto-list.component.html',
  styleUrl: './cuenta-presupuesto-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CuentaPresupuestoListComponent implements OnInit {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly bitacora = inject(BitacoraService);
  private readonly auth = inject(AuthService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);

  protected readonly tipos = signal<ValorLista[]>([]);
  protected readonly iconoTipo = (tipo: string) => ICONOS_TIPO_CONOCIDOS[tipo] ?? '💰';

  protected readonly registrosTodos = signal<CuentaPresupuesto[]>([]);
  protected readonly cargando = signal(false);
  protected readonly busqueda = signal('');

  protected readonly mostrarInactivos = signal(false);

  protected readonly registros = computed(() => {
    const texto = this.busqueda().trim().toLowerCase();
    const base = this.registrosTodos().filter((r) => this.mostrarInactivos() || r.activo !== false);
    if (!texto) return base;
    return base.filter((r) => r.nombre.toLowerCase().includes(texto));
  });

  protected readonly modalAbierto = signal(false);
  protected readonly registroEnEdicion = signal<CuentaPresupuesto | null>(null);
  protected readonly registroAEliminar = signal<CuentaPresupuesto | null>(null);

  protected readonly columnas: ColumnaTabla<CuentaPresupuesto>[] = [
    { campo: 'nombre', etiqueta: 'Nombre', formatear: (r) => `${this.iconoTipo(r.tipo)} ${r.nombre}` },
    { campo: 'tipo', etiqueta: 'Tipo' },
    {
      campo: 'limiteCredito',
      etiqueta: 'Tarjeta',
      formatear: (r) =>
        r.tipo === 'Tarjeta'
          ? `Corte día ${r.diaCorte ?? '—'} · Pago día ${r.diaPago ?? '—'}`
          : '—',
    },
    {
      campo: 'activo',
      etiqueta: 'Activo',
      formatear: (r) => (r.activo !== false ? 'Sí' : 'No'),
      claseValor: (r) => (r.activo !== false ? 'grid-badge-success' : 'grid-badge-muted'),
    },
  ];

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    nombre: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(60)]],
    tipo: ['Efectivo' as TipoCuentaPresupuesto, Validators.required],
    limiteCredito: [null as number | null],
    diaCorte: [null as number | null],
    diaPago: [null as number | null],
    pagoMinimo: [null as number | null],
    pagoSinIntereses: [null as number | null],
    activo: [true],
  });

  protected get esTarjeta(): boolean {
    return this.form.controls.tipo.value === 'Tarjeta';
  }

  ngOnInit(): void {
    this.cargar();
    this.data.list<ValorLista>('ValorLista', { grupo: GRUPO_VALOR_LISTA }).subscribe({
      next: (valores) =>
        this.tipos.set(valores.filter((v) => v.grupo === GRUPO_VALOR_LISTA).sort((a, b) => a.orden - b.orden)),
      error: () => this.toast.error('No se pudieron cargar los tipos de cuenta.'),
    });
  }

  cargar(): void {
    this.cargando.set(true);
    this.data.list<CuentaPresupuesto>(ENTIDAD).subscribe({
      next: (registros) => {
        this.registrosTodos.set(registros);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  nuevo(): void {
    this.registroEnEdicion.set(null);
    this.form.reset({
      id: 0,
      nombre: '',
      tipo: 'Efectivo',
      limiteCredito: null,
      diaCorte: null,
      diaPago: null,
      pagoMinimo: null,
      pagoSinIntereses: null,
      activo: true,
    });
    this.modalAbierto.set(true);
  }

  editar(registro: CuentaPresupuesto): void {
    this.registroEnEdicion.set(registro);
    this.form.reset({
      id: registro.id,
      nombre: registro.nombre,
      tipo: registro.tipo,
      limiteCredito: registro.limiteCredito,
      diaCorte: registro.diaCorte,
      diaPago: registro.diaPago,
      pagoMinimo: registro.pagoMinimo,
      pagoSinIntereses: registro.pagoSinIntereses,
      activo: registro.activo !== false,
    });
    this.modalAbierto.set(true);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toast.error('Captura un nombre de al menos 2 caracteres y selecciona un tipo.');
      return;
    }

    const valor = this.form.getRawValue();
    const registroPrevio = this.registroEnEdicion();
    const esEdicion = registroPrevio !== null;
    const usuarioActual = this.auth.usuarioActual()?.nombreUsuario ?? 'Sistema';

    const nombreNuevo = valor.nombre.trim().toLowerCase();
    const yaExiste = this.registrosTodos().some(
      (r) => r.nombre.trim().toLowerCase() === nombreNuevo && r.id !== valor.id,
    );
    if (yaExiste) {
      this.toast.error('Ya existe una cuenta con ese nombre.');
      return;
    }

    // Los campos de tarjeta solo tienen sentido cuando tipo = 'Tarjeta'; para
    // cualquier otro tipo se guardan en null aunque el usuario los haya
    // llenado antes de cambiar el tipo (evita datos fantasma inconsistentes).
    const esTarjeta = valor.tipo === 'Tarjeta';
    const dto: CuentaPresupuesto = {
      ...valor,
      limiteCredito: esTarjeta ? valor.limiteCredito : null,
      diaCorte: esTarjeta ? valor.diaCorte : null,
      diaPago: esTarjeta ? valor.diaPago : null,
      pagoMinimo: esTarjeta ? valor.pagoMinimo : null,
      pagoSinIntereses: esTarjeta ? valor.pagoSinIntereses : null,
    };

    const peticion = esEdicion
      ? this.data.modificacion<CuentaPresupuesto>(ENTIDAD, dto)
      : this.data.alta<CuentaPresupuesto>(ENTIDAD, dto);

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
        this.toast.exito(esEdicion ? 'Cuenta actualizada.' : 'Cuenta creada.');
        this.modalAbierto.set(false);
        this.cargar();
      },
      error: () => this.toast.error('No se pudo guardar la cuenta. Intenta de nuevo.'),
    });
  }

  exportarCsvArchivo(): void {
    const filas = this.registros();
    exportarCsv(
      'cuentas-presupuesto.csv',
      [
        { clave: 'nombre', etiqueta: 'Nombre' },
        { clave: 'tipo', etiqueta: 'Tipo' },
        { clave: 'diaCorte', etiqueta: 'Día de corte' },
        { clave: 'diaPago', etiqueta: 'Día de pago' },
      ],
      filas.map((f) => ({ ...f })),
    );
    this.toast.exito(`Se descargó cuentas-presupuesto.csv (${filas.length} registro${filas.length === 1 ? '' : 's'}).`);
  }

  /** No deja eliminar una cuenta con movimientos/recurrentes que la usen. */
  pedirEliminar(registro: CuentaPresupuesto): void {
    this.data.list<{ id: number }>('MovimientoPresupuesto', { cuentaPresupuestoId: registro.id }).subscribe((movimientos) => {
      this.data.list<{ id: number }>('MovimientoRecurrentePresupuesto', { cuentaPresupuestoId: registro.id }).subscribe((recurrentes) => {
        const total = movimientos.length + recurrentes.length;
        if (total > 0) {
          this.toast.advertencia(`No se puede eliminar: ${total} registro${total === 1 ? '' : 's'} de Presupuesto usa${total === 1 ? '' : 'n'} esta cuenta.`);
          return;
        }
        this.registroAEliminar.set(registro);
      });
    });
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
        this.toast.exito('Cuenta eliminada.');
        this.registroAEliminar.set(null);
        this.cargar();
      },
      error: () => this.toast.error('No se pudo eliminar la cuenta. Intenta de nuevo.'),
    });
  }
}

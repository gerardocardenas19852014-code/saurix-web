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
import { ValorLista } from './valor-lista.model';

const MODULO_BITACORA = 'Catálogos / Listas de valores';
const ENTIDAD = 'ValorLista';

/** Nombres amigables para los grupos que ya usa el propio sistema (aparecen
 *  primero y con etiqueta bonita); cualquier grupo nuevo que el usuario cree
 *  aparece igual, mostrando su clave tal cual — sobre demanda, sin tocar
 *  código para agregar un grupo nuevo. */
const ETIQUETAS_GRUPO: Record<string, string> = {
  CuentaPresupuestoTipo: 'Tipo de cuenta · Presupuesto Personal',
  MovimientoPresupuestoTipo: 'Tipo de movimiento · Presupuesto Personal',
  MovimientoRecurrenteFrecuencia: 'Frecuencia de fijos · Presupuesto Personal',
  ConfiguracionConexionProveedor: 'Proveedor de conexión · Panel de Control',
};

/**
 * "Listas de valores": catálogo genérico para todos los combos de
 * estado/tipo que antes estaban fijos en el código. Cada fila pertenece a
 * un "Grupo"; las pantallas que antes traían un arreglo fijo de opciones
 * ahora leen `GetList('ValorLista', {grupo: '...'})`. Los grupos no son un
 * catálogo aparte: se descubren solos a partir de esta misma tabla, y basta
 * con crear el primer valor de un grupo nuevo para que ese grupo empiece a
 * existir — inteligente, intuitivo y sobre demanda.
 */
@Component({
  selector: 'app-valor-lista-list',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, BitacoraComponent],
  templateUrl: './valor-lista-list.component.html',
  styleUrl: './valor-lista-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ValorListaListComponent implements OnInit {
  private readonly data = inject(DataClientService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly bitacora = inject(BitacoraService);
  private readonly auth = inject(AuthService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);

  protected readonly etiquetaGrupo = (grupo: string) => ETIQUETAS_GRUPO[grupo] ?? grupo;

  protected readonly registrosTodos = signal<ValorLista[]>([]);
  protected readonly cargando = signal(false);
  protected readonly grupoSeleccionado = signal<string>('');
  protected readonly grupoNuevoTexto = signal('');

  protected readonly gruposDisponibles = computed(() => {
    const claves = new Set(this.registrosTodos().map((r) => r.grupo));
    // Los grupos conocidos por el sistema aparecen siempre, aunque todavía
    // no tengan ningún valor cargado (por si el sembrado inicial no corrió).
    for (const clave of Object.keys(ETIQUETAS_GRUPO)) claves.add(clave);
    return Array.from(claves).sort((a, b) => this.etiquetaGrupo(a).localeCompare(this.etiquetaGrupo(b)));
  });

  protected readonly registros = computed(() =>
    this.registrosTodos()
      .filter((r) => r.grupo === this.grupoSeleccionado())
      .sort((a, b) => a.orden - b.orden),
  );

  protected readonly columnas: ColumnaTabla<ValorLista>[] = [
    { campo: 'etiqueta', etiqueta: 'Etiqueta' },
    { campo: 'clave', etiqueta: 'Clave (valor guardado)' },
    { campo: 'orden', etiqueta: 'Orden' },
  ];

  protected readonly modalAbierto = signal(false);
  protected readonly registroEnEdicion = signal<ValorLista | null>(null);
  protected readonly registroAEliminar = signal<ValorLista | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    grupo: [''],
    clave: ['', [Validators.required, Validators.minLength(1), Validators.maxLength(60)]],
    etiqueta: ['', [Validators.required, Validators.minLength(1), Validators.maxLength(80)]],
    orden: [1, [Validators.required, Validators.min(1)]],
  });

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.data.list<ValorLista>(ENTIDAD).subscribe({
      next: (registros) => {
        this.registrosTodos.set(registros);
        this.cargando.set(false);
        if (!this.grupoSeleccionado() && this.gruposDisponibles().length) {
          this.grupoSeleccionado.set(this.gruposDisponibles()[0]);
        }
      },
      error: () => this.cargando.set(false),
    });
  }

  cambiarGrupo(grupo: string): void {
    this.grupoSeleccionado.set(grupo);
  }

  /** Crear grupo "sobre demanda": no hace falta darlo de alta aparte, solo
   *  se selecciona su nombre y se abre el formulario para su primer valor. */
  crearGrupoNuevo(): void {
    const grupo = this.grupoNuevoTexto().trim();
    if (!grupo) return;
    if (this.gruposDisponibles().some((g) => g.toLowerCase() === grupo.toLowerCase())) {
      this.toast.advertencia('Ya existe un grupo con ese nombre.');
      return;
    }
    this.grupoSeleccionado.set(grupo);
    this.grupoNuevoTexto.set('');
    this.nuevo();
  }

  private siguienteOrden(): number {
    const ordenes = this.registros().map((r) => r.orden);
    return ordenes.length ? Math.max(...ordenes) + 1 : 1;
  }

  nuevo(): void {
    this.registroEnEdicion.set(null);
    this.form.reset({ id: 0, grupo: this.grupoSeleccionado(), clave: '', etiqueta: '', orden: this.siguienteOrden() });
    this.modalAbierto.set(true);
  }

  editar(registro: ValorLista): void {
    this.registroEnEdicion.set(registro);
    this.form.reset({ ...registro });
    this.modalAbierto.set(true);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toast.error('Captura clave, etiqueta y orden.');
      return;
    }

    const bruto = this.form.getRawValue();
    const valor = { ...bruto, grupo: bruto.grupo || this.grupoSeleccionado() };
    const registroPrevio = this.registroEnEdicion();
    const esEdicion = registroPrevio !== null;
    const usuarioActual = this.auth.usuarioActual()?.nombreUsuario ?? 'Sistema';

    const claveNueva = valor.clave.trim().toLowerCase();
    const yaExiste = this.registrosTodos().some(
      (r) => r.grupo === valor.grupo && r.clave.trim().toLowerCase() === claveNueva && r.id !== valor.id,
    );
    if (yaExiste) {
      this.toast.error('Ya existe un valor con esa clave en este grupo.');
      return;
    }

    const peticion = esEdicion
      ? this.data.modificacion<ValorLista>(ENTIDAD, valor)
      : this.data.alta<ValorLista>(ENTIDAD, valor);

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
        this.toast.exito(esEdicion ? 'Valor actualizado.' : 'Valor creado.');
        this.modalAbierto.set(false);
        this.cargar();
      },
      error: () => this.toast.error('No se pudo guardar el valor. Intenta de nuevo.'),
    });
  }

  pedirEliminar(registro: ValorLista): void {
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
        this.toast.exito('Valor eliminado.');
        this.registroAEliminar.set(null);
        this.cargar();
      },
      error: () => this.toast.error('No se pudo eliminar el valor. Intenta de nuevo.'),
    });
  }
}

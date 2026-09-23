import { Directive, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { DataClientService } from '../../../core/services/data-client.service';
import { ColumnaTabla } from '../../../shared/components/data-table/data-table.component';
import { BitacoraService } from '../../../shared/services/bitacora.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { ToastService } from '../../../shared/services/toast.service';
import { ValorLista } from './valor-lista.model';

const ENTIDAD = 'ValorLista';

/**
 * Logica compartida por las pantallas dedicadas de cada grupo de "Listas de
 * valores" (Tipo de cuenta, Tipo de movimiento, Frecuencia de fijos,
 * Proveedor de conexion): misma entidad ValorLista de siempre (sin cambios
 * de datos), pero cada grupo es su propio componente/ruta/menu — sin combo
 * para elegir el grupo ni pantalla generica compartida (esa pantalla,
 * ValorListaListComponent, se elimino del todo a pedido explicito).
 *
 * Si algun dia se necesita un grupo nuevo, se crea otro componente igual
 * de chico que estos (grupo/titulo/clavesProtegidas/moduloBitacora + su
 * ruta), no hace falta revivir el combo generico.
 *
 * Cada subclase concreta solo declara `grupo`/`tituloGrupo`/`clavesProtegidas`/
 * `moduloBitacora` y comparte esta logica + la misma plantilla
 * (valor-lista-grupo.component.html) via su propio @Component({templateUrl}).
 */
@Directive()
export abstract class ValorListaGrupoBase implements OnInit {
  protected readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  protected readonly fb = inject(FormBuilder);
  protected readonly bitacora = inject(BitacoraService);
  protected readonly auth = inject(AuthService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);

  /** Clave de grupo tal como se guarda en ValorLista.grupo — NO cambiar sin migrar los datos existentes. */
  protected abstract readonly grupo: string;
  /** Etiqueta amigable para el encabezado de la pantalla y los mensajes. */
  protected abstract readonly tituloGrupo: string;
  /** Claves que otras pantallas del sistema comparan tal cual en su lógica — no se pueden borrar ni renombrar, solo cambiar su Etiqueta. */
  protected abstract readonly clavesProtegidas: string[];
  /** Nombre de módulo para <app-bitacora>. */
  protected abstract readonly moduloBitacora: string;

  protected readonly registros = signal<ValorLista[]>([]);
  protected readonly cargando = signal(false);

  protected readonly columnas: ColumnaTabla<ValorLista>[] = [
    { campo: 'etiqueta', etiqueta: 'Etiqueta' },
    {
      campo: 'clave',
      etiqueta: 'Clave (valor guardado)',
      formatear: (r) => (this.esClaveProtegida(r) ? `🔒 ${r.clave}` : r.clave),
    },
    { campo: 'orden', etiqueta: 'Orden' },
  ];

  protected readonly modalAbierto = signal(false);
  protected readonly registroEnEdicion = signal<ValorLista | null>(null);
  protected readonly registroAEliminar = signal<ValorLista | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    clave: ['', [Validators.required, Validators.minLength(1), Validators.maxLength(60)]],
    etiqueta: ['', [Validators.required, Validators.minLength(1), Validators.maxLength(80)]],
    orden: [1, [Validators.required, Validators.min(1)]],
  });

  protected readonly claveBloqueada = computed(() => {
    const registro = this.registroEnEdicion();
    return !!registro && this.esClaveProtegida(registro);
  });

  protected esClaveProtegida(registro: ValorLista): boolean {
    return this.clavesProtegidas.includes(registro.clave);
  }

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.data.list<ValorLista>(ENTIDAD, { grupo: this.grupo }).subscribe({
      next: (registros) => {
        this.registros.set([...registros].filter((r) => r.grupo === this.grupo).sort((a, b) => a.orden - b.orden));
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  private siguienteOrden(): number {
    const ordenes = this.registros().map((r) => r.orden);
    return ordenes.length ? Math.max(...ordenes) + 1 : 1;
  }

  nuevo(): void {
    this.registroEnEdicion.set(null);
    this.form.reset({ id: 0, clave: '', etiqueta: '', orden: this.siguienteOrden() });
    this.form.controls.clave.enable();
    this.modalAbierto.set(true);
  }

  editar(registro: ValorLista): void {
    this.registroEnEdicion.set(registro);
    this.form.reset({ id: registro.id, clave: registro.clave, etiqueta: registro.etiqueta, orden: registro.orden });
    if (this.esClaveProtegida(registro)) {
      this.form.controls.clave.disable();
    } else {
      this.form.controls.clave.enable();
    }
    this.modalAbierto.set(true);
  }

  cerrarModal(): void {
    this.toast.info('Cambios descartados.');
    this.modalAbierto.set(false);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toast.error('Captura clave, etiqueta y orden.');
      return;
    }

    const bruto = this.form.getRawValue();
    const valor = { ...bruto, grupo: this.grupo };
    const registroPrevio = this.registroEnEdicion();
    const esEdicion = registroPrevio !== null;
    const usuarioActual = this.auth.usuarioActual()?.nombreUsuario ?? 'Sistema';

    const claveNueva = valor.clave.trim().toLowerCase();
    const yaExiste = this.registros().some((r) => r.clave.trim().toLowerCase() === claveNueva && r.id !== valor.id);
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
            modulo: this.moduloBitacora,
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
    if (this.esClaveProtegida(registro)) {
      this.toast.advertencia(
        `"${registro.etiqueta}" lo usan otras pantallas del sistema y no se puede eliminar. Puedes cambiar su Etiqueta si quieres.`,
      );
      return;
    }
    this.registroAEliminar.set(registro);
  }

  confirmarEliminar(): void {
    const registro = this.registroAEliminar();
    if (!registro) return;

    this.data.baja(ENTIDAD, registro.id).subscribe({
      next: () => {
        this.bitacora
          .registrar({
            modulo: this.moduloBitacora,
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

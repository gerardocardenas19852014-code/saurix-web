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
import { TipoSistema } from './tipo-sistema.model';

const MODULO_BITACORA = 'WikiDocs / Tipo de sistema';
const ENTIDAD = 'TipoSistema';

/**
 * Catálogo "Tipo de sistema" (raíz de la jerarquía documental de WikiDocs:
 * TipoSistema → Categoria → Sección → Documento) — mismo estándar que
 * Usuarios (Seguridad): data-table + Bitácora con filtros/CSV + búsqueda +
 * exportar CSV + confirm-dialog para eliminar + estilo Bootstrap.
 */
@Component({
  selector: 'app-tipo-sistema-list',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, BitacoraComponent],
  templateUrl: './tipo-sistema-list.component.html',
  styleUrl: './tipo-sistema-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TipoSistemaListComponent implements OnInit {
  private readonly data = inject(DataClientService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly bitacora = inject(BitacoraService);
  private readonly auth = inject(AuthService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);

  protected readonly registrosTodos = signal<TipoSistema[]>([]);
  protected readonly cargando = signal(false);
  protected readonly busqueda = signal('');

  protected readonly registros = computed(() => {
    const texto = this.busqueda().trim().toLowerCase();
    if (!texto) return this.registrosTodos();
    return this.registrosTodos().filter((r) => r.nombre.toLowerCase().includes(texto));
  });

  protected readonly modalAbierto = signal(false);
  protected readonly registroEnEdicion = signal<TipoSistema | null>(null);
  protected readonly registroAEliminar = signal<TipoSistema | null>(null);

  protected readonly columnas: ColumnaTabla<TipoSistema>[] = [{ campo: 'nombre', etiqueta: 'Nombre' }];

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    nombre: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(60)]],
  });

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.data.list<TipoSistema>(ENTIDAD).subscribe({
      next: (registros) => {
        this.registrosTodos.set(registros);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  nuevo(): void {
    this.registroEnEdicion.set(null);
    this.form.reset({ id: 0, nombre: '' });
    this.modalAbierto.set(true);
  }

  editar(registro: TipoSistema): void {
    this.registroEnEdicion.set(registro);
    this.form.reset({ id: registro.id, nombre: registro.nombre });
    this.modalAbierto.set(true);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toast.error('Captura un nombre de al menos 2 caracteres.');
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
      this.toast.error('Ya existe un tipo de sistema con ese nombre.');
      return;
    }

    const peticion = esEdicion
      ? this.data.modificacion<TipoSistema>(ENTIDAD, valor)
      : this.data.alta<TipoSistema>(ENTIDAD, valor);

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
        this.toast.exito(esEdicion ? 'Tipo de sistema actualizado.' : 'Tipo de sistema creado.');
        this.modalAbierto.set(false);
        this.cargar();
      },
      error: () => this.toast.error('No se pudo guardar el tipo de sistema. Intenta de nuevo.'),
    });
  }

  exportarCsvArchivo(): void {
    const filas = this.registros();
    exportarCsv(
      'tipos-de-sistema.csv',
      [{ clave: 'nombre', etiqueta: 'Nombre' }],
      filas.map((f) => ({ ...f })),
    );
    this.toast.exito(`Se descargó tipos-de-sistema.csv (${filas.length} registro${filas.length === 1 ? '' : 's'}).`);
  }

  /** No deja eliminar un tipo de sistema que ya tenga categorías apuntándole
   *  (evita dejar categorías huérfanas con un tipoSistemaId inexistente). */
  pedirEliminar(registro: TipoSistema): void {
    this.data.list<{ id: number }>('Categoria', { tipoSistemaId: registro.id }).subscribe((dependientes) => {
      if (dependientes.length > 0) {
        this.toast.advertencia(
          `No se puede eliminar: ${dependientes.length} categoría${dependientes.length === 1 ? '' : 's'} usa${dependientes.length === 1 ? '' : 'n'} este tipo de sistema.`,
        );
        return;
      }
      this.registroAEliminar.set(registro);
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
        this.toast.exito('Tipo de sistema eliminado.');
        this.registroAEliminar.set(null);
        this.cargar();
      },
      error: () => this.toast.error('No se pudo eliminar el tipo de sistema. Intenta de nuevo.'),
    });
  }
}

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
import { TipoSistema } from '../tipo-sistema/tipo-sistema.model';
import { Categoria } from './categoria.model';

const MODULO_BITACORA = 'WikiDocs / Categoría';
const ENTIDAD = 'Categoria';

/**
 * Catálogo "Categoría" (WikiDocs) — Categoria exige el Id del Tipo de
 * sistema padre para listar (FK padre obligatorio, igual que
 * TableroColumna en Proyectos): primero se elige el tipo de sistema y solo
 * entonces se cargan/crean sus categorías. El tipoSistemaId NO se pide en
 * el formulario del modal — se toma del selector de arriba, igual que
 * TablerosComponent toma el proyectoId de su propio selector.
 */
@Component({
  selector: 'app-categoria-list',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, BitacoraComponent],
  templateUrl: './categoria-list.component.html',
  styleUrl: './categoria-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategoriaListComponent implements OnInit {
  private readonly data = inject(DataClientService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly bitacora = inject(BitacoraService);
  private readonly auth = inject(AuthService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);

  protected readonly tiposSistema = signal<TipoSistema[]>([]);
  protected readonly tipoSistemaSeleccionadoId = signal<number>(0);

  protected readonly registrosTodos = signal<Categoria[]>([]);
  protected readonly cargando = signal(false);
  protected readonly busqueda = signal('');

  protected readonly registros = computed(() => {
    const texto = this.busqueda().trim().toLowerCase();
    if (!texto) return this.registrosTodos();
    return this.registrosTodos().filter((r) => r.nombre.toLowerCase().includes(texto));
  });

  protected readonly modalAbierto = signal(false);
  protected readonly registroEnEdicion = signal<Categoria | null>(null);
  protected readonly registroAEliminar = signal<Categoria | null>(null);

  protected readonly columnas: ColumnaTabla<Categoria>[] = [{ campo: 'nombre', etiqueta: 'Nombre' }];

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    nombre: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
  });

  ngOnInit(): void {
    this.data.list<TipoSistema>('TipoSistema').subscribe({
      next: (tipos) => {
        this.tiposSistema.set(tipos);
        if (tipos.length) {
          this.tipoSistemaSeleccionadoId.set(tipos[0].id);
          this.cargar();
        }
      },
      error: () => this.toast.error('No se pudieron cargar los tipos de sistema.'),
    });
  }

  cambiarTipoSistema(idTexto: string): void {
    this.tipoSistemaSeleccionadoId.set(Number(idTexto));
    this.cargar();
  }

  cargar(): void {
    const tipoSistemaId = this.tipoSistemaSeleccionadoId();
    if (!tipoSistemaId) {
      this.registrosTodos.set([]);
      return;
    }

    this.cargando.set(true);
    this.data.list<Categoria>(ENTIDAD, { tipoSistemaId }).subscribe({
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

  editar(registro: Categoria): void {
    this.registroEnEdicion.set(registro);
    this.form.reset({ id: registro.id, nombre: registro.nombre });
    this.modalAbierto.set(true);
  }

  guardar(): void {
    const tipoSistemaId = this.tipoSistemaSeleccionadoId();
    if (this.form.invalid || !tipoSistemaId) {
      this.form.markAllAsTouched();
      this.toast.error('Captura el nombre y selecciona un tipo de sistema.');
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
      this.toast.error('Ya existe una categoría con ese nombre en este tipo de sistema.');
      return;
    }

    const dto: Categoria = { ...valor, tipoSistemaId };

    const peticion = esEdicion
      ? this.data.modificacion<Categoria>(ENTIDAD, dto)
      : this.data.alta<Categoria>(ENTIDAD, dto);

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
        this.toast.exito(esEdicion ? 'Categoría actualizada.' : 'Categoría creada.');
        this.modalAbierto.set(false);
        this.cargar();
      },
      error: () => this.toast.error('No se pudo guardar la categoría. Intenta de nuevo.'),
    });
  }

  exportarCsvArchivo(): void {
    const filas = this.registros();
    const tipoNombre = this.tiposSistema().find((t) => t.id === this.tipoSistemaSeleccionadoId())?.nombre ?? '';
    exportarCsv(
      'categorias.csv',
      [
        { clave: 'nombre', etiqueta: 'Nombre' },
        { clave: 'tipoSistemaNombre', etiqueta: 'Tipo de sistema' },
      ],
      filas.map((f) => ({ nombre: f.nombre, tipoSistemaNombre: tipoNombre })),
    );
    this.toast.exito(`Se descargó categorias.csv (${filas.length} registro${filas.length === 1 ? '' : 's'}).`);
  }

  /** No deja eliminar una categoría que ya tenga secciones apuntándole
   *  (evita dejar secciones huérfanas con un categoriaId inexistente). */
  pedirEliminar(registro: Categoria): void {
    this.data.list<{ id: number }>('Seccion', { categoriaId: registro.id }).subscribe((dependientes) => {
      if (dependientes.length > 0) {
        this.toast.advertencia(
          `No se puede eliminar: ${dependientes.length} sección${dependientes.length === 1 ? '' : 'es'} usa${dependientes.length === 1 ? '' : 'n'} esta categoría.`,
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
        this.toast.exito('Categoría eliminada.');
        this.registroAEliminar.set(null);
        this.cargar();
      },
      error: () => this.toast.error('No se pudo eliminar la categoría. Intenta de nuevo.'),
    });
  }
}

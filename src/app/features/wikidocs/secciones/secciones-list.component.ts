import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { DataClientService } from '../../../core/services/data-client.service';
import { BitacoraComponent } from '../../../shared/components/bitacora/bitacora.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { BitacoraService } from '../../../shared/services/bitacora.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { ToastService } from '../../../shared/services/toast.service';
import { exportarCsv } from '../../../shared/utils/csv.util';
import { Categoria } from '../categoria/categoria.model';
import { TipoSistema } from '../tipo-sistema/tipo-sistema.model';
import { Seccion } from './seccion.model';

const MODULO_BITACORA = 'WikiDocs / Secciones';
const ENTIDAD = 'Seccion';

/**
 * Catálogo "Secciones" (WikiDocs) — Sección exige el Id de la Categoría
 * padre para listar (FK padre obligatorio), y Categoría a su vez exige el
 * Id del Tipo de sistema. Por eso la pantalla encadena dos selectores
 * (Tipo de sistema → Categoría) antes de mostrar/administrar sus
 * secciones, igual que TablerosComponent con su selector de Proyecto.
 * Incluye un acceso directo "Ver documentos" hacia el listado de
 * documentos de esa sección.
 */
@Component({
  selector: 'app-secciones-list',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, BitacoraComponent],
  templateUrl: './secciones-list.component.html',
  styleUrl: './secciones-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SeccionesListComponent implements OnInit {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly bitacora = inject(BitacoraService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);

  protected readonly tiposSistema = signal<TipoSistema[]>([]);
  protected readonly tipoSistemaSeleccionadoId = signal<number>(0);
  protected readonly categoriasTodas = signal<Categoria[]>([]);
  protected readonly categoriaSeleccionadaId = signal<number>(0);

  protected readonly categoriasDelTipo = computed(() =>
    this.categoriasTodas().filter((c) => c.tipoSistemaId === this.tipoSistemaSeleccionadoId()),
  );

  protected readonly registrosTodos = signal<Seccion[]>([]);
  protected readonly cargando = signal(false);
  protected readonly busqueda = signal('');

  protected readonly registros = computed(() => {
    const texto = this.busqueda().trim().toLowerCase();
    if (!texto) return this.registrosTodos();
    return this.registrosTodos().filter((r) => r.nombre.toLowerCase().includes(texto));
  });

  protected readonly modalAbierto = signal(false);
  protected readonly registroEnEdicion = signal<Seccion | null>(null);
  protected readonly registroAEliminar = signal<Seccion | null>(null);

  protected readonly columnas: ColumnaTabla<Seccion>[] = [{ campo: 'nombre', etiqueta: 'Nombre' }];

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    nombre: ['', [Validators.required, Validators.minLength(1), Validators.maxLength(120)]],
  });

  ngOnInit(): void {
    this.data.list<TipoSistema>('TipoSistema').subscribe({
      next: (tipos) => {
        this.tiposSistema.set(tipos);
        if (tipos.length) this.tipoSistemaSeleccionadoId.set(tipos[0].id);
      },
      error: () => this.toast.error('No se pudieron cargar los tipos de sistema.'),
    });
    this.data.list<Categoria>('Categoria').subscribe({
      next: (categorias) => {
        this.categoriasTodas.set(categorias);
        const primeraDelTipo = categorias.find((c) => c.tipoSistemaId === this.tipoSistemaSeleccionadoId());
        if (primeraDelTipo) {
          this.categoriaSeleccionadaId.set(primeraDelTipo.id);
          this.cargar();
        }
      },
      error: () => this.toast.error('No se pudieron cargar las categorías.'),
    });
  }

  cambiarTipoSistema(idTexto: string): void {
    this.tipoSistemaSeleccionadoId.set(Number(idTexto));
    const primeraDelTipo = this.categoriasDelTipo()[0];
    this.categoriaSeleccionadaId.set(primeraDelTipo?.id ?? 0);
    this.cargar();
  }

  cambiarCategoria(idTexto: string): void {
    this.categoriaSeleccionadaId.set(Number(idTexto));
    this.cargar();
  }

  cargar(): void {
    const categoriaId = this.categoriaSeleccionadaId();
    if (!categoriaId) {
      this.registrosTodos.set([]);
      return;
    }

    this.cargando.set(true);
    this.data.list<Seccion>(ENTIDAD, { categoriaId }).subscribe({
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

  editar(registro: Seccion): void {
    this.registroEnEdicion.set(registro);
    this.form.reset({ id: registro.id, nombre: registro.nombre });
    this.modalAbierto.set(true);
  }

  verDocumentos(registro: Seccion): void {
    this.router.navigate(['/wikidocs/secciones', registro.id, 'documentos']);
  }

  guardar(): void {
    const categoriaId = this.categoriaSeleccionadaId();
    if (this.form.invalid || !categoriaId) {
      this.form.markAllAsTouched();
      this.toast.error('Captura el nombre y selecciona una categoría.');
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
      this.toast.error('Ya existe una sección con ese nombre en esta categoría.');
      return;
    }

    const dto: Seccion = { ...valor, categoriaId };

    const peticion = esEdicion
      ? this.data.modificacion<Seccion>(ENTIDAD, dto)
      : this.data.alta<Seccion>(ENTIDAD, dto);

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
        this.toast.exito(esEdicion ? 'Sección actualizada.' : 'Sección creada.');
        this.modalAbierto.set(false);
        this.cargar();
      },
      error: () => this.toast.error('No se pudo guardar la sección. Intenta de nuevo.'),
    });
  }

  exportarCsvArchivo(): void {
    const filas = this.registros();
    exportarCsv(
      'secciones.csv',
      [{ clave: 'nombre', etiqueta: 'Nombre' }],
      filas.map((f) => ({ nombre: f.nombre })),
    );
    this.toast.exito(`Se descargó secciones.csv (${filas.length} registro${filas.length === 1 ? '' : 's'}).`);
  }

  /** No deja eliminar una sección que ya tenga documentos apuntándole
   *  (evita dejar documentos huérfanos con un seccionId inexistente). */
  pedirEliminar(registro: Seccion): void {
    this.data.list<{ id: number }>('Documento', { seccionId: registro.id }).subscribe((dependientes) => {
      if (dependientes.length > 0) {
        this.toast.advertencia(
          `No se puede eliminar: ${dependientes.length} documento${dependientes.length === 1 ? '' : 's'} usa${dependientes.length === 1 ? '' : 'n'} esta sección.`,
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
        this.toast.exito('Sección eliminada.');
        this.registroAEliminar.set(null);
        this.cargar();
      },
      error: () => this.toast.error('No se pudo eliminar la sección. Intenta de nuevo.'),
    });
  }
}

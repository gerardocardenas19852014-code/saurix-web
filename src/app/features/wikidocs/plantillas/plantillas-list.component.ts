import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { DataClientService } from '../../../core/services/data-client.service';
import { BitacoraComponent } from '../../../shared/components/bitacora/bitacora.component';
import { EditorTextoComponent } from '../../../shared/components/editor-texto/editor-texto.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { BitacoraService } from '../../../shared/services/bitacora.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { ToastService } from '../../../shared/services/toast.service';
import { exportarCsv } from '../../../shared/utils/csv.util';
import { PlantillaDocumento } from './plantilla.model';

const MODULO_BITACORA = 'WikiDocs / Plantillas';
const ENTIDAD = 'PlantillaDocumento';

/**
 * Catálogo de plantillas de documento — mismo estándar de modal que Tipo
 * de sistema/Categoría/Secciones, solo que además del nombre pide el
 * contenido de partida con el mismo editor visual (app-editor-texto) que
 * usan los documentos reales. Documentos ofrece "Usar plantilla" al crear
 * uno nuevo, precargando este contenido en el formulario.
 */
@Component({
  selector: 'app-plantillas-list',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, BitacoraComponent, EditorTextoComponent],
  templateUrl: './plantillas-list.component.html',
  styleUrl: './plantillas-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlantillasListComponent implements OnInit, OnDestroy {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly bitacora = inject(BitacoraService);
  private readonly auth = inject(AuthService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);

  protected readonly registrosTodos = signal<PlantillaDocumento[]>([]);
  protected readonly cargando = signal(false);
  protected readonly busqueda = signal('');

  protected readonly registros = computed(() => {
    const texto = this.busqueda().trim().toLowerCase();
    if (!texto) return this.registrosTodos();
    return this.registrosTodos().filter((r) => r.nombre.toLowerCase().includes(texto));
  });

  protected readonly modalAbierto = signal(false);
  protected readonly registroEnEdicion = signal<PlantillaDocumento | null>(null);
  protected readonly registroAEliminar = signal<PlantillaDocumento | null>(null);

  protected readonly columnas: ColumnaTabla<PlantillaDocumento>[] = [
    { campo: 'nombre', etiqueta: 'Nombre' },
    { campo: 'activo', etiqueta: 'Activo', formatear: (fila) => (fila.activo ? 'Sí' : 'No') },
  ];

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    nombre: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
    contenido: [''],
    activo: [true],
  });

  ngOnInit(): void {
    // Pantallas de WikiDocs (menos "Inicio", que es la cuadrícula de
    // iconos): por defecto .content tiene max-width: 980px y queda
    // centrada, dejando franjas vacías grandes a los lados en pantallas
    // anchas. Se pide aquí el mismo ancho ampliado que ya usan
    // Movimientos/Deudas/Proyección/Familia/Panel de Control (ver
    // html[data-wide='grid'] en styles.scss) para que el contenido
    // aproveche ese espacio.
    document.documentElement.setAttribute('data-wide', 'grid');
    this.cargar();
  }
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }


  cargar(): void {
    this.cargando.set(true);
    this.data.list<PlantillaDocumento>(ENTIDAD).subscribe({
      next: (registros) => {
        this.registrosTodos.set(registros);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  nuevo(): void {
    this.registroEnEdicion.set(null);
    this.form.reset({ id: 0, nombre: '', contenido: '', activo: true });
    this.modalAbierto.set(true);
  }

  editar(registro: PlantillaDocumento): void {
    this.registroEnEdicion.set(registro);
    this.form.reset({
      id: registro.id,
      nombre: registro.nombre,
      contenido: registro.contenido,
      activo: registro.activo,
    });
    this.modalAbierto.set(true);
  }

  guardar(): void {
    if (this.form.get('nombre')!.invalid) {
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
      this.toast.error('Ya existe una plantilla con ese nombre.');
      return;
    }

    const peticion = esEdicion
      ? this.data.modificacion<PlantillaDocumento>(ENTIDAD, valor)
      : this.data.alta<PlantillaDocumento>(ENTIDAD, valor);

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
        this.toast.exito(esEdicion ? 'Plantilla actualizada.' : 'Plantilla creada.');
        this.modalAbierto.set(false);
        this.cargar();
      },
      error: () => this.toast.error('No se pudo guardar la plantilla. Intenta de nuevo.'),
    });
  }

  exportarCsvArchivo(): void {
    const filas = this.registros();
    exportarCsv(
      'plantillas-de-documento.csv',
      [
        { clave: 'nombre', etiqueta: 'Nombre' },
        { clave: 'activo', etiqueta: 'Activo' },
      ],
      filas.map((f) => ({ ...f, activo: f.activo ? 'Sí' : 'No' })),
    );
    this.toast.exito(`Se descargó plantillas-de-documento.csv (${filas.length} registro${filas.length === 1 ? '' : 's'}).`);
  }

  pedirEliminar(registro: PlantillaDocumento): void {
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
        this.toast.exito('Plantilla eliminada.');
        this.registroAEliminar.set(null);
        this.cargar();
      },
      error: () => this.toast.error('No se pudo eliminar la plantilla. Intenta de nuevo.'),
    });
  }
}

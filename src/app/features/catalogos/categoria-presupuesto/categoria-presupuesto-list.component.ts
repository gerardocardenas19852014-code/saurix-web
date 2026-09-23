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
import { ValorLista } from '../valor-lista/valor-lista.model';
import { CategoriaPresupuesto } from './categoria-presupuesto.model';

const MODULO_BITACORA = 'Catálogos / Categorías de presupuesto';
const ENTIDAD = 'CategoriaPresupuesto';

/**
 * Catálogo "Categorías de presupuesto" (Presupuesto Personal) — mismo
 * estándar que Usuarios. Admite 2 niveles: una categoría raíz y sus
 * subcategorías directas (p.ej. "Comida" → "Restaurantes"); el combo de
 * "Categoría padre" solo ofrece raíces, así que no se puede anidar más de
 * un nivel desde la propia UI.
 */
@Component({
  selector: 'app-categoria-presupuesto-list',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, BitacoraComponent],
  templateUrl: './categoria-presupuesto-list.component.html',
  styleUrl: './categoria-presupuesto-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategoriaPresupuestoListComponent implements OnInit {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly bitacora = inject(BitacoraService);
  private readonly auth = inject(AuthService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);

  protected readonly registrosTodos = signal<CategoriaPresupuesto[]>([]);
  protected readonly tiposMovimiento = signal<ValorLista[]>([]);
  protected readonly cargando = signal(false);
  protected readonly busqueda = signal('');

  /** Solo las raíces (sin padre) son elegibles como "categoría padre" — así se limita a 2 niveles. */
  protected readonly raices = computed(() => this.registrosTodos().filter((c) => !c.categoriaPresupuestoPadreId));

  protected readonly registros = computed(() => {
    const texto = this.busqueda().trim().toLowerCase();
    if (!texto) return this.registrosTodos();
    return this.registrosTodos().filter((r) => r.nombre.toLowerCase().includes(texto));
  });

  protected readonly modalAbierto = signal(false);
  protected readonly registroEnEdicion = signal<CategoriaPresupuesto | null>(null);
  protected readonly registroAEliminar = signal<CategoriaPresupuesto | null>(null);

  protected readonly columnas: ColumnaTabla<CategoriaPresupuesto>[] = [
    { campo: 'nombre', etiqueta: 'Nombre', formatear: (r) => (r.categoriaPresupuestoPadreId ? `— ${r.nombre}` : r.nombre) },
    {
      campo: 'tipo',
      etiqueta: 'Tipo',
      formatear: (r) => this.etiquetaTipo(r.tipo),
      claseValor: (r) => (r.tipo === 'Ingreso' ? 'grid-badge-success' : r.tipo === 'Gasto' ? 'grid-badge-danger' : 'grid-badge-muted'),
    },
    {
      campo: 'categoriaPresupuestoPadreId',
      etiqueta: 'Categoría padre',
      formatear: (r) => this.nombrePadre(r.categoriaPresupuestoPadreId),
    },
  ];

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    nombre: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(60)]],
    tipo: ['Gasto' as string, Validators.required],
    categoriaPresupuestoPadreId: [0],
  });

  /** true mientras el Tipo lo hereda de la categoría padre elegida (el select se deshabilita) — ver onPadreChange(). */
  protected readonly tipoHeredado = signal(false);

  ngOnInit(): void {
    this.data.list<ValorLista>('ValorLista', { grupo: 'MovimientoPresupuestoTipo' }).subscribe((valores) =>
      this.tiposMovimiento.set(
        valores.filter((v) => v.grupo === 'MovimientoPresupuestoTipo').sort((a, b) => a.orden - b.orden),
      ),
    );
    this.cargar();
  }

  nombrePadre(id: number | null): string {
    if (!id) return '—';
    return this.registrosTodos().find((c) => Number(c.id) === Number(id))?.nombre ?? '—';
  }

  etiquetaTipo(tipo: string | null): string {
    if (!tipo) return 'Sin definir';
    return this.tiposMovimiento().find((t) => t.clave === tipo)?.etiqueta ?? tipo;
  }

  /** El Tipo de una subcategoría siempre es el de su padre — se dispara al elegir/quitar "Categoría padre" en el formulario. */
  onPadreChange(): void {
    const padreId = this.form.controls.categoriaPresupuestoPadreId.value;
    if (!padreId) {
      this.tipoHeredado.set(false);
      this.form.controls.tipo.enable();
      return;
    }
    const padre = this.raices().find((c) => Number(c.id) === Number(padreId));
    if (padre?.tipo) {
      this.form.controls.tipo.setValue(padre.tipo);
      this.tipoHeredado.set(true);
      this.form.controls.tipo.disable();
    } else {
      // El padre es de un catálogo previo al campo Tipo (todavía "Sin definir"): no hay de dónde heredar.
      this.tipoHeredado.set(false);
      this.form.controls.tipo.enable();
    }
  }

  cargar(): void {
    this.cargando.set(true);
    this.data.list<CategoriaPresupuesto>(ENTIDAD).subscribe({
      next: (registros) => {
        this.registrosTodos.set(registros);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  nuevo(): void {
    this.registroEnEdicion.set(null);
    this.tipoHeredado.set(false);
    this.form.reset({ id: 0, nombre: '', tipo: 'Gasto', categoriaPresupuestoPadreId: 0 });
    this.form.controls.tipo.enable();
    this.modalAbierto.set(true);
  }

  editar(registro: CategoriaPresupuesto): void {
    this.registroEnEdicion.set(registro);
    this.form.reset({
      id: registro.id,
      nombre: registro.nombre,
      tipo: registro.tipo ?? 'Gasto',
      categoriaPresupuestoPadreId: registro.categoriaPresupuestoPadreId ?? 0,
    });
    this.form.controls.tipo.enable();
    this.onPadreChange();
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

    // Una raíz que ya tiene subcategorías no puede convertirse en subcategoría de otra
    // (rompería el límite de 2 niveles).
    const tieneHijas = this.registrosTodos().some((c) => c.categoriaPresupuestoPadreId === valor.id);
    if (esEdicion && valor.categoriaPresupuestoPadreId && tieneHijas) {
      this.toast.error('Esta categoría ya tiene subcategorías; no puede convertirse en subcategoría de otra.');
      return;
    }

    const nombreNuevo = valor.nombre.trim().toLowerCase();
    const yaExiste = this.registrosTodos().some(
      (r) => r.nombre.trim().toLowerCase() === nombreNuevo && r.id !== valor.id,
    );
    if (yaExiste) {
      this.toast.error('Ya existe una categoría con ese nombre.');
      return;
    }

    const dto: CategoriaPresupuesto = {
      ...valor,
      categoriaPresupuestoPadreId: valor.categoriaPresupuestoPadreId ? Number(valor.categoriaPresupuestoPadreId) : null,
    };

    const peticion = esEdicion
      ? this.data.modificacion<CategoriaPresupuesto>(ENTIDAD, dto)
      : this.data.alta<CategoriaPresupuesto>(ENTIDAD, dto);

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
    exportarCsv(
      'categorias-presupuesto.csv',
      [
        { clave: 'nombre', etiqueta: 'Nombre' },
        { clave: 'padreNombre', etiqueta: 'Categoría padre' },
      ],
      filas.map((f) => ({ nombre: f.nombre, padreNombre: this.nombrePadre(f.categoriaPresupuestoPadreId) })),
    );
    this.toast.exito(`Se descargó categorias-presupuesto.csv (${filas.length} registro${filas.length === 1 ? '' : 's'}).`);
  }

  /** No deja eliminar una categoría con subcategorías o con movimientos/recurrentes/límites que la usen. */
  pedirEliminar(registro: CategoriaPresupuesto): void {
    const subcategorias = this.registrosTodos().filter((c) => c.categoriaPresupuestoPadreId === registro.id).length;
    if (subcategorias > 0) {
      this.toast.advertencia(`No se puede eliminar: tiene ${subcategorias} subcategoría${subcategorias === 1 ? '' : 's'}.`);
      return;
    }

    this.data.list<{ id: number }>('MovimientoPresupuesto', { categoriaPresupuestoId: registro.id }).subscribe((movimientos) => {
      this.data.list<{ id: number }>('MovimientoRecurrentePresupuesto', { categoriaPresupuestoId: registro.id }).subscribe((recurrentes) => {
        this.data.list<{ id: number }>('LimitePresupuesto', { categoriaPresupuestoId: registro.id }).subscribe((limites) => {
          const total = movimientos.length + recurrentes.length + limites.length;
          if (total > 0) {
            this.toast.advertencia(`No se puede eliminar: ${total} registro${total === 1 ? '' : 's'} de Presupuesto usa${total === 1 ? '' : 'n'} esta categoría.`);
            return;
          }
          this.registroAEliminar.set(registro);
        });
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
        this.toast.exito('Categoría eliminada.');
        this.registroAEliminar.set(null);
        this.cargar();
      },
      error: () => this.toast.error('No se pudo eliminar la categoría. Intenta de nuevo.'),
    });
  }
}

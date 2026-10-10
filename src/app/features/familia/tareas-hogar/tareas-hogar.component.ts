import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DataClientService } from '../../../core/services/data-client.service';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { MiembroFamilia } from '../miembro-familia.model';
import { ETIQUETA_FRECUENCIA_TAREA, FrecuenciaTareaHogar, TareaHogar } from '../tarea-hogar.model';

const ENTIDAD = 'TareaHogar';

/** Lista simple de quehaceres del hogar — a propósito NO es un tablero
 *  Kanban como Trámites familiares: aquí lo único que importa es
 *  "¿está hecha o no?", así que una lista con checkbox es más rápida de
 *  usar que arrastrar tarjetas entre columnas. */
@Component({
  selector: 'app-tareas-hogar',
  standalone: true,
  imports: [DatePipe, ReactiveFormsModule, ConfirmDialogComponent],
  templateUrl: './tareas-hogar.component.html',
  styleUrl: './tareas-hogar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TareasHogarComponent implements OnInit {
  // Pantalla a ancho completo (html[data-wide='grid'] en styles.scss).
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  private readonly data = inject(DataClientService);
  private readonly fb = inject(FormBuilder);
  protected readonly toast = inject(ToastService);

  protected readonly etiquetaFrecuencia = ETIQUETA_FRECUENCIA_TAREA;
  protected readonly tareas = signal<TareaHogar[]>([]);
  protected readonly miembros = signal<MiembroFamilia[]>([]);
  protected readonly cargando = signal(false);
  protected readonly mostrarCompletadas = signal(false);

  protected readonly tareasVisibles = computed(() =>
    this.tareas()
      .filter((t) => t.activo !== false)
      .filter((t) => this.mostrarCompletadas() || !t.completada)
      .sort((a, b) => Number(a.completada) - Number(b.completada) || (a.fechaLimite || '9999').localeCompare(b.fechaLimite || '9999')),
  );

  protected nombreMiembro(id?: number | null): string {
    if (!id) return 'Sin asignar';
    const m = this.miembros().find((x) => Number(x.id) === Number(id));
    return m ? `${m.nombre} ${m.apellidoPaterno}` : 'Sin asignar';
  }

  ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid'); // ancho completo
    this.cargando.set(true);
    this.data.list<MiembroFamilia>('MiembroFamilia').subscribe((m) => this.miembros.set(m.filter((x) => x.activo !== false)));
    this.cargar();
  }

  private cargar(): void {
    this.data.list<TareaHogar>(ENTIDAD).subscribe({
      next: (t) => {
        this.tareas.set(t);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  /** Marcar/desmarcar directo desde el checkbox de la lista, sin abrir el
   *  modal — es la acción que más se usa, así que no debería costar 3 clics. */
  alternarCompletada(tarea: TareaHogar): void {
    this.data.modificacion<TareaHogar>(ENTIDAD, { ...tarea, completada: !tarea.completada }).subscribe({
      next: () => this.cargar(),
      error: () => this.toast.error('No se pudo actualizar. Intenta de nuevo.'),
    });
  }

  // ── Nueva / editar tarea ─────────────────────────────────────────────
  protected readonly modalAbierto = signal(false);
  protected readonly tareaEnEdicion = signal<TareaHogar | null>(null);
  protected readonly tareaAEliminar = signal<TareaHogar | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    titulo: ['', Validators.required],
    miembroFamiliaId: [0],
    frecuencia: ['unica' as FrecuenciaTareaHogar],
    fechaLimite: [''],
    notas: [''],
    completada: [false],
    activo: [true],
  });

  nuevaTarea(): void {
    this.tareaEnEdicion.set(null);
    this.form.reset({ id: 0, titulo: '', miembroFamiliaId: 0, frecuencia: 'unica', fechaLimite: '', notas: '', completada: false, activo: true });
    this.modalAbierto.set(true);
  }

  editarTarea(t: TareaHogar): void {
    this.tareaEnEdicion.set(t);
    this.form.reset({ ...t, miembroFamiliaId: t.miembroFamiliaId ?? 0 });
    this.modalAbierto.set(true);
  }

  cerrarModal(): void {
    this.toast.info('Cambios descartados.');
    this.modalAbierto.set(false);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toast.error('Captura el título de la tarea.');
      return;
    }
    const bruto = this.form.getRawValue();
    const valor = { ...bruto, miembroFamiliaId: bruto.miembroFamiliaId ? Number(bruto.miembroFamiliaId) : null };
    const esEdicion = this.tareaEnEdicion() !== null;
    const peticion = esEdicion
      ? this.data.modificacion<TareaHogar>(ENTIDAD, valor)
      : this.data.alta<TareaHogar>(ENTIDAD, valor);

    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? 'Tarea actualizada.' : 'Tarea agregada.');
        this.modalAbierto.set(false);
        this.cargar();
      },
      error: () => this.toast.error('No se pudo guardar la tarea. Intenta de nuevo.'),
    });
  }

  pedirEliminar(t: TareaHogar): void {
    this.tareaAEliminar.set(t);
  }

  confirmarEliminar(): void {
    const t = this.tareaAEliminar();
    if (!t) return;
    this.data.baja(ENTIDAD, t.id).subscribe({
      next: () => {
        this.toast.exito('Tarea eliminada.');
        this.tareaAEliminar.set(null);
        this.cargar();
      },
      error: () => this.toast.error('No se pudo eliminar. Intenta de nuevo.'),
    });
  }
}

import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { forkJoin, of, switchMap } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { Usuario, nombreCompletoUsuario } from '../../seguridad/usuarios/usuario.model';
import { UsuarioOpcion } from '../../proyectos/kanban/ticket.model';
import { TicketPrioridad, TicketPrioridadNotificar } from '../../proyectos/ticket-prioridades/ticket-prioridad.model';

@Component({
  selector: 'app-ticket-prioridades',
  standalone: true,
  imports: [ReactiveFormsModule, ConfirmDialogComponent],
  templateUrl: './ticket-prioridades.component.html',
  styleUrl: './ticket-prioridades.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TicketPrioridadesComponent implements OnInit {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly prioridades = signal<TicketPrioridad[]>([]);
  protected readonly cargando = signal(false);

  protected readonly modalAbierto = signal(false);
  protected readonly prioridadEnEdicion = signal<TicketPrioridad | null>(null);
  protected readonly prioridadAEliminar = signal<TicketPrioridad | null>(null);

  /** Catálogo de usuarios (para elegir a quién avisar) y selección actual del modal. */
  protected readonly usuarios = signal<UsuarioOpcion[]>([]);
  protected readonly usuarioIdsNotificar = signal<number[]>([]);
  /** Snapshot de TicketPrioridadNotificar tal como estaban al abrir el modal (para diff al guardar). */
  private notificacionesOriginales: TicketPrioridadNotificar[] = [];

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    nombre: ['', Validators.required],
    clave: ['', Validators.required],
    codigoHex: ['#ff4f4f', Validators.required],
    // Mínimo 1: con 0 o negativos, el "deadline" del ticket queda en el pasado
    // desde el instante en que se crea (siempre se ve "🔥 Vencido").
    vigenciaHoras: [24, [Validators.required, Validators.min(1)]],
    avisoHoras: [4, [Validators.required, Validators.min(1)]],
  });

  /** Texto de ayuda "≈ X d Y h" bajo cada campo de horas — 504/250 horas es
   *  difícil de leer de un vistazo, así que se muestra también en días+horas
   *  (solo de lectura: el dato real que se guarda sigue siendo horas). */
  private readonly vigenciaHorasEnVivo = toSignal(this.form.controls.vigenciaHoras.valueChanges, {
    initialValue: this.form.controls.vigenciaHoras.value,
  });
  protected readonly equivalenciaVigencia = computed(() => this.equivalenciaEnDias(this.vigenciaHorasEnVivo()));

  private readonly avisoHorasEnVivo = toSignal(this.form.controls.avisoHoras.valueChanges, {
    initialValue: this.form.controls.avisoHoras.value,
  });
  protected readonly equivalenciaAviso = computed(() => this.equivalenciaEnDias(this.avisoHorasEnVivo()));

  private equivalenciaEnDias(horas: number): string {
    if (!horas || horas < 24) return '';
    const dias = Math.floor(horas / 24);
    const resto = horas % 24;
    return resto > 0 ? `≈ ${dias} d ${resto} h` : `≈ ${dias} d`;
  }

  ngOnInit(): void {
    this.cargar();
    this.cargarUsuarios();
  }

  cargar(): void {
    this.cargando.set(true);
    this.data.list<TicketPrioridad>('TicketPrioridad').subscribe({
      next: (prioridades) => {
        this.prioridades.set(prioridades);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  private cargarUsuarios(): void {
    this.data.list<Usuario>('Usuario').subscribe((usuarios) => {
      this.usuarios.set(
        usuarios.map((u) => ({ id: u.id, nombreCompleto: nombreCompletoUsuario(u) })),
      );
    });
  }

  nueva(): void {
    this.prioridadEnEdicion.set(null);
    this.form.reset({ id: 0, nombre: '', clave: '', codigoHex: '#ff4f4f', vigenciaHoras: 24, avisoHoras: 4 });
    this.notificacionesOriginales = [];
    this.usuarioIdsNotificar.set([]);
    this.modalAbierto.set(true);
  }

  editar(prioridad: TicketPrioridad): void {
    this.prioridadEnEdicion.set(prioridad);
    this.form.reset({
      id: prioridad.id,
      nombre: prioridad.nombre,
      clave: prioridad.clave,
      codigoHex: prioridad.codigoHex,
      vigenciaHoras: prioridad.vigenciaHoras,
      avisoHoras: prioridad.avisoHoras,
    });
    this.notificacionesOriginales = [];
    this.usuarioIdsNotificar.set([]);
    this.data
      .list<TicketPrioridadNotificar>('TicketPrioridadNotificar', { ticketPrioridadId: prioridad.id })
      .subscribe((filas) => {
        this.notificacionesOriginales = filas;
        this.usuarioIdsNotificar.set(filas.map((f) => Number(f.usuarioId)));
      });
    this.modalAbierto.set(true);
  }

  /** Marca/desmarca a un usuario en la lista de "avisar también a" del modal actual. */
  toggleNotificar(usuarioId: number, marcado: boolean): void {
    const actuales = this.usuarioIdsNotificar();
    this.usuarioIdsNotificar.set(
      marcado ? [...actuales, usuarioId] : actuales.filter((id) => id !== usuarioId),
    );
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const valor = this.form.getRawValue();
    const esEdicion = this.prioridadEnEdicion() !== null;
    const peticion = esEdicion
      ? this.data.modificacion<TicketPrioridad>('TicketPrioridad', valor)
      : this.data.alta<TicketPrioridad>('TicketPrioridad', valor);

    peticion.subscribe({
      next: (resultado) => {
        this.sincronizarNotificaciones(resultado.id);
        this.toast.exito(esEdicion ? 'Prioridad actualizada.' : 'Prioridad creada.');
        this.modalAbierto.set(false);
        this.cargar();
      },
      error: () => this.toast.error('No se pudo guardar la prioridad. Intenta de nuevo.'),
    });
  }

  /** Alta/baja de TicketPrioridadNotificar según lo marcado en el modal vs. lo que había al abrirlo. */
  private sincronizarNotificaciones(prioridadId: number): void {
    const seleccionados = this.usuarioIdsNotificar();
    const idsOriginales = this.notificacionesOriginales.map((n) => Number(n.usuarioId));
    let huboError = false;
    const avisarError = () => {
      if (huboError) return;
      huboError = true;
      this.toast.advertencia('La prioridad se guardó, pero no se pudieron actualizar todos los avisos.');
    };

    seleccionados
      .filter((usuarioId) => !idsOriginales.includes(usuarioId))
      .forEach((usuarioId) => {
        this.data
          .alta<TicketPrioridadNotificar>('TicketPrioridadNotificar', { ticketPrioridadId: prioridadId, usuarioId })
          .subscribe({ error: avisarError });
      });

    this.notificacionesOriginales
      .filter((n) => !seleccionados.includes(Number(n.usuarioId)))
      .forEach((n) => {
        this.data.baja('TicketPrioridadNotificar', n.id).subscribe({ error: avisarError });
      });
  }

  pedirEliminar(prioridad: TicketPrioridad): void {
    // Si se borra una Prioridad que algún ticket todavía usa, ese ticket pierde
    // silenciosamente su badge de vigencia (slaInfo() ya no encuentra la prioridad
    // y deja de calcular el "Vencido/Por vencer"), sin ningún aviso.
    this.data.list<{ id: number }>('Ticket', { ticketPrioridadId: prioridad.id }).subscribe((tickets) => {
      if (tickets.length > 0) {
        this.toast.advertencia(
          `No se puede eliminar: ${tickets.length} ticket${tickets.length === 1 ? '' : 's'} usa${tickets.length === 1 ? '' : 'n'} esta prioridad.`,
        );
        return;
      }
      this.prioridadAEliminar.set(prioridad);
    });
  }

  confirmarEliminar(): void {
    const prioridad = this.prioridadAEliminar();
    if (!prioridad) return;

    // Limpia también sus propias TicketPrioridadNotificar (a quién avisar) —
    // si no, quedan huérfanas en la base sin ninguna prioridad a la que pertenecer.
    this.data
      .list<TicketPrioridadNotificar>('TicketPrioridadNotificar', { ticketPrioridadId: prioridad.id })
      .pipe(
        switchMap((notificaciones) => {
          const bajas = notificaciones.map((n) => this.data.baja('TicketPrioridadNotificar', n.id));
          return bajas.length ? forkJoin(bajas) : of(null);
        }),
        switchMap(() => this.data.baja('TicketPrioridad', prioridad.id)),
      )
      .subscribe({
        next: () => {
          this.toast.exito('Prioridad eliminada.');
          this.prioridadAEliminar.set(null);
          this.cargar();
        },
      });
  }
}

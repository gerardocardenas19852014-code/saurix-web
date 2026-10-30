import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { DataClientService } from '../../../core/services/data-client.service';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { TicketPrioridad } from './ticket-prioridad.model';

@Component({
  selector: 'app-ticket-prioridades',
  standalone: true,
  imports: [ReactiveFormsModule, ConfirmDialogComponent],
  templateUrl: './ticket-prioridades.component.html',
  styleUrl: './ticket-prioridades.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TicketPrioridadesComponent implements OnInit {
  // Pantalla a ancho completo (html[data-wide='grid'] en styles.scss).
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly prioridades = signal<TicketPrioridad[]>([]);
  protected readonly cargando = signal(false);
  /** false por defecto: las prioridades desactivadas se ocultan de la lista (y de
   *  los combos de selección al crear/editar un ticket) salvo que se marque esta
   *  casilla — alternativa al borrado duro (que ya se bloquea si algún ticket la usa). */
  protected readonly mostrarInactivos = signal(false);
  protected readonly prioridadesFiltradas = computed(() =>
    this.prioridades().filter((p) => this.mostrarInactivos() || p.activo !== false),
  );

  protected readonly modalAbierto = signal(false);
  protected readonly prioridadEnEdicion = signal<TicketPrioridad | null>(null);
  protected readonly prioridadAEliminar = signal<TicketPrioridad | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    nombre: ['', Validators.required],
    clave: ['', Validators.required],
    codigoHex: ['#ff4f4f', Validators.required],
    // Mínimo 1: con 0 o negativos, el "deadline" del ticket queda en el pasado
    // desde el instante en que se crea (siempre se ve "🔥 Vencido").
    vigenciaHoras: [24, [Validators.required, Validators.min(1)]],
    avisoHoras: [4, [Validators.required, Validators.min(1)]],
    activo: [true],
    critica: [false],
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
    document.documentElement.setAttribute('data-wide', 'grid'); // ancho completo
    this.cargar();
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

  nueva(): void {
    this.prioridadEnEdicion.set(null);
    this.form.reset({
      id: 0,
      nombre: '',
      clave: '',
      codigoHex: '#ff4f4f',
      vigenciaHoras: 24,
      avisoHoras: 4,
      activo: true,
      critica: false,
    });
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
      activo: prioridad.activo !== false,
      critica: prioridad.critica === true,
    });
    this.modalAbierto.set(true);
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
      next: () => {
        this.toast.exito(esEdicion ? 'Prioridad actualizada.' : 'Prioridad creada.');
        this.modalAbierto.set(false);
        this.cargar();
      },
      error: () => this.toast.error('No se pudo guardar la prioridad. Intenta de nuevo.'),
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

    this.data.baja('TicketPrioridad', prioridad.id).subscribe({
      next: () => {
        this.toast.exito('Prioridad eliminada.');
        this.prioridadAEliminar.set(null);
        this.cargar();
      },
    });
  }
}

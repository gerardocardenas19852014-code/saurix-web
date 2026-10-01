import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DataClientService } from '../../../core/services/data-client.service';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ActividadesCrmComponent } from '../../../shared/components/actividades-crm/actividades-crm.component';
import { ToastService } from '../../../shared/services/toast.service';
import { Cliente } from '../../comercio/clientes/cliente.model';
import {
  MotivoPerdida,
  Oportunidad,
  OPORTUNIDAD_ETAPAS,
  OPORTUNIDAD_ETAPAS_ABIERTAS,
  OportunidadEtapa,
} from './oportunidad.model';

/**
 * Pipeline de oportunidades — tablero Kanban propio (NO reutiliza
 * `Proyectos.Kanban`: ese componente está fuertemente acoplado a
 * Ticket/TableroColumna y a su "Gestor de Estados" con reglas de flujo
 * configurables por JSON, que aquí no hacen falta — el movimiento entre
 * etapas es libre en cualquier dirección).
 *
 * Única regla propia: para soltar/guardar una oportunidad en la etapa
 * 'Perdida' es obligatorio indicar un motivo (catálogo MotivoPerdida) —
 * al arrastrar una tarjeta hasta ahí se abre el mismo modal de edición
 * con la etapa ya puesta en 'Perdida', en vez de moverla de una vez, para
 * pedir ese dato antes de confirmar.
 */
@Component({
  selector: 'app-oportunidades-kanban',
  standalone: true,
  imports: [ReactiveFormsModule, ConfirmDialogComponent, ActividadesCrmComponent],
  templateUrl: './oportunidades-kanban.component.html',
  styleUrl: './oportunidades-kanban.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OportunidadesKanbanComponent implements OnInit, OnDestroy {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly etapas = OPORTUNIDAD_ETAPAS;

  protected readonly oportunidades = signal<Oportunidad[]>([]);
  protected readonly clientes = signal<Cliente[]>([]);
  protected readonly motivos = signal<MotivoPerdida[]>([]);
  protected readonly cargando = signal(false);

  private readonly mapaClientes = computed(() => new Map(this.clientes().map((c) => [c.id, c])));
  protected readonly mapaMotivos = computed(() => new Map(this.motivos().map((m) => [m.id, m])));

  protected readonly columnasPorEtapa = computed(() => {
    const mapa = new Map<OportunidadEtapa, Oportunidad[]>(this.etapas.map((etapa) => [etapa, []]));
    for (const op of this.oportunidades()) mapa.get(op.etapa)?.push(op);
    return mapa;
  });

  /** Suma del valor estimado de las oportunidades todavía abiertas — se muestra
   *  como referencia rápida arriba del tablero, no afecta nada más. */
  protected readonly totalPipelineAbierto = computed(() =>
    this.oportunidades()
      .filter((op) => (OPORTUNIDAD_ETAPAS_ABIERTAS as string[]).includes(op.etapa))
      .reduce((suma, op) => suma + (op.valorEstimado ?? 0), 0),
  );

  protected readonly oportunidadArrastrando = signal<Oportunidad | null>(null);

  protected readonly modalAbierto = signal(false);
  protected readonly oportunidadEnEdicion = signal<Oportunidad | null>(null);
  protected readonly oportunidadAEliminar = signal<Oportunidad | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    nombre: ['', Validators.required],
    clienteId: [0],
    valorEstimado: [0],
    etapa: ['Prospección' as OportunidadEtapa],
    fechaCierreEstimada: [''],
    motivoPerdidaId: [0],
    notas: [''],
  });

  ngOnInit(): void {
    // Catálogo/listado atrapado en el ancho de lectura de 980px — usa el
    // ancho "wide" del layout para aprovechar mejor el espacio (ver
    // html[data-wide='grid'] en styles.scss, mismo patrón que Movimientos /
    // Categorías de presupuesto).
    document.documentElement.setAttribute('data-wide', 'grid');
    this.data.list<Cliente>('Cliente').subscribe((clientes) => this.clientes.set(clientes));
    this.data.list<MotivoPerdida>('MotivoPerdida').subscribe((motivos) => this.motivos.set(motivos));
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.data.list<Oportunidad>('Oportunidad').subscribe({
      next: (oportunidades) => {
        this.oportunidades.set(oportunidades);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  protected nombreCliente(clienteId: number | null): string {
    if (!clienteId) return 'Sin cliente asignado';
    return this.mapaClientes().get(clienteId)?.nombre ?? '—';
  }

  protected formatearMoneda(valor: number | null): string {
    if (!valor) return '';
    return '$' + valor.toLocaleString('es-MX');
  }

  nuevo(): void {
    this.oportunidadEnEdicion.set(null);
    this.form.reset({
      id: 0,
      nombre: '',
      clienteId: 0,
      valorEstimado: 0,
      etapa: 'Prospección',
      fechaCierreEstimada: '',
      motivoPerdidaId: 0,
      notas: '',
    });
    this.modalAbierto.set(true);
  }

  editar(oportunidad: Oportunidad, etapaForzada?: OportunidadEtapa): void {
    this.oportunidadEnEdicion.set(oportunidad);
    this.form.reset({
      id: oportunidad.id,
      nombre: oportunidad.nombre,
      clienteId: oportunidad.clienteId ?? 0,
      valorEstimado: oportunidad.valorEstimado ?? 0,
      etapa: etapaForzada ?? oportunidad.etapa,
      fechaCierreEstimada: oportunidad.fechaCierreEstimada ?? '',
      motivoPerdidaId: oportunidad.motivoPerdidaId ?? 0,
      notas: oportunidad.notas ?? '',
    });
    this.modalAbierto.set(true);
  }

  guardar(): void {
    const valor = this.form.getRawValue();

    if (valor.etapa === 'Perdida' && !valor.motivoPerdidaId) {
      this.toast.advertencia('Selecciona el motivo de la pérdida antes de guardar.');
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const payload = {
      id: valor.id,
      nombre: valor.nombre,
      clienteId: valor.clienteId || null,
      valorEstimado: valor.valorEstimado || null,
      etapa: valor.etapa,
      fechaCierreEstimada: valor.fechaCierreEstimada || null,
      motivoPerdidaId: valor.etapa === 'Perdida' ? valor.motivoPerdidaId : null,
      notas: valor.notas || null,
    };

    const esEdicion = this.oportunidadEnEdicion() !== null;
    const peticion = esEdicion
      ? this.data.modificacion<Oportunidad>('Oportunidad', payload)
      : this.data.alta<Oportunidad>('Oportunidad', payload);

    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? 'Oportunidad actualizada.' : 'Oportunidad creada.');
        this.modalAbierto.set(false);
        this.cargar();
      },
    });
  }

  pedirEliminar(oportunidad: Oportunidad): void {
    this.oportunidadAEliminar.set(oportunidad);
  }

  confirmarEliminar(): void {
    const oportunidad = this.oportunidadAEliminar();
    if (!oportunidad) return;

    this.data.baja('Oportunidad', oportunidad.id).subscribe({
      next: () => {
        this.toast.exito('Oportunidad eliminada.');
        this.oportunidadAEliminar.set(null);
        this.cargar();
      },
    });
  }

  onDragStart(oportunidad: Oportunidad): void {
    this.oportunidadArrastrando.set(oportunidad);
  }

  onDragEnd(): void {
    this.oportunidadArrastrando.set(null);
  }

  onDragOver(evento: DragEvent): void {
    if (!this.oportunidadArrastrando()) return;
    evento.preventDefault();
  }

  onDrop(evento: DragEvent, etapaDestino: OportunidadEtapa): void {
    evento.preventDefault();
    const oportunidad = this.oportunidadArrastrando();
    this.oportunidadArrastrando.set(null);
    if (!oportunidad || oportunidad.etapa === etapaDestino) return;

    if (etapaDestino === 'Perdida') {
      // Pedir el motivo antes de mover de verdad — se abre el modal de edición
      // ya con la etapa en 'Perdida' en vez de cambiarla de inmediato.
      this.editar(oportunidad, 'Perdida');
      return;
    }

    this.data.modificacion<Oportunidad>('Oportunidad', { ...oportunidad, etapa: etapaDestino }).subscribe({
      next: () => this.cargar(),
    });
  }

  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }
}

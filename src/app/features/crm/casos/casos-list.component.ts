import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DataClientService } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ActividadesCrmComponent } from '../../../shared/components/actividades-crm/actividades-crm.component';
import { ToastService } from '../../../shared/services/toast.service';
import { Cliente } from '../../comercio/clientes/cliente.model';
import { CASO_ESTADOS, CASO_ESTADOS_ABIERTOS, CASO_PRIORIDADES, Caso, CasoEstado, CasoPrioridad } from './caso.model';

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Casos de servicio (soporte post-venta) — mismo patrón modal-CRUD que
 * Leads/Oportunidades, con el timeline de Actividades incrustado en el
 * modal de edición. Prioridad y Estado son listas fijas (no catálogos
 * editables como LeadOrigen/MotivoPerdida): son el flujo de trabajo del
 * caso, no una clasificación libre, igual que LeadEstado/OportunidadEtapa.
 */
@Component({
  selector: 'app-casos-list',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, ActividadesCrmComponent],
  templateUrl: './casos-list.component.html',
  styleUrl: './casos-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CasosListComponent implements OnInit, OnDestroy {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly prioridades = CASO_PRIORIDADES;
  protected readonly estados = CASO_ESTADOS;

  protected readonly casos = signal<Caso[]>([]);
  protected readonly clientes = signal<Cliente[]>([]);
  private readonly mapaClientes = computed(() => new Map(this.clientes().map((c) => [c.id, c])));

  protected readonly cargando = signal(false);
  protected readonly busqueda = signal('');

  protected readonly totalAbiertos = computed(
    () => this.casos().filter((caso) => (CASO_ESTADOS_ABIERTOS as string[]).includes(caso.estado)).length,
  );

  protected readonly modalAbierto = signal(false);
  protected readonly casoEnEdicion = signal<Caso | null>(null);
  protected readonly casoAEliminar = signal<Caso | null>(null);

  protected readonly columnas: ColumnaTabla<Caso>[] = [
    { campo: 'asunto', etiqueta: 'Asunto' },
    {
      campo: 'clienteId',
      etiqueta: 'Cliente',
      formatear: (fila) => (fila.clienteId ? (this.mapaClientes().get(fila.clienteId)?.nombre ?? '—') : 'Sin cliente'),
    },
    { campo: 'prioridad', etiqueta: 'Prioridad', claseValor: (fila) => this.clasePrioridad(fila.prioridad) },
    { campo: 'estado', etiqueta: 'Estado', claseValor: (fila) => this.claseEstado(fila.estado) },
  ];

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    clienteId: [0],
    asunto: ['', Validators.required],
    descripcion: [''],
    prioridad: ['Media' as CasoPrioridad],
    estado: ['Nuevo' as CasoEstado],
  });

  ngOnInit(): void {
    // Catálogo/listado atrapado en el ancho de lectura de 980px — usa el
    // ancho "wide" del layout para aprovechar mejor el espacio (ver
    // html[data-wide='grid'] en styles.scss, mismo patrón que Movimientos /
    // Categorías de presupuesto).
    document.documentElement.setAttribute('data-wide', 'grid');
    this.data.list<Cliente>('Cliente').subscribe((clientes) => this.clientes.set(clientes));
    this.cargar();
  }

  protected clasePrioridad(prioridad: CasoPrioridad): string {
    switch (prioridad) {
      case 'Urgente':
        return 'grid-badge-danger';
      case 'Alta':
        return 'grid-badge-warning';
      case 'Media':
        return 'grid-badge-neutral';
      default:
        return 'grid-badge-muted';
    }
  }

  protected claseEstado(estado: CasoEstado): string {
    switch (estado) {
      case 'Resuelto':
      case 'Cerrado':
        return 'grid-badge-success';
      case 'En progreso':
        return 'grid-badge-warning';
      case 'Esperando cliente':
        return 'grid-badge-neutral';
      default:
        return 'grid-badge-muted';
    }
  }

  cargar(): void {
    this.cargando.set(true);
    this.data.list<Caso>('Caso', { asunto: this.busqueda() || undefined }).subscribe({
      next: (casos) => {
        this.casos.set(casos);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  nuevo(): void {
    this.casoEnEdicion.set(null);
    this.form.reset({ id: 0, clienteId: 0, asunto: '', descripcion: '', prioridad: 'Media', estado: 'Nuevo' });
    this.modalAbierto.set(true);
  }

  editar(caso: Caso): void {
    this.casoEnEdicion.set(caso);
    this.form.reset({
      id: caso.id,
      clienteId: caso.clienteId ?? 0,
      asunto: caso.asunto,
      descripcion: caso.descripcion ?? '',
      prioridad: caso.prioridad,
      estado: caso.estado,
    });
    this.modalAbierto.set(true);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const valor = this.form.getRawValue();
    const anterior = this.casoEnEdicion();
    const seCierraAhora =
      (valor.estado === 'Resuelto' || valor.estado === 'Cerrado') &&
      anterior?.estado !== 'Resuelto' &&
      anterior?.estado !== 'Cerrado';

    const payload = {
      id: valor.id,
      clienteId: valor.clienteId || null,
      asunto: valor.asunto,
      descripcion: valor.descripcion || null,
      prioridad: valor.prioridad,
      estado: valor.estado,
      // Se estampa sola la primera vez que entra a Resuelto/Cerrado; si ya
      // tenía fecha de cierre (p.ej. se reabrió y se vuelve a cerrar) se
      // conserva la anterior en vez de pisarla.
      fechaCierre: seCierraAhora ? hoyISO() : (anterior?.fechaCierre ?? null),
    };

    const esEdicion = anterior !== null;
    const peticion = esEdicion
      ? this.data.modificacion<Caso>('Caso', payload)
      : this.data.alta<Caso>('Caso', payload);

    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? 'Caso actualizado.' : 'Caso creado.');
        this.modalAbierto.set(false);
        this.cargar();
      },
    });
  }

  pedirEliminar(caso: Caso): void {
    this.casoAEliminar.set(caso);
  }

  confirmarEliminar(): void {
    const caso = this.casoAEliminar();
    if (!caso) return;

    this.data.baja('Caso', caso.id).subscribe({
      next: () => {
        this.toast.exito('Caso eliminado.');
        this.casoAEliminar.set(null);
        this.cargar();
      },
    });
  }

  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }
}

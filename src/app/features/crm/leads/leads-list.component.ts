import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DataClientService } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ActividadesCrmComponent } from '../../../shared/components/actividades-crm/actividades-crm.component';
import { ToastService } from '../../../shared/services/toast.service';
import { Cliente } from '../../comercio/clientes/cliente.model';
import { LEAD_ESTADOS, Lead, LeadEstado, LeadOrigen } from './lead.model';

/**
 * Leads (prospectos) — primer eslabón del CRM, antes de que alguien sea un
 * Cliente formal (Comercio.Cliente). Mismo patrón modal-CRUD que
 * ClientesComponent; lo propio de esta pantalla es "Convertir a cliente"
 * (botón de acción extra por renglón): da de alta un Cliente nuevo con los
 * datos de contacto del lead y marca el lead como 'Convertido' guardando
 * el id resultante — a partir de ahí el lead queda de solo lectura (no se
 * vuelve a poder editar ni reconvertir), su historial se conserva como
 * referencia de "de dónde salió" ese cliente.
 */
@Component({
  selector: 'app-leads-list',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, ActividadesCrmComponent],
  templateUrl: './leads-list.component.html',
  styleUrl: './leads-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LeadsListComponent implements OnInit {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly estados = LEAD_ESTADOS;

  protected readonly leads = signal<Lead[]>([]);
  protected readonly origenes = signal<LeadOrigen[]>([]);
  private readonly mapaOrigenes = computed(() => new Map(this.origenes().map((o) => [o.id, o])));

  protected readonly cargando = signal(false);
  protected readonly busqueda = signal('');

  protected readonly modalAbierto = signal(false);
  protected readonly leadEnEdicion = signal<Lead | null>(null);
  protected readonly leadAEliminar = signal<Lead | null>(null);

  protected readonly columnas: ColumnaTabla<Lead>[] = [
    { campo: 'nombre', etiqueta: 'Nombre' },
    { campo: 'empresa', etiqueta: 'Empresa', formatear: (fila) => fila.empresa ?? '—' },
    {
      campo: 'origenId',
      etiqueta: 'Origen',
      formatear: (fila) => (fila.origenId ? (this.mapaOrigenes().get(fila.origenId)?.nombre ?? '—') : '—'),
    },
    {
      campo: 'estado',
      etiqueta: 'Estado',
      claseValor: (fila) => this.claseEstado(fila.estado),
    },
    { campo: 'telefono', etiqueta: 'Teléfono', formatear: (fila) => fila.telefono ?? '—' },
  ];

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    nombre: ['', Validators.required],
    empresa: [''],
    telefono: [''],
    email: ['', Validators.email],
    origenId: [0],
    estado: ['Nuevo' as LeadEstado],
    notas: [''],
  });

  ngOnInit(): void {
    this.data.list<LeadOrigen>('LeadOrigen').subscribe((origenes) => this.origenes.set(origenes));
    this.cargar();
  }

  private claseEstado(estado: LeadEstado): string {
    switch (estado) {
      case 'Convertido':
        return 'grid-badge-success';
      case 'Calificado':
        return 'grid-badge-neutral';
      case 'Descartado':
        return 'grid-badge-danger';
      default:
        return 'grid-badge-warning';
    }
  }

  cargar(): void {
    this.cargando.set(true);
    this.data.list<Lead>('Lead', { nombre: this.busqueda() || undefined }).subscribe({
      next: (leads) => {
        this.leads.set(leads);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  nuevo(): void {
    this.leadEnEdicion.set(null);
    this.form.reset({ id: 0, nombre: '', empresa: '', telefono: '', email: '', origenId: 0, estado: 'Nuevo', notas: '' });
    this.modalAbierto.set(true);
  }

  editar(lead: Lead): void {
    if (lead.estado === 'Convertido') {
      this.toast.advertencia('Este lead ya se convirtió a cliente y quedó de solo lectura.');
      return;
    }
    this.leadEnEdicion.set(lead);
    this.form.reset({
      id: lead.id,
      nombre: lead.nombre,
      empresa: lead.empresa ?? '',
      telefono: lead.telefono ?? '',
      email: lead.email ?? '',
      origenId: lead.origenId ?? 0,
      estado: lead.estado,
      notas: lead.notas ?? '',
    });
    this.modalAbierto.set(true);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const valor = this.form.getRawValue();
    const payload = {
      id: valor.id,
      nombre: valor.nombre,
      empresa: valor.empresa || null,
      telefono: valor.telefono || null,
      email: valor.email || null,
      origenId: valor.origenId || null,
      estado: valor.estado,
      notas: valor.notas || null,
      clienteConvertidoId: this.leadEnEdicion()?.clienteConvertidoId ?? null,
    };

    const esEdicion = this.leadEnEdicion() !== null;
    const peticion = esEdicion
      ? this.data.modificacion<Lead>('Lead', payload)
      : this.data.alta<Lead>('Lead', payload);

    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? 'Lead actualizado.' : 'Lead creado.');
        this.modalAbierto.set(false);
        this.cargar();
      },
    });
  }

  pedirEliminar(lead: Lead): void {
    this.leadAEliminar.set(lead);
  }

  confirmarEliminar(): void {
    const lead = this.leadAEliminar();
    if (!lead) return;

    this.data.baja('Lead', lead.id).subscribe({
      next: () => {
        this.toast.exito('Lead eliminado.');
        this.leadAEliminar.set(null);
        this.cargar();
      },
    });
  }

  /** "Convertir a cliente": solo tiene sentido para un lead 'Calificado' que
   *  todavía no se haya convertido — en cualquier otro estado se avisa por
   *  qué no, en vez de ocultar el botón (mismo criterio que el resto de la
   *  app: los botones de acción no desaparecen según el estado del renglón,
   *  ver accionExtraEtiqueta en DataTableComponent, que es fijo por diseño). */
  convertirACliente(lead: Lead): void {
    if (lead.clienteConvertidoId) {
      this.toast.advertencia('Este lead ya se había convertido a cliente antes.');
      return;
    }
    if (lead.estado !== 'Calificado') {
      this.toast.advertencia('Solo se puede convertir un lead que esté en estado "Calificado".');
      return;
    }

    const nombreCliente = lead.empresa ? `${lead.nombre} (${lead.empresa})` : lead.nombre;
    this.data
      .alta<Cliente>('Cliente', {
        nombre: nombreCliente,
        telefono: lead.telefono,
        email: lead.email,
        direccion: null,
        activo: true,
      })
      .subscribe({
        next: (cliente) => {
          this.data
            .modificacion<Lead>('Lead', { ...lead, estado: 'Convertido', clienteConvertidoId: cliente.id })
            .subscribe({
              next: () => {
                this.toast.exito(`Lead convertido — se creó el cliente "${cliente.nombre}".`);
                this.cargar();
              },
              error: () => this.toast.error('Se creó el cliente pero no se pudo actualizar el lead. Revísalo manualmente.'),
            });
        },
        error: () => this.toast.error('No se pudo crear el cliente a partir de este lead.'),
      });
  }
}

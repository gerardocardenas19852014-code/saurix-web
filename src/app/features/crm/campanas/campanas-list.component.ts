import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DataClientService } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { Lead } from '../leads/lead.model';
import { CAMPANA_ESTADOS, CAMPANA_TIPOS, Campana, CampanaEstado, CampanaLead, CampanaTipo } from './campana.model';

/**
 * Campañas de marketing — mismo patrón modal-CRUD que el resto del CRM.
 * Lo propio de esta pantalla: dentro del modal de edición se puede asociar
 * Leads existentes a la campaña (de dónde salieron/a qué campaña
 * respondieron) vía la tabla puente CampanaLead — un lead puede estar en
 * más de una campaña. La columna "Leads" de la lista es un conteo rápido.
 */
@Component({
  selector: 'app-campanas-list',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent],
  templateUrl: './campanas-list.component.html',
  styleUrl: './campanas-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CampanasListComponent implements OnInit, OnDestroy {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly tipos = CAMPANA_TIPOS;
  protected readonly estados = CAMPANA_ESTADOS;

  protected readonly campanas = signal<Campana[]>([]);
  protected readonly leads = signal<Lead[]>([]);
  protected readonly asociaciones = signal<CampanaLead[]>([]);
  protected readonly cargando = signal(false);
  protected readonly busqueda = signal('');

  private readonly mapaLeads = computed(() => new Map(this.leads().map((l) => [l.id, l])));

  protected readonly conteoLeadsPorCampana = computed(() => {
    const mapa = new Map<number, number>();
    for (const asociacion of this.asociaciones()) {
      mapa.set(asociacion.campanaId, (mapa.get(asociacion.campanaId) ?? 0) + 1);
    }
    return mapa;
  });

  protected readonly columnas: ColumnaTabla<Campana>[] = [
    { campo: 'nombre', etiqueta: 'Nombre' },
    { campo: 'tipo', etiqueta: 'Tipo' },
    { campo: 'estado', etiqueta: 'Estado', claseValor: (fila) => this.claseEstado(fila.estado) },
    { campo: 'id', etiqueta: 'Leads', formatear: (fila) => String(this.conteoLeadsPorCampana().get(fila.id) ?? 0) },
  ];

  protected readonly modalAbierto = signal(false);
  protected readonly campanaEnEdicion = signal<Campana | null>(null);
  protected readonly campanaAEliminar = signal<Campana | null>(null);

  protected readonly leadAAsociarId = signal(0);

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    nombre: ['', Validators.required],
    tipo: ['Email' as CampanaTipo],
    estado: ['Planificada' as CampanaEstado],
    fechaInicio: [''],
    fechaFin: [''],
    descripcion: [''],
  });

  ngOnInit(): void {
    // Catálogo/listado atrapado en el ancho de lectura de 980px — usa el
    // ancho "wide" del layout para aprovechar mejor el espacio (ver
    // html[data-wide='grid'] en styles.scss, mismo patrón que Movimientos /
    // Categorías de presupuesto).
    document.documentElement.setAttribute('data-wide', 'grid');
    this.data.list<Lead>('Lead').subscribe((leads) => this.leads.set(leads));
    this.cargarAsociaciones();
    this.cargar();
  }

  protected claseEstado(estado: CampanaEstado): string {
    switch (estado) {
      case 'Activa':
        return 'grid-badge-success';
      case 'Finalizada':
        return 'grid-badge-muted';
      default:
        return 'grid-badge-neutral';
    }
  }

  cargar(): void {
    this.cargando.set(true);
    this.data.list<Campana>('Campana', { nombre: this.busqueda() || undefined }).subscribe({
      next: (campanas) => {
        this.campanas.set(campanas);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  private cargarAsociaciones(): void {
    this.data.list<CampanaLead>('CampanaLead').subscribe((asociaciones) => this.asociaciones.set(asociaciones));
  }

  nuevo(): void {
    this.campanaEnEdicion.set(null);
    this.form.reset({ id: 0, nombre: '', tipo: 'Email', estado: 'Planificada', fechaInicio: '', fechaFin: '', descripcion: '' });
    this.modalAbierto.set(true);
  }

  editar(campana: Campana): void {
    this.campanaEnEdicion.set(campana);
    this.leadAAsociarId.set(0);
    this.form.reset({
      id: campana.id,
      nombre: campana.nombre,
      tipo: campana.tipo,
      estado: campana.estado,
      fechaInicio: campana.fechaInicio ?? '',
      fechaFin: campana.fechaFin ?? '',
      descripcion: campana.descripcion ?? '',
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
      tipo: valor.tipo,
      estado: valor.estado,
      fechaInicio: valor.fechaInicio || null,
      fechaFin: valor.fechaFin || null,
      descripcion: valor.descripcion || null,
    };

    const esEdicion = this.campanaEnEdicion() !== null;
    const peticion = esEdicion
      ? this.data.modificacion<Campana>('Campana', payload)
      : this.data.alta<Campana>('Campana', payload);

    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? 'Campaña actualizada.' : 'Campaña creada.');
        this.modalAbierto.set(false);
        this.cargar();
      },
    });
  }

  pedirEliminar(campana: Campana): void {
    this.campanaAEliminar.set(campana);
  }

  confirmarEliminar(): void {
    const campana = this.campanaAEliminar();
    if (!campana) return;

    this.data.baja('Campana', campana.id).subscribe({
      next: () => {
        this.toast.exito('Campaña eliminada.');
        this.campanaAEliminar.set(null);
        this.cargar();
      },
    });
  }

  protected leadsAsociadosDe(campanaId: number): { asociacion: CampanaLead; lead: Lead | undefined }[] {
    return this.asociaciones()
      .filter((a) => a.campanaId === campanaId)
      .map((a) => ({ asociacion: a, lead: this.mapaLeads().get(a.leadId) }));
  }

  protected leadsDisponiblesPara(campanaId: number): Lead[] {
    const yaAsociados = new Set(this.asociaciones().filter((a) => a.campanaId === campanaId).map((a) => a.leadId));
    return this.leads().filter((l) => !yaAsociados.has(l.id));
  }

  asociarLead(campana: Campana): void {
    const leadId = this.leadAAsociarId();
    if (!leadId) {
      this.toast.advertencia('Selecciona un lead para asociar.');
      return;
    }
    this.data.alta<CampanaLead>('CampanaLead', { campanaId: campana.id, leadId }).subscribe({
      next: () => {
        this.leadAAsociarId.set(0);
        this.cargarAsociaciones();
      },
    });
  }

  quitarAsociacion(asociacion: CampanaLead): void {
    this.data.baja('CampanaLead', asociacion.id).subscribe({
      next: () => this.cargarAsociaciones(),
    });
  }

  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }
}

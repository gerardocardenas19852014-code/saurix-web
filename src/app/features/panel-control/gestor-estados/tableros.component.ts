import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { DataClientService } from '../../../core/services/data-client.service';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import {
  CampoTicketConfigurable,
  ConfiguracionCamposTicket,
  ProyectoOpcion,
  ReglaCampoTicket,
  TICKET_CAMPOS_CONFIGURABLES,
  TableroColumna,
  parsearConfiguracionCampos,
  reglaCampo,
} from '../../proyectos/tableros/tablero-columna.model';

interface TicketOpcion {
  id: number;
  tableroColumnaId: number;
}

/**
 * Administra las columnas del tablero Kanban de un proyecto ("Gestor de
 * Estados"). TableroColumna exige el Id del proyecto padre para listar (FK
 * padre obligatorio) — por eso primero se elige el proyecto y solo entonces
 * se cargan/crean sus columnas. El orden de la lista es el orden en que
 * aparecen las columnas en el tablero, de izquierda a derecha — se
 * reordena con los botones ▲▼, que intercambian el campo `orden` entre dos
 * columnas contiguas.
 */
@Component({
  selector: 'app-tableros',
  standalone: true,
  imports: [ReactiveFormsModule, ConfirmDialogComponent],
  templateUrl: './tableros.component.html',
  styleUrl: './tableros.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TablerosComponent implements OnInit {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);

  protected readonly proyectos = signal<ProyectoOpcion[]>([]);
  protected readonly proyectoSeleccionadoId = signal<number>(0);
  protected readonly columnasTablero = signal<TableroColumna[]>([]);
  protected readonly tickets = signal<TicketOpcion[]>([]);
  protected readonly cargando = signal(false);

  protected readonly conteoPorColumna = computed(() => {
    const mapa = new Map<number, number>();
    for (const ticket of this.tickets()) {
      mapa.set(ticket.tableroColumnaId, (mapa.get(ticket.tableroColumnaId) ?? 0) + 1);
    }
    return mapa;
  });

  protected readonly modalAbierto = signal(false);
  protected readonly columnaEnEdicion = signal<TableroColumna | null>(null);
  protected readonly columnaAEliminar = signal<TableroColumna | null>(null);

  /** "⚙ Campos" — configura, por columna, qué campos del ticket son editables/obligatorios en esa etapa. */
  protected readonly camposConfigurables = TICKET_CAMPOS_CONFIGURABLES;
  protected readonly columnaCamposEnEdicion = signal<TableroColumna | null>(null);
  protected readonly configuracionCamposEdit = signal<ConfiguracionCamposTicket>({});

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    clave: ['', Validators.required],
    nombre: ['', Validators.required],
    orden: [1, Validators.required],
    permiteActividades: [true],
    permiteAnexos: [true],
    permiteAsociados: [true],
  });

  ngOnInit(): void {
    // Deep link desde "Ticket" (aviso de "este proyecto no tiene columnas"):
    // ?proyecto=123 selecciona directo ese proyecto en vez del primero de la lista.
    const proyectoIdParam = Number(this.route.snapshot.queryParamMap.get('proyecto')) || 0;

    this.data.list<ProyectoOpcion>('Proyecto').subscribe({
      next: (proyectos) => {
        this.proyectos.set(proyectos);
        if (proyectos.length) {
          const existe = proyectoIdParam && proyectos.some((p) => Number(p.id) === proyectoIdParam);
          this.proyectoSeleccionadoId.set(existe ? proyectoIdParam : proyectos[0].id);
          this.cargar();
        }
      },
    });
  }

  cambiarProyecto(id: number): void {
    this.proyectoSeleccionadoId.set(Number(id));
    this.cargar();
  }

  cargar(): void {
    const proyectoId = this.proyectoSeleccionadoId();
    if (!proyectoId) return;

    this.cargando.set(true);
    this.data.list<TableroColumna>('TableroColumna', { proyectoId }).subscribe({
      next: (columnas) => {
        this.columnasTablero.set(columnas.sort((a, b) => a.orden - b.orden));
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
    this.data.list<TicketOpcion>('Ticket', { proyectoId }).subscribe((tickets) => this.tickets.set(tickets));
  }

  nueva(): void {
    this.columnaEnEdicion.set(null);
    const siguienteOrden = this.columnasTablero().length + 1;
    this.form.reset({
      id: 0,
      clave: '',
      nombre: '',
      orden: siguienteOrden,
      permiteActividades: true,
      permiteAnexos: true,
      permiteAsociados: true,
    });
    this.modalAbierto.set(true);
  }

  editar(columna: TableroColumna): void {
    this.columnaEnEdicion.set(columna);
    this.form.reset({
      id: columna.id,
      clave: columna.clave,
      nombre: columna.nombre,
      orden: columna.orden,
      permiteActividades: columna.permiteActividades,
      permiteAnexos: columna.permiteAnexos,
      permiteAsociados: columna.permiteAsociados,
    });
    this.modalAbierto.set(true);
  }

  guardar(): void {
    if (this.form.invalid || !this.proyectoSeleccionadoId()) {
      this.form.markAllAsTouched();
      return;
    }

    const valor = this.form.getRawValue();
    const existente = this.columnaEnEdicion();
    const payload = {
      ...valor,
      proyectoId: this.proyectoSeleccionadoId(),
      configuracionCamposJson: existente?.configuracionCamposJson ?? null,
    };

    const esEdicion = existente !== null;
    const peticion = esEdicion
      ? this.data.modificacion<TableroColumna>('TableroColumna', payload)
      : this.data.alta<TableroColumna>('TableroColumna', payload);

    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? 'Columna actualizada.' : 'Columna creada.');
        this.modalAbierto.set(false);
        this.cargar();
      },
    });
  }

  /** Intercambia el `orden` de una columna con el de su vecina (▲ -1 / ▼ +1) y recarga.
   *  Son dos escrituras independientes (el motor de datos no tiene transacciones) — si la
   *  segunda falla después de que la primera ya se aplicó, las dos columnas quedarían con
   *  el mismo `orden`; por eso ambas tienen manejo de error, que avisa y recarga para que la
   *  lista siempre refleje el estado real de la base en vez de quedarse con datos viejos. */
  moverOrden(columna: TableroColumna, direccion: -1 | 1): void {
    const columnas = this.columnasTablero();
    const indiceActual = columnas.findIndex((c) => c.id === columna.id);
    const indiceDestino = indiceActual + direccion;
    if (indiceActual === -1 || indiceDestino < 0 || indiceDestino >= columnas.length) return;

    const vecina = columnas[indiceDestino];
    const avisarErrorYRecargar = () => {
      this.toast.error('No se pudo reordenar la columna. Intenta de nuevo.');
      this.cargar();
    };
    this.data.modificacion<TableroColumna>('TableroColumna', { ...columna, orden: vecina.orden }).subscribe({
      next: () => {
        this.data.modificacion<TableroColumna>('TableroColumna', { ...vecina, orden: columna.orden }).subscribe({
          next: () => this.cargar(),
          error: avisarErrorYRecargar,
        });
      },
      error: avisarErrorYRecargar,
    });
  }

  pedirEliminar(columna: TableroColumna): void {
    // IndexedDB no valida integridad referencial: si se borra una columna con
    // tickets adentro, esos tickets quedan con un tableroColumnaId que ya no
    // existe y desaparecen del tablero (y de cualquier otra vista) sin aviso.
    const enUso = this.conteoPorColumna().get(columna.id) ?? 0;
    if (enUso > 0) {
      this.toast.advertencia(
        `No se puede eliminar: hay ${enUso} ticket${enUso === 1 ? '' : 's'} en esta columna. Muévelos primero a otro estado.`,
      );
      return;
    }
    this.columnaAEliminar.set(columna);
  }

  confirmarEliminar(): void {
    const columna = this.columnaAEliminar();
    if (!columna) return;

    this.data.baja('TableroColumna', columna.id).subscribe({
      next: () => {
        this.toast.exito('Columna eliminada.');
        this.columnaAEliminar.set(null);
        this.cargar();
      },
    });
  }

  // ---------------- "⚙ Campos" (ConfiguracionCamposJson por columna) ----------------

  abrirCampos(columna: TableroColumna): void {
    this.columnaCamposEnEdicion.set(columna);
    this.configuracionCamposEdit.set(parsearConfiguracionCampos(columna.configuracionCamposJson));
  }

  cerrarCampos(): void {
    this.columnaCamposEnEdicion.set(null);
  }

  cancelarCampos(): void {
    this.toast.info('Cambios descartados.');
    this.cerrarCampos();
  }

  reglaDe(campo: CampoTicketConfigurable): ReglaCampoTicket {
    return reglaCampo(this.configuracionCamposEdit(), campo);
  }

  toggleEditable(campo: CampoTicketConfigurable, marcado: boolean): void {
    this.configuracionCamposEdit.update((cfg) => {
      const actual = reglaCampo(cfg, campo);
      // Si se desmarca "editable", no tiene sentido dejarlo "obligatorio" a la vez.
      return { ...cfg, [campo]: { editable: marcado, obligatorio: marcado ? actual.obligatorio : false } };
    });
  }

  toggleObligatorio(campo: CampoTicketConfigurable, marcado: boolean): void {
    this.configuracionCamposEdit.update((cfg) => ({ ...cfg, [campo]: { editable: true, obligatorio: marcado } }));
  }

  guardarCampos(): void {
    const columna = this.columnaCamposEnEdicion();
    if (!columna) return;

    const configuracionCamposJson = JSON.stringify(this.configuracionCamposEdit());
    this.data.modificacion<TableroColumna>('TableroColumna', { ...columna, configuracionCamposJson }).subscribe({
      next: () => {
        this.toast.exito('Configuración de campos guardada.');
        this.cerrarCampos();
        this.cargar();
      },
    });
  }
}

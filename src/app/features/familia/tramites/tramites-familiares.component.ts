import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DataClientService } from '../../../core/services/data-client.service';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { MiembroFamilia } from '../miembro-familia.model';
import { SEMILLA_TRAMITE_ESTADOS, TramiteEstado } from '../tramite-estado.model';
import { TramiteFamiliar } from '../tramite-familiar.model';

const ENTIDAD_ESTADO = 'TramiteEstado';
const ENTIDAD_TRAMITE = 'TramiteFamiliar';

/**
 * Checklist de trámites familiares como tablero Kanban — a petición
 * explícita del usuario, "como el de Proyectos pero que también lo pueda
 * configurar": aquí "configurable" significa columnas (TramiteEstado) que
 * el propio usuario agrega/renombra/reordena/elimina desde "⚙ Configurar
 * columnas", NO el editor de flujo/campos/diagrama de Gestor de Estados de
 * Proyectos (ver tablero-columna.model.ts) — ese nivel de configuración no
 * tiene sentido para un trámite, que no tiene los más de 10 campos de un
 * Ticket. El drag-and-drop es HTML5 nativo (dragstart/drop), sin librería
 * nueva, suficiente para arrastrar una tarjeta entre columnas.
 */
@Component({
  selector: 'app-tramites-familiares',
  standalone: true,
  imports: [DatePipe, ReactiveFormsModule, ConfirmDialogComponent],
  templateUrl: './tramites-familiares.component.html',
  styleUrl: './tramites-familiares.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TramitesFamiliaresComponent implements OnInit {
  private readonly data = inject(DataClientService);
  private readonly fb = inject(FormBuilder);
  protected readonly toast = inject(ToastService);

  protected readonly estados = signal<TramiteEstado[]>([]);
  protected readonly tramites = signal<TramiteFamiliar[]>([]);
  protected readonly miembros = signal<MiembroFamilia[]>([]);
  protected readonly cargando = signal(false);

  protected readonly estadosOrdenados = computed(() =>
    [...this.estados()].filter((e) => e.activo !== false).sort((a, b) => a.orden - b.orden),
  );

  protected readonly tramitesPorEstado = computed(() => {
    const mapa = new Map<number, TramiteFamiliar[]>();
    for (const e of this.estadosOrdenados()) mapa.set(Number(e.id), []);
    for (const t of this.tramites().filter((x) => x.activo !== false)) {
      const clave = Number(t.tramiteEstadoId);
      const lista = mapa.get(clave);
      if (lista) lista.push(t);
      else mapa.set(clave, [t]);
    }
    return mapa;
  });

  protected nombreMiembro(id?: number | null): string {
    if (!id) return 'Toda la familia';
    const m = this.miembros().find((x) => Number(x.id) === Number(id));
    return m ? `${m.nombre} ${m.apellidoPaterno}` : 'Toda la familia';
  }

  ngOnInit(): void {
    this.cargando.set(true);
    this.data.list<MiembroFamilia>('MiembroFamilia').subscribe((m) => this.miembros.set(m.filter((x) => x.activo !== false)));
    this.cargarEstados();
  }

  private cargarEstados(): void {
    this.data.list<TramiteEstado>(ENTIDAD_ESTADO).subscribe((lista) => {
      if (lista.length === 0) {
        this.sembrarEstados();
        return;
      }
      this.estados.set(lista);
      this.cargarTramites();
    });
  }

  /** Alta secuencial de las columnas de fábrica — no hay transacciones en
   *  este sistema (ver indexeddb-engine.service.ts), así que se encadenan
   *  una por una en vez de mandarlas en paralelo. */
  private sembrarEstados(restantes: Omit<TramiteEstado, 'id'>[] = SEMILLA_TRAMITE_ESTADOS): void {
    if (restantes.length === 0) {
      this.cargarEstados();
      return;
    }
    const [siguiente, ...resto] = restantes;
    this.data.alta<TramiteEstado>(ENTIDAD_ESTADO, siguiente).subscribe(() => this.sembrarEstados(resto));
  }

  private cargarTramites(): void {
    this.data.list<TramiteFamiliar>(ENTIDAD_TRAMITE).subscribe({
      next: (t) => {
        this.tramites.set(t);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  // ── Nuevo / editar trámite ──────────────────────────────────────────
  protected readonly modalAbierto = signal(false);
  protected readonly tramiteEnEdicion = signal<TramiteFamiliar | null>(null);
  protected readonly tramiteAEliminar = signal<TramiteFamiliar | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    titulo: ['', Validators.required],
    miembroFamiliaId: [0],
    tramiteEstadoId: [0],
    fechaLimite: [''],
    notas: [''],
    activo: [true],
  });

  nuevoTramite(estadoId?: number): void {
    this.tramiteEnEdicion.set(null);
    const primerEstado = estadoId ?? this.estadosOrdenados()[0]?.id ?? 0;
    this.form.reset({ id: 0, titulo: '', miembroFamiliaId: 0, tramiteEstadoId: primerEstado, fechaLimite: '', notas: '', activo: true });
    this.modalAbierto.set(true);
  }

  editarTramite(t: TramiteFamiliar): void {
    this.tramiteEnEdicion.set(t);
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
      this.toast.error('Captura el título del trámite.');
      return;
    }
    const bruto = this.form.getRawValue();
    const valor = { ...bruto, miembroFamiliaId: bruto.miembroFamiliaId ? Number(bruto.miembroFamiliaId) : null };
    const esEdicion = this.tramiteEnEdicion() !== null;
    const peticion = esEdicion
      ? this.data.modificacion<TramiteFamiliar>(ENTIDAD_TRAMITE, valor)
      : this.data.alta<TramiteFamiliar>(ENTIDAD_TRAMITE, valor);

    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? 'Trámite actualizado.' : 'Trámite agregado.');
        this.modalAbierto.set(false);
        this.cargarTramites();
      },
      error: () => this.toast.error('No se pudo guardar el trámite. Intenta de nuevo.'),
    });
  }

  pedirEliminarTramite(t: TramiteFamiliar): void {
    this.tramiteAEliminar.set(t);
  }

  confirmarEliminarTramite(): void {
    const t = this.tramiteAEliminar();
    if (!t) return;
    this.data.baja(ENTIDAD_TRAMITE, t.id).subscribe({
      next: () => {
        this.toast.exito('Trámite eliminado.');
        this.tramiteAEliminar.set(null);
        this.cargarTramites();
      },
      error: () => this.toast.error('No se pudo eliminar. Intenta de nuevo.'),
    });
  }

  // ── Drag and drop nativo entre columnas ─────────────────────────────
  protected readonly arrastrando = signal<TramiteFamiliar | null>(null);

  onDragStart(t: TramiteFamiliar): void {
    this.arrastrando.set(t);
  }

  onDragEnd(): void {
    this.arrastrando.set(null);
  }

  onDrop(estadoId: number): void {
    const t = this.arrastrando();
    this.arrastrando.set(null);
    if (!t || Number(t.tramiteEstadoId) === Number(estadoId)) return;
    this.data.modificacion<TramiteFamiliar>(ENTIDAD_TRAMITE, { ...t, tramiteEstadoId: estadoId }).subscribe({
      next: () => {
        this.toast.exito('Trámite movido.');
        this.cargarTramites();
      },
      error: () => this.toast.error('No se pudo mover. Intenta de nuevo.'),
    });
  }

  // ── Configurar columnas ──────────────────────────────────────────────
  protected readonly modalColumnasAbierto = signal(false);
  protected readonly nombreColumnaNueva = signal('');
  protected readonly columnaAEliminar = signal<TramiteEstado | null>(null);

  abrirConfigColumnas(): void {
    this.modalColumnasAbierto.set(true);
  }

  cerrarConfigColumnas(): void {
    this.modalColumnasAbierto.set(false);
    this.nombreColumnaNueva.set('');
  }

  agregarColumna(): void {
    const nombre = this.nombreColumnaNueva().trim();
    if (!nombre) return;
    const maxOrden = Math.max(0, ...this.estados().map((e) => e.orden));
    this.data.alta<TramiteEstado>(ENTIDAD_ESTADO, { nombre, orden: maxOrden + 1, activo: true }).subscribe(() => {
      this.nombreColumnaNueva.set('');
      this.cargarEstados();
    });
  }

  renombrarColumna(estado: TramiteEstado, nombre: string): void {
    const limpio = nombre.trim();
    if (!limpio || limpio === estado.nombre) return;
    this.data.modificacion<TramiteEstado>(ENTIDAD_ESTADO, { ...estado, nombre: limpio }).subscribe(() => this.cargarEstados());
  }

  moverColumna(estado: TramiteEstado, direccion: -1 | 1): void {
    const ordenados = this.estadosOrdenados();
    const idx = ordenados.findIndex((e) => e.id === estado.id);
    const destino = idx + direccion;
    if (destino < 0 || destino >= ordenados.length) return;
    const otro = ordenados[destino];
    // Intercambiar orden entre las dos columnas — mismo "mover ±1" simple
    // que ya usa el flujo lineal de Kanban (ver kanban.component.ts → mover()).
    this.data.modificacion<TramiteEstado>(ENTIDAD_ESTADO, { ...estado, orden: otro.orden }).subscribe(() => {
      this.data.modificacion<TramiteEstado>(ENTIDAD_ESTADO, { ...otro, orden: estado.orden }).subscribe(() => this.cargarEstados());
    });
  }

  pedirEliminarColumna(estado: TramiteEstado): void {
    const tieneTramites = this.tramites().some((t) => Number(t.tramiteEstadoId) === Number(estado.id) && t.activo !== false);
    if (tieneTramites) {
      this.toast.advertencia('Esta columna tiene trámites — muévelos o elimínalos primero.');
      return;
    }
    if (this.estadosOrdenados().length <= 1) {
      this.toast.advertencia('Debe quedar al menos una columna.');
      return;
    }
    this.columnaAEliminar.set(estado);
  }

  confirmarEliminarColumna(): void {
    const estado = this.columnaAEliminar();
    if (!estado) return;
    this.data.baja(ENTIDAD_ESTADO, estado.id).subscribe(() => {
      this.toast.exito('Columna eliminada.');
      this.columnaAEliminar.set(null);
      this.cargarEstados();
    });
  }
}

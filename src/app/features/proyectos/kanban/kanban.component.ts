import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { DataClientService } from '../../../core/services/data-client.service';
import { AdjuntosPanelComponent } from '../../../shared/components/adjuntos-panel/adjuntos-panel.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { ProyectoOpcion, TableroColumna } from '../tableros/tablero-columna.model';
import { TicketTipo } from '../ticket-tipos/ticket-tipo.model';
import { TicketPrioridad } from '../ticket-prioridades/ticket-prioridad.model';
import {
  Ticket,
  TicketActividad,
  TicketComentario,
  TicketDependencia,
  TicketEtiqueta,
  TicketHistorialEstado,
  TicketSeguidor,
  UsuarioOpcion,
} from './ticket.model';
import { colorAvatar, iniciales } from './avatar.util';

interface TicketTipoSolucionOpcion {
  id: number;
  nombre: string;
}

type TabDetalle =
  | 'detalles'
  | 'actividades'
  | 'comentarios'
  | 'etiquetas'
  | 'adjuntos'
  | 'historial'
  | 'asociados'
  | 'seguidores';
type ClaseSla = 'sla-ok' | 'sla-warning' | 'sla-expired';

/**
 * Tablero Kanban por proyecto. Arrastrar y soltar (drag & drop nativo HTML5)
 * es la forma principal de mover un ticket entre columnas; los botones
 * "◀ ▶" de cada tarjeta son el respaldo confiable (útil en móvil o si el
 * navegador no soporta drag & drop). Ambos caminos —y también el selector
 * de estado dentro del detalle— terminan llamando a `moverTicketAColumna`,
 * el único punto que persiste el cambio de columna.
 */
@Component({
  selector: 'app-kanban',
  standalone: true,
  imports: [ReactiveFormsModule, ConfirmDialogComponent, AdjuntosPanelComponent, DatePipe],
  templateUrl: './kanban.component.html',
  styleUrl: './kanban.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KanbanComponent implements OnInit, OnDestroy {
  private readonly data = inject(DataClientService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);

  protected readonly iniciales = iniciales;
  protected readonly colorAvatar = colorAvatar;

  protected readonly proyectos = signal<ProyectoOpcion[]>([]);
  protected readonly proyectoSeleccionadoId = signal<number>(0);
  protected readonly columnasTablero = signal<TableroColumna[]>([]);
  protected readonly tickets = signal<Ticket[]>([]);
  protected readonly etiquetasPorTicket = signal<Map<number, TicketEtiqueta[]>>(new Map());
  protected readonly cargando = signal(false);
  protected readonly ahora = signal(Date.now());
  private intervaloReloj?: ReturnType<typeof setInterval>;

  protected readonly tipos = signal<TicketTipo[]>([]);
  protected readonly prioridades = signal<TicketPrioridad[]>([]);
  protected readonly tiposSolucion = signal<TicketTipoSolucionOpcion[]>([]);
  protected readonly usuarios = signal<UsuarioOpcion[]>([]);

  protected readonly filtroTipoId = signal<number>(0);
  protected readonly filtroPrioridadId = signal<number>(0);
  protected readonly filtroAsignadoId = signal<number>(0);
  protected readonly hayFiltros = computed(
    () => !!(this.filtroTipoId() || this.filtroPrioridadId() || this.filtroAsignadoId()),
  );

  protected readonly modalAbierto = signal(false);
  protected readonly ticketEnEdicion = signal<Ticket | null>(null);
  protected readonly columnaCreacionId = signal<number>(0);

  protected readonly ticketActivo = signal<Ticket | null>(null);
  protected readonly ticketAEliminar = signal<Ticket | null>(null);
  protected readonly tabActiva = signal<TabDetalle>('detalles');
  protected readonly comentarios = signal<TicketComentario[]>([]);
  protected readonly actividades = signal<TicketActividad[]>([]);
  protected readonly etiquetas = signal<TicketEtiqueta[]>([]);
  protected readonly historial = signal<TicketHistorialEstado[]>([]);
  protected readonly dependencias = signal<TicketDependencia[]>([]);
  protected readonly seguidores = signal<TicketSeguidor[]>([]);

  /** Pestañas cuya visibilidad depende de la columna actual del ticket (permiteActividades/permiteAnexos/permiteAsociados). */
  protected readonly tabsPermitidas = computed(() => {
    const activo = this.ticketActivo();
    const columna = activo ? this.columnaActualDe(activo) : undefined;
    return {
      actividades: columna?.permiteActividades ?? true,
      adjuntos: columna?.permiteAnexos ?? true,
      asociados: columna?.permiteAsociados ?? true,
    };
  });

  protected readonly ticketsDisponiblesParaAsociar = computed(() => {
    const activo = this.ticketActivo();
    if (!activo) return [];
    const yaAsociadosIds = new Set(this.dependencias().map((d) => Number(d.ticketRelacionadoId)));
    return this.tickets().filter((t) => Number(t.id) !== Number(activo.id) && !yaAsociadosIds.has(Number(t.id)));
  });

  /** Ticket que se está arrastrando (para la clase visual `is-dragging`). */
  protected readonly ticketArrastrandoId = signal<number | null>(null);
  /** Columna sobre la que se sostiene el arrastre (para `is-drop-target`). */
  protected readonly columnaDropTargetId = signal<number | null>(null);

  protected readonly ticketsFiltrados = computed(() => {
    const tipoId = this.filtroTipoId();
    const prioridadId = this.filtroPrioridadId();
    const asignadoId = this.filtroAsignadoId();
    return this.tickets().filter(
      (t) =>
        (!tipoId || Number(t.ticketTipoId) === tipoId) &&
        (!prioridadId || Number(t.ticketPrioridadId) === prioridadId) &&
        (!asignadoId || Number(t.asignadoUsuarioId) === asignadoId),
    );
  });

  protected readonly ticketsPorColumna = computed(() => {
    const mapa = new Map<number, Ticket[]>();
    for (const columna of this.columnasTablero()) {
      mapa.set(
        columna.id,
        this.ticketsFiltrados().filter((t) => Number(t.tableroColumnaId) === Number(columna.id)),
      );
    }
    return mapa;
  });

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    ticketTipoId: [0, Validators.required],
    ticketPrioridadId: [0, Validators.required],
    ticketTipoSolucionId: [0],
    asignadoUsuarioId: [0],
    reportadoPorUsuarioId: [0, Validators.required],
    numeroTicket: ['', Validators.required],
    folioInterno: [''],
    titulo: ['', Validators.required],
    descripcion: [''],
    planeado: [true],
    tiempoEstimadoMin: [0],
    fechaFinAnalisis: [''],
    fechaFinDesarrollo: [''],
    fechaFinCliente: [''],
    solucion: [''],
  });

  protected readonly formComentario = this.fb.nonNullable.group({ texto: ['', Validators.required] });
  protected readonly formActividad = this.fb.nonNullable.group({
    texto: ['', Validators.required],
    tiempoMin: [15, Validators.required],
  });
  protected readonly formEtiqueta = this.fb.nonNullable.group({ texto: ['', Validators.required] });
  protected readonly formAsociado = this.fb.nonNullable.group({ ticketRelacionadoId: [0] });

  ngOnInit(): void {
    this.data.list<ProyectoOpcion>('Proyecto').subscribe({
      next: (proyectos) => {
        this.proyectos.set(proyectos);
        if (proyectos.length) {
          this.proyectoSeleccionadoId.set(proyectos[0].id);
          this.cargarTablero();
        }
      },
    });
    this.data.list<TicketTipo>('TicketTipo').subscribe((tipos) => this.tipos.set(tipos));
    this.data.list<TicketPrioridad>('TicketPrioridad').subscribe((prioridades) => this.prioridades.set(prioridades));
    this.data
      .list<TicketTipoSolucionOpcion>('TicketTipoSolucion')
      .subscribe((tiposSolucion) => this.tiposSolucion.set(tiposSolucion));
    this.data.list<UsuarioOpcion>('Usuario').subscribe((usuarios) => this.usuarios.set(usuarios));

    // Refresca los badges de vigencia (SLA) cada minuto, igual que el prototipo.
    this.intervaloReloj = setInterval(() => this.ahora.set(Date.now()), 60000);
  }

  ngOnDestroy(): void {
    if (this.intervaloReloj) clearInterval(this.intervaloReloj);
  }

  nombreTipo(id: number): string {
    return this.tipos().find((t) => Number(t.id) === Number(id))?.nombre ?? '—';
  }

  iconoTipo(id: number): string {
    return this.tipos().find((t) => Number(t.id) === Number(id))?.icono ?? '';
  }

  nombrePrioridad(id: number): string {
    return this.prioridades().find((p) => Number(p.id) === Number(id))?.nombre ?? '—';
  }

  colorPrioridad(id: number): string {
    return this.prioridades().find((p) => Number(p.id) === Number(id))?.codigoHex ?? '#999';
  }

  nombreUsuario(id: number | null): string {
    if (!id) return 'Sin asignar';
    return this.usuarios().find((u) => Number(u.id) === Number(id))?.nombreCompleto ?? '—';
  }

  columnaActualDe(ticket: Ticket): TableroColumna | undefined {
    return this.columnasTablero().find((c) => Number(c.id) === Number(ticket.tableroColumnaId));
  }

  nombreColumna(id: number): string {
    return this.columnasTablero().find((c) => Number(c.id) === Number(id))?.nombre ?? '—';
  }

  etiquetasDe(ticketId: number): TicketEtiqueta[] {
    return this.etiquetasPorTicket().get(ticketId) ?? [];
  }

  cambiarProyecto(id: number): void {
    this.proyectoSeleccionadoId.set(Number(id));
    this.limpiarFiltros();
    this.cargarTablero();
  }

  limpiarFiltros(): void {
    this.filtroTipoId.set(0);
    this.filtroPrioridadId.set(0);
    this.filtroAsignadoId.set(0);
  }

  columnaPorDefecto(): number {
    return this.columnasTablero()[0]?.id ?? 0;
  }

  private cargarTablero(): void {
    const proyectoId = this.proyectoSeleccionadoId();
    if (!proyectoId) return;

    this.cargando.set(true);
    this.data.list<TableroColumna>('TableroColumna', { proyectoId }).subscribe({
      next: (columnas) => {
        this.columnasTablero.set(columnas.sort((a, b) => a.orden - b.orden));
        this.cargarTickets();
      },
      error: () => this.cargando.set(false),
    });
  }

  private cargarTickets(): void {
    const proyectoId = this.proyectoSeleccionadoId();
    this.data.list<Ticket>('Ticket', { proyectoId }).subscribe({
      next: (tickets) => {
        this.tickets.set(tickets);
        this.cargando.set(false);
        this.cargarEtiquetasDeTablero(tickets.map((t) => t.id));
      },
      error: () => this.cargando.set(false),
    });
  }

  private cargarEtiquetasDeTablero(ticketIds: number[]): void {
    this.data.list<TicketEtiqueta>('TicketEtiqueta').subscribe({
      next: (todas) => {
        const mapa = new Map<number, TicketEtiqueta[]>();
        for (const id of ticketIds) mapa.set(id, []);
        for (const etiqueta of todas) {
          mapa.get(etiqueta.ticketId)?.push(etiqueta);
        }
        this.etiquetasPorTicket.set(mapa);
      },
    });
  }

  private folioSugerido(): string {
    const proyecto = this.proyectos().find((p) => p.id === this.proyectoSeleccionadoId());
    const numeros = this.tickets().map((t) => Number(t.numeroTicket.replace(/\D/g, '')) || 0);
    const siguiente = (numeros.length ? Math.max(...numeros) : 0) + 1;
    return `${proyecto?.clave ?? 'TCK'}-${String(siguiente).padStart(4, '0')}`;
  }

  nuevoTicket(columnaId: number): void {
    this.ticketEnEdicion.set(null);
    this.columnaCreacionId.set(columnaId || this.columnaPorDefecto());
    this.form.reset({
      id: 0,
      ticketTipoId: 0,
      ticketPrioridadId: 0,
      ticketTipoSolucionId: 0,
      asignadoUsuarioId: 0,
      reportadoPorUsuarioId: 0,
      numeroTicket: this.folioSugerido(),
      folioInterno: '',
      titulo: '',
      descripcion: '',
      planeado: true,
      tiempoEstimadoMin: 0,
      fechaFinAnalisis: '',
      fechaFinDesarrollo: '',
      fechaFinCliente: '',
      solucion: '',
    });
    this.modalAbierto.set(true);
  }

  guardarTicket(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const valor = this.form.getRawValue();
    const enEdicion = this.ticketEnEdicion();
    const payload = {
      id: valor.id,
      proyectoId: this.proyectoSeleccionadoId(),
      tableroColumnaId: enEdicion ? Number(enEdicion.tableroColumnaId) : this.columnaCreacionId(),
      ticketTipoId: Number(valor.ticketTipoId),
      ticketPrioridadId: Number(valor.ticketPrioridadId),
      ticketTipoSolucionId: valor.ticketTipoSolucionId ? Number(valor.ticketTipoSolucionId) : null,
      asignadoUsuarioId: valor.asignadoUsuarioId ? Number(valor.asignadoUsuarioId) : null,
      reportadoPorUsuarioId: Number(valor.reportadoPorUsuarioId),
      numeroTicket: valor.numeroTicket,
      folioInterno: valor.folioInterno || null,
      titulo: valor.titulo,
      descripcion: valor.descripcion || null,
      planeado: valor.planeado,
      tiempoEstimadoMin: valor.tiempoEstimadoMin || null,
      fechaFinAnalisis: valor.fechaFinAnalisis || null,
      fechaFinDesarrollo: valor.fechaFinDesarrollo || null,
      fechaFinCliente: valor.fechaFinCliente || null,
      solucion: valor.solucion || null,
    };

    const esEdicion = enEdicion !== null;
    const peticion = esEdicion
      ? this.data.modificacion<Ticket>('Ticket', payload)
      : this.data.alta<Ticket>('Ticket', payload);

    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? 'Ticket actualizado.' : 'Ticket creado.');
        if (esEdicion) {
          this.refrescarTicketActivo();
        } else {
          this.modalAbierto.set(false);
        }
        this.cargarTickets();
      },
    });
  }

  /** Único punto que persiste un cambio de columna: lo usan las flechas, el drag & drop y el selector de estado del detalle.
   *  También deja registro en TicketHistorialEstado (bitácora de cambios de estado). */
  private moverTicketAColumna(ticket: Ticket, columnaId: number): void {
    if (Number(ticket.tableroColumnaId) === Number(columnaId)) return;
    const columnaAnteriorId = Number(ticket.tableroColumnaId);
    this.data.modificacion<Ticket>('Ticket', { ...ticket, tableroColumnaId: Number(columnaId) }).subscribe({
      next: () => {
        // Best-effort: el historial es una bitácora informativa, no debe
        // impedir que el movimiento del ticket (ya persistido arriba) se
        // refleje en pantalla si este registro en particular falla.
        this.data
          .alta<TicketHistorialEstado>('TicketHistorialEstado', {
            ticketId: ticket.id,
            tableroColumnaAnteriorId: columnaAnteriorId,
            tableroColumnaNuevaId: Number(columnaId),
            usuarioId: this.auth.usuarioActual()?.id ?? null,
          })
          .subscribe({ error: () => undefined });
        this.cargarTickets();
        if (this.ticketActivo()?.id === ticket.id) this.refrescarTicketActivo();
      },
      error: () => this.toast.error('No se pudo mover el ticket. Intenta de nuevo.'),
    });
  }

  mover(ticket: Ticket, direccion: -1 | 1): void {
    const columnas = this.columnasTablero();
    const indiceActual = columnas.findIndex((c) => Number(c.id) === Number(ticket.tableroColumnaId));
    const indiceDestino = indiceActual + direccion;
    if (indiceActual === -1 || indiceDestino < 0 || indiceDestino >= columnas.length) return;
    this.moverTicketAColumna(ticket, columnas[indiceDestino].id);
  }

  cambiarEstadoDetalle(ticket: Ticket, columnaId: number): void {
    this.moverTicketAColumna(ticket, columnaId);
  }

  // ---------------- Arrastrar y soltar (drag & drop nativo del navegador) ----------------

  onDragStart(evt: DragEvent, ticket: Ticket): void {
    evt.dataTransfer?.setData('text/plain', String(ticket.id));
    if (evt.dataTransfer) evt.dataTransfer.effectAllowed = 'move';
    this.ticketArrastrandoId.set(ticket.id);
  }

  onDragEnd(): void {
    this.ticketArrastrandoId.set(null);
    this.columnaDropTargetId.set(null);
  }

  onDragEnterColumn(columnaId: number): void {
    this.columnaDropTargetId.set(columnaId);
  }

  onDragLeaveColumn(columnaId: number): void {
    if (this.columnaDropTargetId() === columnaId) this.columnaDropTargetId.set(null);
  }

  onDrop(evt: DragEvent, columna: TableroColumna): void {
    evt.preventDefault();
    this.columnaDropTargetId.set(null);
    const idTexto = evt.dataTransfer?.getData('text/plain');
    const id = idTexto ? Number(idTexto) : NaN;
    const ticket = this.tickets().find((t) => t.id === id);
    if (!ticket) return;
    this.moverTicketAColumna(ticket, columna.id);
  }

  // ---------------- Detalle del ticket (tabs: Detalles / Actividades / Comentarios / Etiquetas) ----------------

  abrirDetalle(ticket: Ticket): void {
    this.data.getById<Ticket>('Ticket', ticket.id).subscribe({
      next: (completo) => {
        this.ticketEnEdicion.set(completo);
        this.ticketActivo.set(completo);
        this.tabActiva.set('detalles');
        this.form.reset({
          id: completo.id,
          ticketTipoId: Number(completo.ticketTipoId),
          ticketPrioridadId: Number(completo.ticketPrioridadId),
          ticketTipoSolucionId: completo.ticketTipoSolucionId ? Number(completo.ticketTipoSolucionId) : 0,
          asignadoUsuarioId: completo.asignadoUsuarioId ? Number(completo.asignadoUsuarioId) : 0,
          reportadoPorUsuarioId: Number(completo.reportadoPorUsuarioId),
          numeroTicket: completo.numeroTicket,
          folioInterno: completo.folioInterno ?? '',
          titulo: completo.titulo,
          descripcion: completo.descripcion ?? '',
          planeado: completo.planeado,
          tiempoEstimadoMin: completo.tiempoEstimadoMin ?? 0,
          fechaFinAnalisis: (completo.fechaFinAnalisis ?? '').slice(0, 10),
          fechaFinDesarrollo: (completo.fechaFinDesarrollo ?? '').slice(0, 10),
          fechaFinCliente: (completo.fechaFinCliente ?? '').slice(0, 10),
          solucion: completo.solucion ?? '',
        });
        this.formComentario.reset({ texto: '' });
        this.formActividad.reset({ texto: '', tiempoMin: 15 });
        this.formEtiqueta.reset({ texto: '' });
        this.formAsociado.reset({ ticketRelacionadoId: 0 });
        this.cargarDetalle(completo.id);
      },
    });
  }

  cerrarDetalle(): void {
    this.ticketActivo.set(null);
    this.ticketEnEdicion.set(null);
  }

  private refrescarTicketActivo(): void {
    const activo = this.ticketActivo();
    if (!activo) return;
    this.data.getById<Ticket>('Ticket', activo.id).subscribe({
      next: (completo) => {
        this.ticketActivo.set(completo);
        this.ticketEnEdicion.set(completo);
        this.cargarDetalle(completo.id);
        this.ajustarTabSiNoPermitida();
      },
    });
  }

  /** Si la columna nueva ya no permite la pestaña activa (p.ej. se movió a una columna sin permiteAnexos), vuelve a "Detalles". */
  private ajustarTabSiNoPermitida(): void {
    const permitidas = this.tabsPermitidas();
    const tab = this.tabActiva();
    if (
      (tab === 'actividades' && !permitidas.actividades) ||
      (tab === 'adjuntos' && !permitidas.adjuntos) ||
      (tab === 'asociados' && !permitidas.asociados)
    ) {
      this.tabActiva.set('detalles');
    }
  }

  pedirEliminarTicket(ticket: Ticket): void {
    this.ticketAEliminar.set(ticket);
  }

  confirmarEliminarTicket(): void {
    const ticket = this.ticketAEliminar();
    if (!ticket) return;

    this.data.baja('Ticket', ticket.id).subscribe({
      next: () => {
        this.toast.exito('Ticket eliminado.');
        this.ticketAEliminar.set(null);
        this.cerrarDetalle();
        this.cargarTickets();
      },
    });
  }

  private cargarDetalle(ticketId: number): void {
    this.data
      .list<TicketComentario>('TicketComentario', { ticketId })
      .subscribe((comentarios) => this.comentarios.set(comentarios));
    this.data
      .list<TicketActividad>('TicketActividad', { ticketId })
      .subscribe((actividades) => this.actividades.set(actividades));
    this.data.list<TicketEtiqueta>('TicketEtiqueta', { ticketId }).subscribe((etiquetas) => this.etiquetas.set(etiquetas));
    this.data
      .list<TicketHistorialEstado>('TicketHistorialEstado', { ticketId })
      .subscribe((historial) =>
        this.historial.set(
          [...historial].sort((a, b) => (b.fechaCreacion ?? '').localeCompare(a.fechaCreacion ?? '')),
        ),
      );
    this.data
      .list<TicketDependencia>('TicketDependencia', { ticketId })
      .subscribe((dependencias) => this.dependencias.set(dependencias));
    this.data.list<TicketSeguidor>('TicketSeguidor', { ticketId }).subscribe((seguidores) => this.seguidores.set(seguidores));
  }

  // ---------------- Asociados (TicketDependencia) ----------------

  ticketPorId(id: number): Ticket | undefined {
    return this.tickets().find((t) => Number(t.id) === Number(id));
  }

  agregarAsociado(): void {
    const activo = this.ticketActivo();
    const ticketRelacionadoId = Number(this.formAsociado.controls.ticketRelacionadoId.value);
    if (!activo || !ticketRelacionadoId) return;

    this.data
      .alta<TicketDependencia>('TicketDependencia', { ticketId: activo.id, ticketRelacionadoId })
      .subscribe({
        next: () => {
          this.formAsociado.reset({ ticketRelacionadoId: 0 });
          this.cargarDetalle(activo.id);
        },
      });
  }

  eliminarAsociado(dependencia: TicketDependencia): void {
    const activo = this.ticketActivo();
    if (!activo) return;
    this.data.baja('TicketDependencia', dependencia.id).subscribe({
      next: () => this.cargarDetalle(activo.id),
    });
  }

  // ---------------- Seguidores (TicketSeguidor) ----------------

  esSeguidor(usuarioId: number): boolean {
    return this.seguidores().some((s) => Number(s.usuarioId) === Number(usuarioId));
  }

  toggleSeguidor(usuarioId: number, marcado: boolean): void {
    const activo = this.ticketActivo();
    if (!activo) return;

    if (marcado) {
      this.data.alta<TicketSeguidor>('TicketSeguidor', { ticketId: activo.id, usuarioId }).subscribe({
        next: () => this.cargarDetalle(activo.id),
      });
    } else {
      const fila = this.seguidores().find((s) => Number(s.usuarioId) === Number(usuarioId));
      if (!fila) return;
      this.data.baja('TicketSeguidor', fila.id).subscribe({
        next: () => this.cargarDetalle(activo.id),
      });
    }
  }

  agregarComentario(): void {
    const activo = this.ticketActivo();
    if (!activo || this.formComentario.invalid) return;

    this.data
      .alta<TicketComentario>('TicketComentario', {
        ticketId: activo.id,
        texto: this.formComentario.controls.texto.value,
        creadoPor: this.auth.usuarioActual()?.id ?? null,
      })
      .subscribe({
        next: () => {
          this.formComentario.reset({ texto: '' });
          this.cargarDetalle(activo.id);
        },
      });
  }

  agregarActividad(): void {
    const activo = this.ticketActivo();
    if (!activo || this.formActividad.invalid) return;

    this.data
      .alta<TicketActividad>('TicketActividad', {
        ticketId: activo.id,
        ...this.formActividad.getRawValue(),
        creadoPor: this.auth.usuarioActual()?.id ?? null,
      })
      .subscribe({
        next: () => {
          this.formActividad.reset({ texto: '', tiempoMin: 15 });
          this.cargarDetalle(activo.id);
        },
      });
  }

  agregarEtiqueta(): void {
    const activo = this.ticketActivo();
    if (!activo || this.formEtiqueta.invalid) return;

    this.data
      .alta<TicketEtiqueta>('TicketEtiqueta', {
        ticketId: activo.id,
        texto: this.formEtiqueta.controls.texto.value,
      })
      .subscribe({
        next: () => {
          this.formEtiqueta.reset({ texto: '' });
          this.cargarDetalle(activo.id);
          this.cargarEtiquetasDeTablero(this.tickets().map((t) => t.id));
        },
      });
  }

  eliminarEtiqueta(etiqueta: TicketEtiqueta): void {
    const activo = this.ticketActivo();
    if (!activo) return;

    this.data.baja('TicketEtiqueta', etiqueta.id).subscribe({
      next: () => {
        this.cargarDetalle(activo.id);
        this.cargarEtiquetasDeTablero(this.tickets().map((t) => t.id));
      },
    });
  }

  totalMinutosActividad(): number {
    return this.actividades().reduce((acc, a) => acc + a.tiempoMin, 0);
  }

  // ---------------- Vigencia (SLA) según la prioridad del ticket ----------------

  private estaResuelto(ticket: Ticket): boolean {
    const columnas = this.columnasTablero();
    return columnas.length > 0 && Number(ticket.tableroColumnaId) === Number(columnas[columnas.length - 1].id);
  }

  private slaInfo(ticket: Ticket): { deadline: number; warnAt: number; isExpired: boolean; isWarning: boolean } | null {
    const prioridad = this.prioridades().find((p) => Number(p.id) === Number(ticket.ticketPrioridadId));
    if (!prioridad?.vigenciaHoras || !ticket.fechaCreacion || this.estaResuelto(ticket)) return null;

    const creado = new Date(ticket.fechaCreacion).getTime();
    const deadline = creado + prioridad.vigenciaHoras * 3600000;
    const warnAt = deadline - (prioridad.avisoHoras || 0) * 3600000;
    const ahora = this.ahora();
    return {
      deadline,
      warnAt,
      isExpired: ahora >= deadline,
      isWarning: ahora >= warnAt && ahora < deadline,
    };
  }

  claseSla(ticket: Ticket): ClaseSla | null {
    const info = this.slaInfo(ticket);
    if (!info) return null;
    return info.isExpired ? 'sla-expired' : info.isWarning ? 'sla-warning' : 'sla-ok';
  }

  textoSla(ticket: Ticket): string {
    const info = this.slaInfo(ticket);
    if (!info) return '';
    if (info.isExpired) return '🔥 Vencido';
    if (info.isWarning) return '⏰ Por vencer';
    return '🕐 ' + this.tiempoRestante(info.deadline);
  }

  private tiempoRestante(deadline: number): string {
    const ms = deadline - this.ahora();
    if (ms <= 0) return 'vencido';
    const totalMinutos = Math.round(ms / 60000);
    if (totalMinutos < 60) return `faltan ${totalMinutos}min`;
    return `faltan ${Math.round(totalMinutos / 60)}h`;
  }
}

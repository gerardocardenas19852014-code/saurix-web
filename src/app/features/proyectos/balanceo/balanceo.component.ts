import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DataClientService } from '../../../core/services/data-client.service';
import { colorAvatar, colorBadgeFondo, colorBadgeTexto, iniciales } from '../kanban/avatar.util';
import { Usuario, nombreCompletoUsuario } from '../../seguridad/usuarios/usuario.model';
import { Ticket } from '../kanban/ticket.model';
import { TicketPrioridad } from '../ticket-prioridades/ticket-prioridad.model';
import { TicketTipo } from '../ticket-tipos/ticket-tipo.model';
import { ProyectoOpcion, TableroColumna } from '../tableros/tablero-columna.model';

interface UsuarioOpcionActivo {
  id: number;
  nombre: string;
}

interface FilaBalanceo {
  usuarioId: number;
  nombre: string;
  color: string;
  total: number;
  porPrioridad: Map<number, number>;
}

/**
 * "Balanceo" (Gestión de Proyectos → Reportes) — para decidir a quién SÍ se le
 * puede asignar un ticket nuevo según su carga actual por prioridad (p.ej. "no
 * darle un tercer ticket 'Detiene Operación' a alguien que ya tiene 2") y para
 * mover gente entre proyectos reasignando sus tickets ahí mismo, sin entrar al
 * Tablero de cada proyecto uno por uno.
 *
 * Solo cuenta tickets PENDIENTES (no resueltos — misma "última columna del
 * tablero de su proyecto" que Mi Dashboard/Resumen ejecutivo). El "límite de
 * alerta" es una preferencia de esta pantalla nada más: no se guarda en
 * ningún lado ni bloquea nada en el Tablero — solo resalta en rojo la celda
 * de quien ya lo alcanzó, para que la persona que asigna decida.
 */
@Component({
  selector: 'app-balanceo',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './balanceo.component.html',
  styleUrl: './balanceo.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BalanceoComponent implements OnInit {
  private readonly data = inject(DataClientService);

  protected readonly iniciales = iniciales;

  protected readonly cargando = signal(false);
  protected readonly proyectos = signal<ProyectoOpcion[]>([]);
  protected readonly columnas = signal<TableroColumna[]>([]);
  protected readonly tickets = signal<Ticket[]>([]);
  protected readonly prioridades = signal<TicketPrioridad[]>([]);
  protected readonly tipos = signal<TicketTipo[]>([]);
  protected readonly usuarios = signal<Usuario[]>([]);

  protected readonly filtroProyectoId = signal<number>(0);
  protected readonly filtroTipoId = signal<number>(0);
  protected readonly filtroPrioridadId = signal<number>(0);
  protected readonly limiteAlerta = signal<number>(2);

  protected readonly usuariosExpandidos = signal<Set<number>>(new Set());

  /** Tickets marcados con el checkbox "Comparar" (ver toggleComparar) — pensado
   *  para armar a mano un grupo de 2-3 tickets de personas distintas y verlos
   *  lado a lado (folio, encargado, horas) antes de decidir una reasignación,
   *  pedido explícito del usuario ("quiero ver algo como esto para la toma de
   *  decisión", mostrando un boceto con tickets en columnas). */
  protected readonly ticketsComparar = signal<Set<number>>(new Set());
  /** Columna por la que se ordena la tabla ('total' o el id de una prioridad) —
   *  permite, p.ej., ver de un vistazo quién tiene más tickets de "Alta" para
   *  decidir a quién reasignar (pedido explícito del usuario). */
  protected readonly ordenPor = signal<number | 'total'>('total');
  protected readonly ordenDireccion = signal<'desc' | 'asc'>('desc');

  ngOnInit(): void {
    this.cargando.set(true);
    this.data.list<ProyectoOpcion>('Proyecto').subscribe((p) => this.proyectos.set(p));
    this.data.list<TableroColumna>('TableroColumna').subscribe((c) => this.columnas.set(c));
    this.data.list<TicketPrioridad>('TicketPrioridad').subscribe((p) => this.prioridades.set(p));
    this.data.list<TicketTipo>('TicketTipo').subscribe((t) => this.tipos.set(t));
    this.data.list<Usuario>('Usuario').subscribe((u) => this.usuarios.set(u));
    this.data.list<Ticket>('Ticket').subscribe({
      next: (tickets) => {
        this.tickets.set(tickets);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  cambiarFiltroProyecto(id: string | number): void {
    this.filtroProyectoId.set(Number(id));
  }

  cambiarFiltroTipo(id: string | number): void {
    this.filtroTipoId.set(Number(id));
  }

  cambiarFiltroPrioridad(id: string | number): void {
    this.filtroPrioridadId.set(Number(id));
  }

  /** Mínimo 1 — un límite en 0 haría que TODO se marcara en alerta, sin sentido. */
  cambiarLimiteAlerta(valor: string): void {
    this.limiteAlerta.set(Math.max(1, Number(valor) || 1));
  }

  /** Última columna (por orden) del tablero de cada proyecto — "resuelto" al llegar
   *  ahí, mismo criterio que Mi Dashboard/Resumen ejecutivo. */
  private readonly ultimaColumnaPorProyecto = computed(() => {
    const porProyecto = new Map<number, TableroColumna[]>();
    for (const c of this.columnas()) {
      const id = Number(c.proyectoId);
      const arr = porProyecto.get(id) ?? [];
      arr.push(c);
      porProyecto.set(id, arr);
    }
    const mapa = new Map<number, number>();
    for (const [proyectoId, cols] of porProyecto) {
      const ordenadas = [...cols].sort((a, b) => a.orden - b.orden);
      const ultima = ordenadas[ordenadas.length - 1];
      if (ultima) mapa.set(proyectoId, Number(ultima.id));
    }
    return mapa;
  });

  protected estaResuelto(ticket: Ticket): boolean {
    return this.ultimaColumnaPorProyecto().get(Number(ticket.proyectoId)) === Number(ticket.tableroColumnaId);
  }

  /** Usuarios activos — el roster de filas de la tabla y las opciones normales de
   *  "Asignar a" (ver opcionesUsuarioPara para el caso de un ticket con dueño inactivo). */
  protected readonly usuariosActivos = computed<UsuarioOpcionActivo[]>(() =>
    this.usuarios()
      .filter((u) => u.activo)
      .map((u) => ({ id: u.id, nombre: nombreCompletoUsuario(u) }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre)),
  );

  /** Prioridades "crítica" primero, luego el resto por nombre — así las columnas más
   *  urgentes de la tabla quedan siempre a la izquierda. */
  protected readonly prioridadesOrdenadas = computed(() =>
    [...this.prioridades()].sort((a, b) => {
      if (!!a.critica !== !!b.critica) return a.critica ? -1 : 1;
      return a.nombre.localeCompare(b.nombre);
    }),
  );

  /** Tickets pendientes (no resueltos, activos) que cumplen los filtros de
   *  Proyecto/Tipo/Prioridad — 0 en un filtro significa "todos". */
  protected readonly ticketsFiltrados = computed(() => {
    const proyectoId = this.filtroProyectoId();
    const tipoId = this.filtroTipoId();
    const prioridadId = this.filtroPrioridadId();
    return this.tickets().filter((t) => {
      if (t.activo === false) return false;
      if (this.estaResuelto(t)) return false;
      if (proyectoId && Number(t.proyectoId) !== proyectoId) return false;
      if (tipoId && Number(t.ticketTipoId) !== tipoId) return false;
      if (prioridadId && Number(t.ticketPrioridadId) !== prioridadId) return false;
      return true;
    });
  });

  /** Una fila por cada usuario activo (aunque tenga 0 tickets — así también se ve
   *  quién tiene espacio para recibir más), más "Sin asignar" al final si algún
   *  ticket filtrado no tiene dueño todavía. Ordenadas de más a menos carga. */
  protected readonly filas = computed<FilaBalanceo[]>(() => {
    const porUsuario = new Map<number, Map<number, number>>();
    const totalPorUsuario = new Map<number, number>();
    for (const t of this.ticketsFiltrados()) {
      const usuarioId = Number(t.asignadoUsuarioId) || 0;
      const prioridadId = Number(t.ticketPrioridadId);
      const mapaPrioridad = porUsuario.get(usuarioId) ?? new Map<number, number>();
      mapaPrioridad.set(prioridadId, (mapaPrioridad.get(prioridadId) ?? 0) + 1);
      porUsuario.set(usuarioId, mapaPrioridad);
      totalPorUsuario.set(usuarioId, (totalPorUsuario.get(usuarioId) ?? 0) + 1);
    }

    const filas: FilaBalanceo[] = this.usuariosActivos().map((u) => ({
      usuarioId: u.id,
      nombre: u.nombre,
      color: colorAvatar(u.nombre),
      total: totalPorUsuario.get(u.id) ?? 0,
      porPrioridad: porUsuario.get(u.id) ?? new Map<number, number>(),
    }));

    if (totalPorUsuario.has(0)) {
      filas.push({
        usuarioId: 0,
        nombre: 'Sin asignar',
        color: '#9aa1ab',
        total: totalPorUsuario.get(0) ?? 0,
        porPrioridad: porUsuario.get(0) ?? new Map<number, number>(),
      });
    }

    const columna = this.ordenPor();
    const direccion = this.ordenDireccion() === 'desc' ? -1 : 1;
    const valorColumna = (fila: FilaBalanceo) =>
      columna === 'total' ? fila.total : fila.porPrioridad.get(columna) ?? 0;
    return filas.sort((a, b) => direccion * (valorColumna(a) - valorColumna(b)) || a.nombre.localeCompare(b.nombre));
  });

  protected readonly totalPendientes = computed(() => this.ticketsFiltrados().length);
  protected readonly totalSinAsignar = computed(() => this.filas().find((f) => f.usuarioId === 0)?.total ?? 0);
  protected readonly personasEnAlerta = computed(
    () => this.filas().filter((f) => f.usuarioId !== 0 && this.tieneAlgunaAlerta(f)).length,
  );

  /** Tickets seleccionados para comparar, en el orden en que se fueron marcando
   *  (puede incluir tickets de distintas personas). */
  protected readonly ticketsEnComparacion = computed<Ticket[]>(() => {
    const ids = this.ticketsComparar();
    if (ids.size === 0) return [];
    const todos = this.tickets();
    const resultado: Ticket[] = [];
    for (const id of ids) {
      const ticket = todos.find((t) => t.id === id);
      if (ticket) resultado.push(ticket);
    }
    return resultado;
  });

  protected conteoPrioridad(fila: FilaBalanceo, prioridadId: number): number {
    return fila.porPrioridad.get(prioridadId) ?? 0;
  }

  protected superaLimite(fila: FilaBalanceo, prioridadId: number): boolean {
    return this.conteoPrioridad(fila, prioridadId) >= this.limiteAlerta();
  }

  private tieneAlgunaAlerta(fila: FilaBalanceo): boolean {
    return this.prioridadesOrdenadas().some((p) => this.superaLimite(fila, p.id));
  }

  protected usuarioAbierto(id: number): boolean {
    return this.usuariosExpandidos().has(id);
  }

  protected toggleUsuario(id: number): void {
    this.usuariosExpandidos.update((set) => {
      const nuevo = new Set(set);
      if (nuevo.has(id)) {
        nuevo.delete(id);
      } else {
        nuevo.add(id);
      }
      return nuevo;
    });
  }

  /** Tickets pendientes (ya filtrados por Proyecto/Tipo/Prioridad) de un usuario en
   *  particular, para la lista desplegable de su fila. */
  protected ticketsDe(usuarioId: number): Ticket[] {
    return this.ticketsFiltrados().filter((t) => (Number(t.asignadoUsuarioId) || 0) === usuarioId);
  }

  protected estaEnComparacion(ticketId: number): boolean {
    return this.ticketsComparar().has(ticketId);
  }

  protected toggleComparar(ticketId: number): void {
    this.ticketsComparar.update((set) => {
      const nuevo = new Set(set);
      if (nuevo.has(ticketId)) {
        nuevo.delete(ticketId);
      } else {
        nuevo.add(ticketId);
      }
      return nuevo;
    });
  }

  protected quitarDeComparacion(ticketId: number): void {
    this.ticketsComparar.update((set) => {
      const nuevo = new Set(set);
      nuevo.delete(ticketId);
      return nuevo;
    });
  }

  protected limpiarComparacion(): void {
    this.ticketsComparar.set(new Set());
  }

  protected nombreUsuarioAsignado(id: number | null): string {
    if (!id) return 'Sin asignar';
    const usuario = this.usuarios().find((u) => Number(u.id) === Number(id));
    return usuario ? nombreCompletoUsuario(usuario) : '—';
  }

  /** Formatea minutos como horas (mismo criterio que Reportes de horas: 1 decimal). */
  protected horasTexto(minutos: number | null): string {
    if (!minutos) return '—';
    const horas = Math.round((minutos / 60) * 10) / 10;
    return `${horas} h`;
  }

  protected nombreProyecto(id: number): string {
    return this.proyectos().find((p) => Number(p.id) === Number(id))?.nombre ?? '—';
  }

  protected nombreTipo(id: number): string {
    return this.tipos().find((t) => Number(t.id) === Number(id))?.nombre ?? '—';
  }

  protected iconoTipo(id: number): string {
    return this.tipos().find((t) => Number(t.id) === Number(id))?.icono ?? '';
  }

  protected nombrePrioridad(id: number): string {
    return this.prioridades().find((p) => Number(p.id) === Number(id))?.nombre ?? '—';
  }

  protected colorPrioridad(id: number): string {
    return this.prioridades().find((p) => Number(p.id) === Number(id))?.codigoHex ?? '#999';
  }

  /** Par fondo+texto normalizado (ver colorBadgeFondo/colorBadgeTexto en avatar.util.ts)
   *  para pintar la prioridad como pill siempre legible, sin importar qué tan pálido u
   *  oscuro sea el color que el usuario haya elegido para esa prioridad. */
  protected fondoPrioridad(id: number): string {
    return colorBadgeFondo(this.colorPrioridad(id));
  }

  protected textoPrioridad(id: number): string {
    return colorBadgeTexto(this.colorPrioridad(id));
  }

  /** Clic en un encabezado de columna: ordena la tabla por esa columna
   *  (alternando desc/asc si ya se estaba ordenando por ella). */
  protected ordenarPorColumna(columna: number | 'total'): void {
    if (this.ordenPor() === columna) {
      this.ordenDireccion.update((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      this.ordenPor.set(columna);
      this.ordenDireccion.set('desc');
    }
  }

  protected indicadorOrden(columna: number | 'total'): string {
    if (this.ordenPor() !== columna) return '';
    return this.ordenDireccion() === 'desc' ? ' ▾' : ' ▴';
  }

  /** Opciones del <select> "Asignar a" para UN ticket en particular: los usuarios
   *  activos más, si el ticket ya está asignado a alguien INACTIVO (dado de baja),
   *  esa misma persona agregada al final — así el <select> siempre tiene una opción
   *  que calza con su valor actual (mismo criterio que opcionesSprintPara en
   *  Backlog: sin esto, el navegador mostraría "Sin asignar" seleccionado aunque el
   *  ticket siguiera asignado a esa persona inactiva). */
  protected opcionesUsuarioPara(ticket: Ticket): UsuarioOpcionActivo[] {
    const activos = this.usuariosActivos();
    const asignadoId = Number(ticket.asignadoUsuarioId) || 0;
    if (!asignadoId || activos.some((u) => u.id === asignadoId)) return activos;
    const propio = this.usuarios().find((u) => Number(u.id) === asignadoId);
    return propio ? [...activos, { id: propio.id, nombre: `${nombreCompletoUsuario(propio)} (inactivo)` }] : activos;
  }

  /** Reasigna un ticket a otro usuario (o lo deja "Sin asignar") directo desde aquí —
   *  actualiza el signal local con la respuesta, sin tener que recargar todo Ticket. */
  reasignar(ticket: Ticket, usuarioIdTexto: string): void {
    const usuarioId = Number(usuarioIdTexto) || null;
    if (Number(ticket.asignadoUsuarioId ?? 0) === Number(usuarioId ?? 0)) return;
    this.data.modificacion<Ticket>('Ticket', { ...ticket, asignadoUsuarioId: usuarioId }).subscribe({
      next: (actualizado) => {
        this.tickets.update((lista) => lista.map((t) => (t.id === actualizado.id ? actualizado : t)));
      },
    });
  }
}

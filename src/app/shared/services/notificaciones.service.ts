import { Injectable, computed, inject, signal } from '@angular/core';
import { catchError, firstValueFrom, from, mergeMap, of, tap, toArray } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { DataClientService } from '../../core/services/data-client.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { fuenteDatosActual } from '../../core/services/fuente-datos';
import { Ticket } from '../../features/proyectos/kanban/ticket.model';
import { TicketPrioridad, TicketPrioridadNotificar } from '../../features/proyectos/ticket-prioridades/ticket-prioridad.model';
import { TableroColumna } from '../../features/proyectos/tableros/tablero-columna.model';
import { AvisoTarjetaCiclo } from '../../features/presupuesto/shared/aviso-tarjeta.model';
import { CuentaPresupuesto } from '../../features/presupuesto/cuenta-presupuesto/cuenta-presupuesto.model';
import { MovimientoPresupuesto } from '../../features/presupuesto/movimientos/movimiento.model';
import { formatMoneda, infoTarjeta } from '../../features/presupuesto/shared/wallet.util';
import { Producto } from '../../features/inventario/productos/producto.model';
import { alertasStockBajo } from '../../features/inventario/productos/producto.util';
import { ExistenciaBodega } from '../../features/inventario/movimientos-bodega/existencia-bodega.model';
import { NivelMinimoBodega } from '../../features/inventario/productos/nivel-minimo-bodega.model';
import { AvisoStockBajo } from '../../features/inventario/valor-stock/aviso-stock-bajo.model';
import { OrdenCompra } from '../../features/inventario/compras/orden-compra.model';
import { AvisoOrdenVencida } from '../../features/inventario/compras/aviso-orden-vencida.model';

const ENTIDAD = 'Notificacion';

/**
 * Notificación real, persistida (ya no la lista fija/hardcodeada que traía
 * ShellComponent). Ya tiene tabla real en Supabase (seguridad.notificacion,
 * ver supabase-esquema.ts) con RLS: cada usuario solo ve las notificaciones
 * dirigidas a él o las que él mismo creó (notificacion_ver — necesario
 * porque el INSERT va con `.select()`/RETURNING, que Postgres filtra con la
 * política de SELECT; ver migración 40_notificacion_ver_incluye_creador.sql).
 */
export interface Notificacion {
  id: number;
  usuarioId: number;
  titulo: string;
  /** Ruta interna (Angular Router) a la que navegar al hacer click, p.ej.
   *  '/proyectos/tablero?ticket=123'. Sin link, la notificación es solo informativa. */
  link?: string;
  leida: boolean;
  fechaCreacion?: string;
}

/**
 * Fuente única de notificaciones reales de la app: SLA por vencer/vencido
 * (revisarSlaTickets(), abajo — llamado periódicamente desde ShellComponent),
 * menciones en comentarios, cambio de estado (avisa a quien reportó/sigue el
 * ticket) y asignación de tickets (estos tres, ver kanban.component.ts) llaman a
 * `notificar()` desde donde ocurre el evento; ShellComponent solo consume
 * `notificaciones()`/`totalNoLeidas()` para pintar la campanita.
 */
@Injectable({ providedIn: 'root' })
export class NotificacionesService {
  private readonly data = inject(DataClientService);
  private readonly auth = inject(AuthService);

  private readonly esSupabase = fuenteDatosActual() === 'supabase';
  private readonly sb = this.esSupabase ? inject(SupabaseService).cliente : null;

  readonly notificaciones = signal<Notificacion[]>([]);
  /** Total REAL de no leídas (puede ser mayor que notificaciones().length,
   *  que sigue topado a MAX_NOTIFICACIONES para la lista visible) — ver
   *  recargar()/BLOQUE A: antes esto era un computed() derivado de la misma
   *  lista ya topada a 10, así que nunca podía mostrar más de 10 aunque
   *  hubiera 47 pendientes reales (bug encontrado y corregido aquí). Ahora
   *  viene directo de fn_notificaciones_campanita() (Supabase) o del total
   *  real ya en memoria antes de topar (modo local), y se mantiene al día
   *  con cada notificar()/marcarLeida()/marcarTodasLeidas() sin volver a
   *  consultar. */
  readonly totalNoLeidas = signal(0);
  readonly hayNoLeidas = computed(() => this.totalNoLeidas() > 0);

  private usuarioIdCargado: number | null = null;

  /** La campanita solo muestra pendientes, nunca el historial completo: esta
   *  tabla no tiene borrado/archivado (ver revisarAlertasStockBajo/
   *  revisarOrdenesVencidas/revisarSlaTickets, que generan una fila nueva por
   *  día/ciclo mientras la condición siga), así que con el tiempo crece sin
   *  límite — mismo riesgo de bitácora/movimientos que motivó FiltroRango.
   *  Antes se traía TODO el historial (leídas incluidas) del usuario en cada
   *  login/refresh del shell. Ahora: solo no leídas (en cuanto se marca
   *  leída, deja de traerse — ver marcarLeida/marcarTodasLeidas más abajo,
   *  que la quitan de la lista en vez de solo cambiarle la bandera), topado
   *  a las MAX_NOTIFICACIONES más recientes. */
  private static readonly MAX_NOTIFICACIONES = 10;

  /** Llamar al entrar al shell (login fresco o sesión restaurada) — mismo patrón
   *  que ConfiguracionAparienciaService.cargarParaUsuarioActual(). */
  async cargarParaUsuarioActual(): Promise<void> {
    const usuarioId = this.auth.usuarioActual()?.id;
    if (!usuarioId) {
      this.usuarioIdCargado = null;
      this.notificaciones.set([]);
      return;
    }
    if (this.usuarioIdCargado === usuarioId) return;
    this.usuarioIdCargado = usuarioId;
    await this.recargar(usuarioId);
  }

  /** BLOQUE A: en modo Supabase ya NO se trae "todo lo no leído" para cortar
   *  a 10 en el navegador (`list()` sin límite + `.slice()`) — eso además de
   *  costoso, es lo que producía el bug de totalNoLeidas descrito arriba.
   *  Ahora el LIMIT real y el total real de no leídas vienen en una sola
   *  vuelta desde fn_notificaciones_campanita() (ver migración
   *  notificaciones_campanita_indice_rpc — índice parcial
   *  notificacion_usuario_pendientes_ix, WHERE leida=false, cubre tanto el
   *  ORDER BY+LIMIT como el COUNT). RLS (notificacion_ver/solo_mi_empresa)
   *  sigue aplicando igual que siempre: la función es SECURITY INVOKER. */
  private async recargar(usuarioId: number): Promise<void> {
    if (this.esSupabase) {
      try {
        const { data, error } = await this.sb!.schema('seguridad').rpc('fn_notificaciones_campanita', {
          p_limite: NotificacionesService.MAX_NOTIFICACIONES,
        });
        if (error) throw error;
        const filas = (data ?? []) as Record<string, unknown>[];
        this.notificaciones.set(
          filas.map((f) => ({
            id: Number(f['id']),
            usuarioId,
            titulo: String(f['titulo']),
            link: f['link'] ? String(f['link']) : undefined,
            leida: false,
            fechaCreacion: f['fecha_creacion'] ? String(f['fecha_creacion']) : undefined,
          })),
        );
        this.totalNoLeidas.set(Number(filas[0]?.['total_no_leidas'] ?? 0));
      } catch {
        /* Sin datos disponibles todavía; se deja el estado como estaba. */
      }
      return;
    }

    // Modo IndexedDB local (catálogos chicos de prueba): se conserva el
    // mismo cálculo de siempre, pero ahora totalNoLeidas se fija al total
    // REAL (antes de topar a MAX_NOTIFICACIONES), no al tamaño de la lista
    // ya topada — mismo bug corregido también aquí.
    try {
      const pendientes = await firstValueFrom(this.data.list<Notificacion>(ENTIDAD, { usuarioId, leida: false }));
      const ordenadas = [...pendientes].sort((a, b) => (b.fechaCreacion ?? '').localeCompare(a.fechaCreacion ?? ''));
      this.notificaciones.set(ordenadas.slice(0, NotificacionesService.MAX_NOTIFICACIONES));
      this.totalNoLeidas.set(ordenadas.length);
    } catch {
      /* Sin datos disponibles todavía; se deja el estado como estaba. */
    }
  }

  /**
   * Crea una notificación para `usuarioId`. Nunca lanza: quien dispara un evento
   * (asignar un ticket, mencionar a alguien, vencer un SLA) no debe fallar su
   * propia operación si esto no se pudo guardar.
   */
  notificar(usuarioId: number | null | undefined, titulo: string, link?: string): void {
    if (!usuarioId) return;
    this.data.alta<Notificacion>(ENTIDAD, { usuarioId, titulo, link, leida: false }).subscribe({
      next: (registro) => {
        if (usuarioId === this.auth.usuarioActual()?.id) {
          this.notificaciones.update((items) =>
            [registro, ...items].slice(0, NotificacionesService.MAX_NOTIFICACIONES),
          );
          this.totalNoLeidas.update((n) => n + 1);
        }
      },
      error: (error) => console.warn('No se pudo guardar la notificación:', error),
    });
  }

  marcarLeida(id: number): void {
    const item = this.notificaciones().find((n) => n.id === id);
    if (!item || item.leida) return;
    // Ya no se deja en la lista con la bandera cambiada: como ahora solo se
    // muestran pendientes (ver recargar()), en cuanto se marca leída
    // simplemente desaparece de la campanita.
    this.notificaciones.update((items) => items.filter((n) => n.id !== id));
    this.totalNoLeidas.update((n) => Math.max(0, n - 1));
    this.data.modificacion<Notificacion>(ENTIDAD, { ...item, leida: true }).subscribe({
      error: (error) => console.warn('No se pudo marcar la notificación como leída:', error),
    });
  }

  /**
   * BLOQUE A: antes esto solo marcaba como leídas las notificaciones ya
   * cargadas en `notificaciones()` (topadas a MAX_NOTIFICACIONES) — con el
   * viejo `totalNoLeidas` (computado de esa misma lista) eso se veía
   * consistente, pero si de verdad había más de 10 pendientes reales, el
   * resto se quedaba `leida=false` en la base para siempre sin que
   * "marcar todas" las tocara. Ahora que `totalNoLeidas` refleja el total
   * real (ver recargar()), hacía falta corregirlo de raíz: en modo
   * Supabase se manda UN SOLO UPDATE server-side con el filtro real
   * (usuario_id + leida=false, protegido además por RLS), no un PATCH por
   * fila ni limitado a lo visible.
   */
  async marcarTodasLeidas(): Promise<void> {
    if (this.totalNoLeidas() === 0) return;
    const usuarioId = this.auth.usuarioActual()?.id;
    if (!usuarioId) return;

    // Limpieza optimista de la campanita — igual que antes.
    this.notificaciones.set([]);
    this.totalNoLeidas.set(0);

    if (this.esSupabase) {
      const { error } = await this.sb!
        .schema('seguridad')
        .from('notificacion')
        .update({ leida: true })
        .eq('usuario_id', usuarioId)
        .eq('leida', false);
      if (error) console.warn('No se pudieron marcar todas las notificaciones como leídas:', error);
      return;
    }

    // Modo IndexedDB local: se trae el total real de pendientes (sin topar,
    // tablas chicas de prueba) y se marca cada una.
    try {
      const pendientes = await firstValueFrom(this.data.list<Notificacion>(ENTIDAD, { usuarioId, leida: false }));
      for (const n of pendientes) {
        this.data
          .modificacion<Notificacion>(ENTIDAD, { ...n, leida: true })
          .subscribe({ error: (error) => console.warn('No se pudo marcar la notificación como leída:', error) });
      }
    } catch (error) {
      console.warn('No se pudieron marcar todas las notificaciones como leídas:', error);
    }
  }

  /** Última columna (por orden) del tablero de cada proyecto — mismo criterio de
   *  "resuelto" que Mi Dashboard/Resumen ejecutivo/Kanban (llegar ahí = resuelto). */
  private ultimaColumnaPorProyecto(columnas: TableroColumna[]): Map<number, number> {
    const porProyecto = new Map<number, TableroColumna[]>();
    for (const c of columnas) {
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
  }

  /** Máximo de tickets que reciben un aviso NUEVO en un mismo ciclo (ver
   *  revisarSlaTickets) — ninguno se pierde: el que no alcance en este ciclo
   *  lo agarra el siguiente (se llama cada 5 min, ver ShellComponent), solo
   *  se reparte en el tiempo en vez de dispararse todo de golpe. */
  private static readonly MAX_AVISOS_SLA_POR_CICLO = 100;

  /** Cuántos tickets se marcan (`modificacion`, con sus notificaciones) en
   *  paralelo dentro de un mismo ciclo — ver revisarSlaTickets. */
  private static readonly CONCURRENCIA_AVISOS_SLA = 5;

  /** Tope de tickets que se TRAEN y recorren en memoria por ciclo (antes de
   *  siquiera filtrar cuáles de verdad necesitan un aviso nuevo) — sin esto,
   *  aunque los avisos/PATCH ya estén acotados (ver MAX_AVISOS_SLA_POR_CICLO),
   *  con una tabla Ticket enorme (p.ej. 200,000 filas en una prueba de
   *  rendimiento) el simple hecho de traer y recorrer TODOS los candidatos
   *  en el navegador seguía siendo lento. 100 ya cubre de sobra a cualquier
   *  negocio real (mismo orden que MAX_AVISOS_SLA_POR_CICLO) — en uso real
   *  este tope prácticamente nunca se alcanza, así que no cambia el
   *  comportamiento; solo pone un techo fijo y chico al costo por ciclo sin
   *  importar qué tan grande crezca la tabla. */
  private static readonly LIMITE_TICKETS_SLA_POR_CICLO = 100;

  /** Mismos 3 topes que MAX_AVISOS_SLA_POR_CICLO/CONCURRENCIA_AVISOS_SLA/
   *  LIMITE_TICKETS_SLA_POR_CICLO, pero para revisarAlertasStockBajo() —
   *  necesarios por la misma razón: Producto puede llegar a tener cientos de
   *  miles de filas (p.ej. en una prueba de rendimiento) y, sin tope, tanto
   *  traer/recorrer todos los productos como el fan-out de escrituras
   *  (AvisoStockBajo + notificación) por cada uno que esté bajo de stock
   *  podía disparar miles de peticiones HTTP simultáneas — mismo patrón que
   *  causó la crisis original de SLA, solo que esta vez con Producto en vez
   *  de Ticket. */
  private static readonly MAX_AVISOS_STOCK_POR_CICLO = 100;
  private static readonly CONCURRENCIA_AVISOS_STOCK = 5;
  private static readonly LIMITE_PRODUCTOS_STOCK_POR_CICLO = 100;

  /**
   * Revisión periódica de SLA — cierra el hueco que dejaba el comentario de arriba:
   * hasta ahora NINGÚN ticket avisaba por SLA, pese a que el catálogo de Prioridades
   * ya captura vigenciaHoras/avisoHoras y una lista "avisar también a"
   * (TicketPrioridadNotificar) que nunca se consultaba. Se llama desde ShellComponent
   * (al entrar a la app y luego cada pocos minutos), así no depende de tener abierta
   * ninguna pantalla de Proyectos en particular.
   *
   * Para no mandar el mismo aviso una y otra vez, cada ticket recuerda en
   * Ticket.slaAvisoNivel el nivel ('warning'/'expired') para el que ya se avisó;
   * solo se vuelve a avisar si el nivel escala (de nada a warning, o de warning a
   * expired). Best-effort: cualquier error aquí se traga, nunca debe tumbar el login.
   *
   * Corta de inmediato si no hay usuario en sesión (mismo guard que
   * revisarAlertasTarjetas/revisarAlertasStockBajo, abajo) — sin esto, cuando el
   * refresh token de Supabase expira (sesión cerrada por su cuenta), este método
   * seguía llamándose en cada ciclo del intervalo de ShellComponent y mandaba
   * peticiones reales a la API con un token ya inválido, inundando la consola de
   * errores 401 sin parar.
   *
   * Dos cuidados de escala agregados tras una prueba de rendimiento con 200,000
   * tickets (antes se traía la tabla Ticket COMPLETA sin filtro y se disparaba
   * un PATCH/POST por cada ticket que calificaba, todo de golpe y sin límite —
   * con pocos tickets no se notaba, pero con cientos de miles saturaba la red
   * del navegador, `ERR_INSUFFICIENT_RESOURCES`, y terminaba tumbando la
   * pestaña). Mismo resultado final, solo más barato de calcular y más sano
   * de mandar:
   *   1. Antes de pedir los tickets, se filtra Ticket.ticketPrioridadId a solo
   *      las prioridades que de verdad tienen vigenciaHoras configurada (con
   *      IN, en el servidor) — exactamente el mismo descarte que antes hacía
   *      `!prioridad?.vigenciaHoras` adentro del for, nomás que ahora nunca
   *      se trae ni se recorre en el navegador lo que de todos modos iba a
   *      descartarse.
   *   2. Los avisos NUEVOS que sí califican se procesan de a
   *      CONCURRENCIA_AVISOS_SLA a la vez (en vez de todos simultáneos), y se
   *      acota a MAX_AVISOS_SLA_POR_CICLO por corrida — lo que sobre lo
   *      recoge el siguiente ciclo (cada 5 min), nunca se pierde un aviso.
   */
  async revisarSlaTickets(): Promise<void> {
    if (!this.auth.usuarioActual()?.id) return;
    try {
      const [prioridades, avisosExtra, columnas] = await Promise.all([
        firstValueFrom(this.data.list<TicketPrioridad>('TicketPrioridad')),
        firstValueFrom(this.data.list<TicketPrioridadNotificar>('TicketPrioridadNotificar')),
        firstValueFrom(this.data.list<TableroColumna>('TableroColumna')),
      ]);
      const prioridadesConVigencia = prioridades.filter((p) => !!p.vigenciaHoras);
      if (prioridadesConVigencia.length === 0) return; // nada que revisar — ningún ticket puede calificar

      const { filas: tickets } = await firstValueFrom(
        this.data.listarPagina<Ticket>(
          'Ticket',
          { ticketPrioridadId: prioridadesConVigencia.map((p) => Number(p.id)) },
          0,
          NotificacionesService.LIMITE_TICKETS_SLA_POR_CICLO,
        ),
      );
      const ultimaColumna = this.ultimaColumnaPorProyecto(columnas);
      const ahora = Date.now();

      type Candidato = { ticket: Ticket; nivel: 'warning' | 'expired'; destinatarios: Set<number> };
      const candidatos: Candidato[] = [];
      for (const ticket of tickets) {
        if (ticket.activo === false) continue;
        if (ultimaColumna.get(Number(ticket.proyectoId)) === Number(ticket.tableroColumnaId)) continue; // ya resuelto

        const prioridad = prioridadesConVigencia.find((p) => Number(p.id) === Number(ticket.ticketPrioridadId));
        if (!prioridad || !ticket.fechaCreacion) continue;

        const creado = new Date(ticket.fechaCreacion).getTime();
        const deadline = creado + prioridad.vigenciaHoras! * 3600000;
        const warnAt = deadline - (prioridad.avisoHoras || 0) * 3600000;

        let nivel: 'warning' | 'expired' | null = null;
        if (ahora >= deadline) nivel = 'expired';
        else if (ahora >= warnAt) nivel = 'warning';
        if (!nivel || ticket.slaAvisoNivel === nivel) continue;

        const destinatarios = new Set<number>();
        if (ticket.asignadoUsuarioId) destinatarios.add(Number(ticket.asignadoUsuarioId));
        for (const extra of avisosExtra) {
          if (Number(extra.ticketPrioridadId) === Number(prioridad.id)) destinatarios.add(Number(extra.usuarioId));
        }

        candidatos.push({ ticket, nivel, destinatarios });
        if (candidatos.length >= NotificacionesService.MAX_AVISOS_SLA_POR_CICLO) break;
      }
      if (candidatos.length === 0) return;

      // IMPORTANTE: se marca el ticket (slaAvisoNivel) ANTES de notificar, y
      // solo se notifica si ese PATCH tuvo éxito (ver tap() abajo) — antes se
      // notificaba primero y se intentaba marcar después; si el PATCH fallaba
      // (p.ej. 504 por la carga de la prueba de rendimiento) el ticket se
      // quedaba "sin marcar" para siempre y volvía a calificar como candidato
      // en CADA ciclo de 5 min, generando un aviso duplicado cada vez —  un
      // "notification storm" que además alimentaba más carga sobre la base de
      // datos. Con este orden, un PATCH que falla simplemente no notifica ese
      // ciclo (se reintenta solo, sin duplicar, cuando la base de datos pueda).
      await firstValueFrom(
        from(candidatos).pipe(
          mergeMap(
            ({ ticket, nivel, destinatarios }) =>
              this.data.modificacion<Ticket>('Ticket', { ...ticket, slaAvisoNivel: nivel }).pipe(
                tap(() => {
                  const titulo =
                    nivel === 'expired'
                      ? `🔥 SLA vencido: #${ticket.numeroTicket} — ${ticket.titulo}`
                      : `⏰ SLA por vencer: #${ticket.numeroTicket} — ${ticket.titulo}`;
                  const link = `/proyectos/tablero?ticket=${ticket.id}`;
                  for (const usuarioId of destinatarios) {
                    this.notificar(usuarioId, titulo, link);
                  }
                }),
                catchError((error) => {
                  console.warn('No se pudo marcar el aviso de SLA como enviado (no se notifica este ciclo):', error);
                  return of(null);
                }),
              ),
            NotificacionesService.CONCURRENCIA_AVISOS_SLA,
          ),
          toArray(),
        ),
      );
    } catch (error) {
      console.warn('No se pudo revisar el SLA de los tickets:', error);
    }
  }

  /**
   * Alertas de tarjeta de crédito: uso ≥90% del límite, y recordatorio 3 días
   * antes (o el mismo día) de la fecha de pago cuando hay deuda pendiente —
   * mismo patrón que revisarSlaTickets (llamado periódicamente desde
   * ShellComponent), pero con su propio dedupe por ciclo (AvisoTarjetaCiclo, ver
   * ese modelo) porque CuentaPresupuesto es un catálogo compartido entre
   * usuarios y no puede guardar ahí una bandera "ya avisado" por usuario.
   */
  async revisarAlertasTarjetas(): Promise<void> {
    const usuarioId = this.auth.usuarioActual()?.id;
    if (!usuarioId) return;
    try {
      const [cuentas, movimientos, avisos] = await Promise.all([
        firstValueFrom(this.data.list<CuentaPresupuesto>('CuentaPresupuesto')),
        firstValueFrom(this.data.list<MovimientoPresupuesto>('MovimientoPresupuesto')),
        firstValueFrom(this.data.list<AvisoTarjetaCiclo>('AvisoTarjetaCiclo', { usuarioId })),
      ]);

      const hoy = new Date();
      const hoySinHora = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
      const cicloActual = `${hoy.getFullYear()}-${hoy.getMonth() + 1}`;
      const yaAvisado = (cuentaId: number, tipoAviso: 'uso' | 'pago', ciclo: string): boolean =>
        avisos.some((a) => Number(a.cuentaPresupuestoId) === cuentaId && a.tipoAviso === tipoAviso && a.ciclo === ciclo);
      // Se registra el aviso (dedupe) ANTES de notificar, y solo se notifica
      // si ese registro tuvo éxito — si el registro falla (p.ej. un 504
      // transitorio), NO se notifica: así no se repite el mismo aviso en cada
      // ciclo de 5 min mientras la escritura siga fallando (mismo ajuste que
      // revisarSlaTickets, ver su comentario).
      const registrarAvisoYNotificar = (
        cuentaId: number,
        tipoAviso: 'uso' | 'pago',
        ciclo: string,
        titulo: string,
      ): void => {
        this.data.alta<AvisoTarjetaCiclo>('AvisoTarjetaCiclo', { cuentaPresupuestoId: cuentaId, usuarioId, tipoAviso, ciclo }).subscribe({
          next: () => this.notificar(usuarioId, titulo, '/presupuesto/movimientos'),
          error: (error) => console.warn('No se pudo registrar el aviso de tarjeta (no se notifica):', error),
        });
      };

      for (const cuenta of cuentas) {
        if (cuenta.tipo !== 'Tarjeta') continue;
        const cuentaId = Number(cuenta.id);
        const saldo = movimientos
          .filter((m) => Number(m.cuentaPresupuestoId) === cuentaId)
          .reduce((s, m) => s + (m.tipo === 'Ingreso' ? m.monto : -m.monto), 0);
        const info = infoTarjeta(cuenta, saldo, hoy);

        if (info.pctUso >= 90 && !yaAvisado(cuentaId, 'uso', cicloActual)) {
          registrarAvisoYNotificar(
            cuentaId,
            'uso',
            cicloActual,
            `💳 "${cuenta.nombre}" ya usó el ${info.pctUso.toFixed(0)}% de su límite de crédito.`,
          );
        }

        if (info.deuda > 0 && info.proximaFechaPago) {
          const diasRestantes = Math.round((info.proximaFechaPago.getTime() - hoySinHora.getTime()) / 86400000);
          if (diasRestantes >= 0 && diasRestantes <= 3) {
            const cicloPago = `${info.proximaFechaPago.getFullYear()}-${info.proximaFechaPago.getMonth() + 1}`;
            if (!yaAvisado(cuentaId, 'pago', cicloPago)) {
              const cuando = diasRestantes === 0 ? 'hoy' : diasRestantes === 1 ? 'mañana' : `en ${diasRestantes} días`;
              registrarAvisoYNotificar(
                cuentaId,
                'pago',
                cicloPago,
                `📅 El pago de "${cuenta.nombre}" (${formatMoneda(info.deuda)}) vence ${cuando}.`,
              );
            }
          }
        }
      }
    } catch (error) {
      console.warn('No se pudo revisar las alertas de tarjetas:', error);
    }
  }

  /**
   * Alerta de stock bajo: productos físicos activos con al menos una
   * alerta (global O por bodega, ver alertasStockBajo() en producto.util.ts)
   * ya por debajo de su mínimo — mismo criterio que `stockBajo` en
   * valor-stock.component.ts, pero llevado a una notificación real en la
   * campanita (antes solo se veía si entrabas a esa pantalla). Dedupe por
   * día Y por bodega vía AvisoStockBajo (ver ese modelo): si el producto
   * sigue bajo al día siguiente, o sigue bajo en otra bodega distinta, se
   * vuelve a avisar.
   */
  async revisarAlertasStockBajo(): Promise<void> {
    const usuarioId = this.auth.usuarioActual()?.id;
    if (!usuarioId) return;
    try {
      const hoy = new Date();
      const dia = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;

      // listarPagina() en vez de list(): con Producto en cientos de miles de
      // filas (ver comentario de LIMITE_PRODUCTOS_STOCK_POR_CICLO), traer y
      // recorrer la tabla completa en memoria cada 5 min ya era costoso por
      // sí solo, antes de siquiera llegar al fan-out de abajo.
      const [{ filas: productos }, existenciasBodega, nivelesMinimoBodega, avisos] = await Promise.all([
        firstValueFrom(
          this.data.listarPagina<Producto>('Producto', {}, 0, NotificacionesService.LIMITE_PRODUCTOS_STOCK_POR_CICLO),
        ),
        firstValueFrom(this.data.list<ExistenciaBodega>('ExistenciaBodega')),
        firstValueFrom(this.data.list<NivelMinimoBodega>('NivelMinimoBodega')),
        firstValueFrom(this.data.list<AvisoStockBajo>('AvisoStockBajo', { usuarioId, dia })),
      ]);
      // Dedupe por producto Y bodega (bodegaId null = evaluación global
      // heredada) — un mismo producto puede tener varias bodegas bajas a la
      // vez, cada una con su propio aviso. Ver alertasStockBajo() en
      // producto.util.ts y el comentario en aviso-stock-bajo.model.ts.
      const yaAvisado = (productoId: number, bodegaId: number | null) =>
        avisos.some((a) => Number(a.productoId) === productoId && (a.bodegaId ?? null) === bodegaId);

      // Se arma la lista de candidatos ANTES de escribir nada (igual que
      // revisarSlaTickets) para poder acotar el fan-out de escrituras con
      // mergeMap(..., CONCURRENCIA_AVISOS_STOCK) en vez de disparar todas las
      // peticiones de golpe (con miles de productos bajos de stock a la vez,
      // eso era justo lo que tronaba el navegador: "TypeError: Failed to
      // fetch" por cientos/miles de peticiones simultáneas).
      type Candidato = { producto: Producto; bodegaId: number | null; existencia: number; nivelMinimo: number };
      const candidatos: Candidato[] = [];
      outer: for (const producto of productos) {
        if (!producto.activo) continue;
        for (const alerta of alertasStockBajo(producto, existenciasBodega, nivelesMinimoBodega)) {
          if (yaAvisado(producto.id, alerta.bodegaId)) continue;
          candidatos.push({ producto, bodegaId: alerta.bodegaId, existencia: alerta.existencia, nivelMinimo: alerta.nivelMinimo });
          if (candidatos.length >= NotificacionesService.MAX_AVISOS_STOCK_POR_CICLO) break outer;
        }
      }
      if (candidatos.length === 0) return;

      await firstValueFrom(
        from(candidatos).pipe(
          mergeMap(
            ({ producto, bodegaId, existencia, nivelMinimo }) =>
              this.data.alta<AvisoStockBajo>('AvisoStockBajo', { productoId: producto.id, bodegaId, usuarioId, dia }).pipe(
                tap(() =>
                  this.notificar(
                    usuarioId,
                    `📉 "${producto.nombre}" tiene ${existencia} de existencia, por debajo de su mínimo (${nivelMinimo}).`,
                    '/inventario/valor-stock',
                  ),
                ),
                catchError((error) => {
                  console.warn('No se pudo registrar el aviso de stock bajo (no se notifica este ciclo):', error);
                  return of(null);
                }),
              ),
            NotificacionesService.CONCURRENCIA_AVISOS_STOCK,
          ),
          toArray(),
        ),
      );
    } catch (error) {
      console.warn('No se pudo revisar las alertas de stock bajo:', error);
    }
  }

  /**
   * Alerta de orden de compra vencida: 'pendiente' o 'recibida_parcial' con
   * fechaEntregaEstimada ya pasada — mismo patrón de dedupe diario que
   * revisarAlertasStockBajo (ver AvisoOrdenVencida), así que si sigue
   * vencida al día siguiente se vuelve a avisar una vez por día en vez de
   * en cada ciclo del intervalo. Una orden 'recibida_completa' o
   * 'cancelada' nunca entra aquí, y una sin fechaEntregaEstimada capturada
   * tampoco (no hay con qué comparar).
   */
  async revisarOrdenesVencidas(): Promise<void> {
    const usuarioId = this.auth.usuarioActual()?.id;
    if (!usuarioId) return;
    try {
      const hoy = new Date();
      const dia = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
      const hoyTexto = dia;

      const [ordenes, avisos] = await Promise.all([
        firstValueFrom(this.data.list<OrdenCompra>('OrdenCompra')),
        firstValueFrom(this.data.list<AvisoOrdenVencida>('AvisoOrdenVencida', { usuarioId, dia })),
      ]);
      const yaAvisado = (ordenCompraId: number) => avisos.some((a) => Number(a.ordenCompraId) === ordenCompraId);

      for (const orden of ordenes) {
        if (orden.estado !== 'pendiente' && orden.estado !== 'recibida_parcial') continue;
        if (!orden.fechaEntregaEstimada) continue;
        if (orden.fechaEntregaEstimada.slice(0, 10) >= hoyTexto) continue; // todavía no vence
        if (yaAvisado(orden.id)) continue;

        // Mismo orden que revisarSlaTickets/revisarAlertasTarjetas/
        // revisarAlertasStockBajo: se registra primero y solo se notifica si
        // el registro tuvo éxito, para no repetir el aviso cada ciclo si la
        // escritura falla.
        this.data.alta<AvisoOrdenVencida>('AvisoOrdenVencida', { ordenCompraId: orden.id, usuarioId, dia }).subscribe({
          next: () =>
            this.notificar(
              usuarioId,
              `📦 La orden ${orden.folio} ya pasó su fecha de entrega estimada y sigue sin completarse.`,
              '/inventario/ordenes-compra',
            ),
          error: (error) => console.warn('No se pudo registrar el aviso de orden vencida (no se notifica):', error),
        });
      }
    } catch (error) {
      console.warn('No se pudo revisar las órdenes de compra vencidas:', error);
    }
  }
}

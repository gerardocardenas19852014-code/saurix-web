import { Injectable, inject } from '@angular/core';
import { Observable, from, of } from 'rxjs';
import { FunctionsHttpError, PostgrestError } from '@supabase/supabase-js';
import { DataClientService, FiltroNulo, FiltroRango, ResultadoPagina, OrdenPagina, FiltroBusqueda, FILTRO_BUSQUEDA, OpcionesEscritura } from './data-client.service';

function esFiltroRango(valor: unknown): valor is FiltroRango {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor) && ('gte' in valor || 'lte' in valor);
}

function esFiltroNulo(valor: unknown): valor is FiltroNulo {
  return typeof valor === 'object' && valor !== null && (valor as FiltroNulo).esNulo === true;
}
import { SupabaseService } from './supabase.service';
import { DefinicionTabla, definicionTabla, entidadExiste } from './supabase-esquema';
import { ToastService } from '../../shared/services/toast.service';

const BUCKET_ADJUNTOS = 'adjuntos';
const TAMANO_PAGINA = 1000;
const SEGUNDOS_URL_FIRMADA = 60 * 60;
/** Columnas que solo escribe la base (triggers / identidad), nunca la app. */
const SOLO_LECTURA = new Set(['id', 'fechaCreacion', 'fechaModificacion', 'modificadoPor', 'authUserId']);

type Fila = Record<string, unknown>;

const snakeACamel = (s: string): string => s.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());

/** Fila de Postgres (snake_case) → objeto de la app (camelCase). */
export function filaACamel(fila: Fila): Fila {
  const salida: Fila = {};
  for (const [clave, valor] of Object.entries(fila)) salida[snakeACamel(clave)] = valor;
  return salida;
}

/** Objeto de la app → columnas de la tabla. Ignora campos que la tabla no
 *  tiene (p.ej. `password`, `confirmacionPassword`) y convierte '' a null en
 *  columnas que no son de texto (fechas, números), que Postgres rechazaría. */
function dtoASnake(def: DefinicionTabla, dto: Fila): Fila {
  const salida: Fila = {};
  for (const [clave, valor] of Object.entries(dto)) {
    if (SOLO_LECTURA.has(clave) || valor === undefined) continue;
    const columna = def.columnas.get(clave);
    if (!columna) continue;
    let v = valor;
    if (v === '' && columna.tipo !== 't') v = null;
    // Los formularios usan 0 como "sin seleccionar" en los combos (cuenta,
    // categoría…); en Postgres eso sería una llave foránea inexistente.
    if (v === 0 && columna.snake.endsWith('_id')) v = null;
    if (columna.tipo === 'n' && typeof v === 'string') {
      const n = Number(v);
      v = Number.isFinite(n) ? n : null;
    }
    salida[columna.snake] = v;
  }
  return salida;
}

function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function esTablaAdjuntos(def: DefinicionTabla): boolean {
  return def.columnas.has('rutaStorage');
}

/** Campo FK al padre en una tabla de adjuntos (p.ej. 'ticketId'). */
function campoPadreAdjunto(def: DefinicionTabla): string | undefined {
  for (const clave of def.columnas.keys()) {
    if (clave !== 'id' && clave.endsWith('Id')) return clave;
  }
  return undefined;
}

function mensajeError(error: unknown): string {
  const e = error as Partial<PostgrestError> & { message?: string };
  switch (e?.code) {
    case '23505':
      return 'Ya existe un registro con esos datos.';
    case '23503':
      return 'No se puede completar: hay registros relacionados con este.';
    case '23514':
    case '23502':
      return 'Algún dato no es válido o falta un campo obligatorio.';
    case '42501':
      return 'No tienes permiso para esta operación.';
    case 'PGRST116':
      return 'No se encontró el registro o no tienes permiso para verlo.';
  }
  return e?.message || 'Ocurrió un error al comunicarse con la base de datos.';
}

/**
 * Implementación de DataClientService sobre Supabase (Postgres + Storage).
 * Ninguna pantalla depende de esta clase directamente (todas dependen solo
 * del contrato DataClientService):
 *  - la entidad ('MovimientoPresupuesto') se traduce a esquema.tabla
 *    (presupuesto.movimiento_presupuesto) con el mapa de supabase-esquema.ts;
 *  - los campos viajan camelCase ↔ snake_case;
 *  - el filtro de list() se comporta así: texto = contiene (sin
 *    mayúsculas), resto = igualdad exacta;
 *  - las entidades *Adjunto guardan el archivo en Storage (bucket
 *    "adjuntos") y devuelven en `contenido` una URL firmada temporal, para
 *    que `<a [href]="adjunto.contenido">` siga funcionando;
 *  - 'Usuario' crea / cambia contraseña / elimina la cuenta de acceso
 *    (Supabase Auth) vía la Edge Function "admin-usuarios".
 * Qué ve cada usuario lo deciden las reglas RLS en la base, no este servicio.
 */
@Injectable({ providedIn: 'root' })
export class SupabaseDataClientService extends DataClientService {
  private readonly supabase = inject(SupabaseService);
  private readonly sb = this.supabase.cliente;
  private readonly toast = inject(ToastService);

  override list<T>(entidad: string, filtro?: Record<string, unknown>): Observable<T[]> {
    // Entidades construidas primero en el frontend y aún sin migrar a
    // Supabase (ver esquema-tablas-saurix.md del proyecto Claude): en vez
    // de tronar con un toast de error cada vez que la pantalla carga, se
    // degradan a "sin datos todavía" — mismo espíritu que el resto de la
    // app, donde el frontend va por delante del backend real.
    // alta/modificacion/baja siguen fallando fuerte (nunca ocultar que una
    // escritura no se guardó).
    if (!entidadExiste(entidad)) {
      console.warn(`[Supabase] '${entidad}' aún no existe en Supabase (ver supabase-esquema.ts) — list() regresa [] en vez de un error.`);
      return of([]);
    }
    return from(this.conToast(() => this.listar(entidad, filtro))) as Observable<T[]>;
  }

  override getById<T>(entidad: string, id: number): Observable<T> {
    return from(this.conToast(() => this.obtener(entidad, id))) as Observable<T>;
  }

  override alta<T>(entidad: string, dto: Partial<T>, opciones?: OpcionesEscritura): Observable<T> {
    return from(this.conToast(() => this.insertar(entidad, dto as Fila), opciones?.silencioso)) as Observable<T>;
  }

  override modificacion<T>(entidad: string, dto: Partial<T> & { id: number }): Observable<T> {
    return from(this.conToast(() => this.actualizar(entidad, dto as Fila & { id: number }))) as Observable<T>;
  }

  override baja(entidad: string, id: number): Observable<void> {
    return from(this.conToast(() => this.eliminar(entidad, id)));
  }

  override listarPagina<T>(
    entidad: string,
    filtro: Record<string, unknown> | undefined,
    desde: number,
    cantidad: number,
    orden?: OrdenPagina,
  ): Observable<ResultadoPagina<T>> {
    if (!entidadExiste(entidad)) return of({ filas: [], total: 0 });
    return from(this.conToast(() => this.listarUnaPagina(entidad, filtro, desde, cantidad, orden))) as Observable<
      ResultadoPagina<T>
    >;
  }

  // ── Operaciones ─────────────────────────────────────────────────────────

  private tabla(def: DefinicionTabla) {
    return this.sb.schema(def.esquema).from(def.tabla);
  }

  /** true si el filtro ya se sabe que no puede coincidir con nada (columna
   *  inexistente, o un arreglo vacío como "está en esta lista" de 0 valores)
   *  — tanto listar() como listarPagina() necesitan cortar temprano en ese
   *  caso, antes de siquiera construir la consulta. */
  private filtroImposible(def: DefinicionTabla, filtro?: Record<string, unknown>): boolean {
    for (const [clave, valor] of Object.entries(filtro ?? {})) {
      if (valor === null || valor === undefined || valor === '') continue;
      if (clave === FILTRO_BUSQUEDA) continue; // se valida aparte en aplicarFiltros()
      if (!def.columnas.get(clave)) return true;
      if (Array.isArray(valor) && valor.length === 0) return true;
    }
    return false;
  }

  /** Arma la consulta de Supabase aplicando el mismo contrato de filtro que
   *  describe DataClientService.list() (valor simple, arreglo/IN, FiltroRango)
   *  — compartido entre listar() (trae todo, paginando internamente) y
   *  listarPagina() (trae solo una página, con total real vía `count`). */
  private aplicarFiltros<
    Consulta extends { ilike: Function; eq: Function; in: Function; gte: Function; lte: Function; is: Function; or: Function },
  >(consulta: Consulta, def: DefinicionTabla, filtro?: Record<string, unknown>): Consulta {
    for (const [clave, valor] of Object.entries(filtro ?? {})) {
      if (valor === null || valor === undefined || valor === '') continue;
      // Caja de búsqueda sobre varias columnas de texto a la vez (OR) — ver
      // FiltroBusqueda en data-client.service.ts. Las columnas inexistentes
      // en ESTA entidad se descartan en silencio (nunca se manda al ORDER/
      // WHERE un nombre de columna que no exista).
      if (clave === FILTRO_BUSQUEDA) {
        const { columnas, texto } = valor as FiltroBusqueda;
        const textoLimpio = texto?.trim();
        if (!textoLimpio) continue;
        const columnasReales = columnas
          .map((c) => def.columnas.get(c)?.snake)
          .filter((snake): snake is string => !!snake);
        if (columnasReales.length === 0) continue;
        // El valor va entre comillas dobles (sintaxis de .or() de PostgREST)
        // para que una coma o un paréntesis en lo que alguien escriba no
        // rompa el parseo de la condición combinada; escaparLike() ya cuida
        // el significado de %/_/\ dentro del propio patrón LIKE.
        const patron = `%${escaparLike(textoLimpio).replace(/"/g, '\\"')}%`;
        const condicion = columnasReales.map((snake) => `${snake}.ilike."${patron}"`).join(',');
        consulta = consulta.or(condicion);
        continue;
      }
      const columna = def.columnas.get(clave);
      if (!columna) continue;
      // Un arreglo = "está en esta lista" (ver DashboardVentasComponent:
      // pedir VentaItem/VentaPago solo de un conjunto acotado de ventaId,
      // en vez de traer la tabla completa y filtrar en el navegador — el
      // patrón que causaba timeouts en el dashboard con historial largo).
      if (Array.isArray(valor)) {
        consulta = consulta.in(columna.snake, valor);
        continue;
      }
      // {gte, lte} = acotar una tabla que crece sin límite (bitácora,
      // movimientos) a un rango de fechas en vez de traerla completa.
      if (esFiltroRango(valor)) {
        if (valor.gte !== undefined) consulta = consulta.gte(columna.snake, valor.gte);
        if (valor.lte !== undefined) consulta = consulta.lte(columna.snake, valor.lte);
        continue;
      }
      // {esNulo: true} = "columna IS NULL" (p.ej. Ticket.sprintId vacío = el
      // backlog sin asignar a ningún sprint) — un valor simple `null` en el
      // filtro se trata como "sin filtro" (ver arriba), así que hace falta
      // este marcador explícito para de verdad pedirlo.
      if (esFiltroNulo(valor)) {
        consulta = consulta.is(columna.snake, null);
        continue;
      }
      consulta =
        typeof valor === 'string' && columna.tipo === 't'
          ? consulta.ilike(columna.snake, `%${escaparLike(valor)}%`)
          : consulta.eq(columna.snake, valor);
    }
    return consulta;
  }

  /** Páginas siguientes a la primera (ver listar()), traídas en PARALELO
   *  con un tope de concurrencia — nunca todas a la vez (eso reproduciría
   *  un bug de fan-out sin límite ya visto en este repo) ni todas en serie
   *  una por una (eso era exactamente el problema: con un catálogo de
   *  200,000+ filas — ver inventario.producto tras la prueba de
   *  rendimiento — list() hacía ~200 peticiones en fila, cada una
   *  esperando a la anterior, dejando la pantalla en "Cargando…" decenas
   *  de segundos sin ningún error). */
  private static readonly CONCURRENCIA_PAGINAS = 6;

  private async listar(entidad: string, filtro?: Record<string, unknown>): Promise<Fila[]> {
    const def = definicionTabla(entidad);
    if (this.filtroImposible(def, filtro)) return [];

    // Primera página con count exacto: con eso ya se sabe cuántas páginas
    // más hacen falta, sin tener que ir descubriéndolo una por una.
    const primera = this.aplicarFiltros(this.tabla(def).select('*', { count: 'exact' }), def, filtro);
    const { data: datosIniciales, error: errorInicial, count } = await primera.order('id').range(0, TAMANO_PAGINA - 1);
    if (errorInicial) throw errorInicial;
    const filas: Fila[] = [...((datosIniciales ?? []) as Fila[])];
    const total = count ?? filas.length;

    const desdeRestantes: number[] = [];
    for (let desde = TAMANO_PAGINA; desde < total; desde += TAMANO_PAGINA) desdeRestantes.push(desde);

    for (let i = 0; i < desdeRestantes.length; i += SupabaseDataClientService.CONCURRENCIA_PAGINAS) {
      const lote = desdeRestantes.slice(i, i + SupabaseDataClientService.CONCURRENCIA_PAGINAS);
      const resultadosLote = await Promise.all(
        lote.map(async (desde) => {
          const consulta = this.aplicarFiltros(this.tabla(def).select('*'), def, filtro);
          const { data, error } = await consulta.order('id').range(desde, desde + TAMANO_PAGINA - 1);
          if (error) throw error;
          return (data ?? []) as Fila[];
        }),
      );
      // Promise.all conserva el orden de `lote` en `resultadosLote` (no el
      // orden en que cada petición respondió), así que el resultado final
      // sigue viniendo ordenado por id ascendente, igual que antes.
      for (const pagina of resultadosLote) filas.push(...pagina);
    }

    const resultado = filas.map(filaACamel);
    return esTablaAdjuntos(def) ? this.firmarAdjuntos(resultado) : resultado;
  }

  private async listarUnaPagina(
    entidad: string,
    filtro: Record<string, unknown> | undefined,
    desde: number,
    cantidad: number,
    orden?: OrdenPagina,
  ): Promise<ResultadoPagina<Fila>> {
    const def = definicionTabla(entidad);
    if (this.filtroImposible(def, filtro)) return { filas: [], total: 0 };
    let consulta = this.aplicarFiltros(this.tabla(def).select('*', { count: 'exact' }), def, filtro);
    // Whitelist de la columna de orden: solo se acepta si es un campo real
    // y conocido de ESTA entidad (def.columnas, el mismo mapa camelCase ->
    // snake_case que ya usa aplicarFiltros()) — nunca se manda tal cual al
    // ORDER BY un nombre de columna que vino del cliente. Si no coincide con
    // ninguna columna conocida, se ignora y se mantiene el orden por `id` de
    // siempre (nunca se rompe por un nombre de columna inesperado).
    const columnaOrden = orden ? def.columnas.get(orden.columna)?.snake : undefined;
    const ascendente = orden?.direccion !== 'desc';
    if (columnaOrden && columnaOrden !== 'id') {
      // `id` siempre como desempate final, para un orden estable aunque
      // haya varias filas con el mismo valor en la columna elegida.
      consulta = consulta.order(columnaOrden, { ascending: ascendente }).order('id', { ascending: true });
    } else {
      consulta = consulta.order('id', { ascending: columnaOrden ? ascendente : true });
    }
    const { data, error, count } = await consulta.range(desde, desde + cantidad - 1);
    if (error) throw error;
    const filas = (data ?? []).map(filaACamel);
    return {
      filas: esTablaAdjuntos(def) ? await this.firmarAdjuntos(filas) : filas,
      total: count ?? filas.length,
    };
  }

  private async obtener(entidad: string, id: number): Promise<Fila> {
    const def = definicionTabla(entidad);
    const { data, error } = await this.tabla(def).select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(`No se encontró el registro ${id} en ${entidad}.`);
    const fila = filaACamel(data as Fila);
    return esTablaAdjuntos(def) ? (await this.firmarAdjuntos([fila]))[0] : fila;
  }

  private async insertar(entidad: string, dto: Fila): Promise<Fila> {
    if (entidad === 'Usuario') return this.crearUsuario(dto);
    const def = definicionTabla(entidad);
    if (esTablaAdjuntos(def)) return this.insertarAdjunto(entidad, def, dto);

    const { data, error } = await this.tabla(def).insert(dtoASnake(def, dto)).select().single();
    if (error) throw error;
    return filaACamel(data as Fila);
  }

  private async actualizar(entidad: string, dto: Fila & { id: number }): Promise<Fila> {
    if (entidad === 'Usuario') return this.actualizarUsuario(dto);
    const def = definicionTabla(entidad);
    const cambios = dtoASnake(def, dto);
    if (esTablaAdjuntos(def)) {
      delete cambios['ruta_storage'];
      delete cambios['tamano_bytes'];
    }
    const { data, error } = await this.tabla(def).update(cambios).eq('id', dto.id).select().single();
    if (error) throw error;
    const fila = filaACamel(data as Fila);
    return esTablaAdjuntos(def) ? (await this.firmarAdjuntos([fila]))[0] : fila;
  }

  private async eliminar(entidad: string, id: number): Promise<void> {
    if (entidad === 'Usuario') {
      await this.invocarAdminUsuarios({ accion: 'eliminar', usuarioId: id });
      return;
    }
    const def = definicionTabla(entidad);
    let ruta: string | null = null;
    if (esTablaAdjuntos(def)) {
      const { data } = await this.tabla(def).select('ruta_storage').eq('id', id).maybeSingle();
      ruta = (data as { ruta_storage?: string } | null)?.ruta_storage ?? null;
    }
    const { error } = await this.tabla(def).delete().eq('id', id);
    if (error) throw error;
    if (ruta) await this.sb.storage.from(BUCKET_ADJUNTOS).remove([ruta]);
  }

  // ── Adjuntos (Storage) ──────────────────────────────────────────────────

  private async insertarAdjunto(entidad: string, def: DefinicionTabla, dto: Fila): Promise<Fila> {
    const contenido = dto['contenido'];
    if (typeof contenido !== 'string' || !contenido) throw new Error('El adjunto no trae contenido.');
    const blob = await (await fetch(contenido)).blob();
    const nombre = String(dto['nombreArchivo'] ?? 'archivo');
    const campoPadre = campoPadreAdjunto(def);
    const padre = campoPadre ? String(dto[campoPadre] ?? 'sin-padre') : 'sin-padre';
    const nombreSeguro = nombre.normalize('NFD').replace(/[^\w.-]+/g, '_');
    const prefijo = await this.supabase.prefijoEmpresa();
    const ruta = `${prefijo}/${entidad}/${padre}/${crypto.randomUUID()}-${nombreSeguro}`;

    const almacen = this.sb.storage.from(BUCKET_ADJUNTOS);
    const { error: errSubida } = await almacen.upload(ruta, blob, {
      contentType: String(dto['tipoContenido'] ?? blob.type ?? 'application/octet-stream'),
      upsert: false,
    });
    if (errSubida) throw errSubida;

    const fila = dtoASnake(def, { ...dto, rutaStorage: ruta, tamanoBytes: blob.size });
    const { data, error } = await this.tabla(def).insert(fila).select().single();
    if (error) {
      await almacen.remove([ruta]);
      throw error;
    }
    return (await this.firmarAdjuntos([filaACamel(data as Fila)]))[0];
  }

  /** Pone en `contenido` una URL temporal de descarga para cada adjunto. */
  private async firmarAdjuntos(filas: Fila[]): Promise<Fila[]> {
    const almacen = this.sb.storage.from(BUCKET_ADJUNTOS);
    return Promise.all(
      filas.map(async (fila) => {
        const ruta = fila['rutaStorage'];
        if (typeof ruta !== 'string' || !ruta) return { ...fila, contenido: '' };
        const nombre = fila['nombreArchivo'];
        const { data } = await almacen.createSignedUrl(ruta, SEGUNDOS_URL_FIRMADA, {
          download: typeof nombre === 'string' && nombre ? nombre : true,
        });
        return { ...fila, contenido: data?.signedUrl ?? '' };
      }),
    );
  }

  // ── Usuarios (cuenta de acceso en Supabase Auth) ────────────────────────

  private async crearUsuario(dto: Fila): Promise<Fila> {
    const def = definicionTabla('Usuario');
    const password = typeof dto['password'] === 'string' ? dto['password'] : '';
    const respuesta = await this.invocarAdminUsuarios<{ usuario: Fila }>({
      accion: 'crear',
      perfil: dtoASnake(def, dto),
      password,
    });
    return filaACamel(respuesta.usuario);
  }

  /** Perfil + cuenta de acceso (Auth) en UNA sola intención, coordinada
   *  server-side por la Edge Function "admin-usuarios" (acción 'actualizar'):
   *  primero actualiza seguridad.usuario (una sola instrucción SQL, todo o
   *  nada) y SOLO DESPUÉS sincroniza correo/contraseña en Supabase Auth. Si
   *  el perfil falla, nada cambió (Auth ni se tocó). Si el perfil se guarda
   *  pero la sincronización de Auth falla (red, límite, etc.), el perfil YA
   *  queda correcto y consistente — nunca se revierte, porque no hay nada
   *  que corregir ahí — y la cuenta sigue aceptando las credenciales
   *  anteriores (nadie queda bloqueado); el aviso que regresa la función se
   *  muestra como advertencia para que se reintente solo la sincronización.
   *  Supabase Auth y Postgres no comparten una transacción ACID real: esto
   *  es deliberado, nunca se simula una atomicidad que no existe. */
  private async actualizarUsuario(dto: Fila & { id: number }): Promise<Fila> {
    const def = definicionTabla('Usuario');
    const password = typeof dto['password'] === 'string' ? dto['password'] : '';
    const respuesta = await this.invocarAdminUsuarios<{ usuario: Fila; authSincronizado: boolean; avisoAuth?: string }>({
      accion: 'actualizar',
      usuarioId: dto.id,
      perfil: dtoASnake(def, dto),
      password,
    });
    if (respuesta.avisoAuth) this.toast.advertencia(respuesta.avisoAuth);
    return filaACamel(respuesta.usuario);
  }

  private async invocarAdminUsuarios<R = unknown>(cuerpo: Record<string, unknown>): Promise<R> {
    const { data, error } = await this.sb.functions.invoke('admin-usuarios', { body: cuerpo });
    if (error) {
      if (error instanceof FunctionsHttpError) {
        const detalle = await error.context.json().catch(() => null);
        throw new Error(detalle?.error ?? 'No se pudo completar la operación de usuario.');
      }
      throw error;
    }
    return data as R;
  }

  // ── Errores ─────────────────────────────────────────────────────────────

  /** Muestra el error en un toast (igual que el interceptor HTTP) y lo
   *  deja propagarse para que la pantalla también pueda reaccionar.
   *  `silencioso`: omite el toast (el error se sigue propagando igual) —
   *  ver OpcionesEscritura en data-client.service.ts. */
  private async conToast<R>(operacion: () => Promise<R>, silencioso = false): Promise<R> {
    try {
      return await operacion();
    } catch (error) {
      const mensaje = mensajeError(error);
      if (!silencioso) this.toast.error(mensaje);
      throw error instanceof Error ? error : new Error(mensaje);
    }
  }
}

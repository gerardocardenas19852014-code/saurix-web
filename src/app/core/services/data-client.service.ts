import { Observable } from 'rxjs';

/**
 * Contrato único para acceder a los datos de cualquier entidad del sistema,
 * usando siempre la misma convención lógica que los servicios REST de
 * PlataformaSaurix: una "entidad" (coincide con el nombre del Controller
 * en el backend, p.ej. 'Usuario', 'Proyecto', 'MovimientoPresupuesto') y
 * una acción {GetList, GetById, Alta, Modificacion, Baja}.
 *
 * HOY la implementación activa (ver app.config.ts) es `IndexedDbDataClientService`:
 * todo se guarda localmente en el navegador con IndexedDB, sin backend.
 *
 * CUANDO se conecte PlataformaSaurix (.NET) de verdad, existe ya
 * `HttpDataClientService`, que llama a los mismos endpoints
 * /api/{Entidad}/{Accion} que consume hoy el backend real. El cambio para
 * activarla es UNA sola línea en `app.config.ts` (el `provide` de esta
 * clase) — ningún componente ni pantalla necesita tocarse, porque todos
 * dependen únicamente de este contrato, nunca de la implementación.
 */
/**
 * Valor de filtro para un rango (columnas de fecha/número): "columna >= gte"
 * y/o "columna <= lte". Pensado para acotar tablas que crecen sin límite
 * (bitácora, movimientos, historiales) a una ventana de tiempo en vez de
 * traer la tabla completa — ver SupabaseDataClientService.listar().
 */
export interface FiltroRango {
  gte?: string | number;
  lte?: string | number;
}

/** Valor de filtro para "esta columna está vacía" (NULL) — un valor simple
 *  de `null` en el filtro se interpreta como "sin filtro" (ver list()), así
 *  que para de verdad pedir "columna IS NULL" (p.ej. Ticket.sprintId vacío =
 *  el backlog sin asignar a ningún sprint) hace falta este marcador. */
export interface FiltroNulo {
  esNulo: true;
}

/** Resultado de listarPagina(): la página pedida + el total real que hay
 *  (filtrado, antes de recortar a la página) — para poder mostrar "mostrando
 *  X de Y" y decidir si todavía hay más por cargar. */
export interface ResultadoPagina<T> {
  filas: T[];
  total: number;
}

export abstract class DataClientService {
  /**
   * Lista de registros de una entidad, con filtro opcional.
   * Cada clave del filtro admite: un valor simple (coincidencia parcial en
   * campos de texto, exacta en el resto), un arreglo ("está en esta
   * lista" / IN), o un `FiltroRango` ({gte, lte} — útil para acotar una
   * tabla grande a un rango de fechas en vez de traerla completa).
   */
  abstract list<T>(entidad: string, filtro?: Record<string, unknown>): Observable<T[]>;

  /** Un registro por id. */
  abstract getById<T>(entidad: string, id: number): Observable<T>;

  /** Alta de un registro nuevo. Devuelve el registro creado (con su id asignado). */
  abstract alta<T>(entidad: string, dto: Partial<T>): Observable<T>;

  /** Modificación de un registro existente (debe incluir `id`). Devuelve el registro actualizado. */
  abstract modificacion<T>(entidad: string, dto: Partial<T> & { id: number }): Observable<T>;

  /** Baja (eliminación) de un registro por id. */
  abstract baja(entidad: string, id: number): Observable<void>;

  /**
   * Como `list()`, pero trayendo solo una página (orden por `id`) en vez de
   * la tabla filtrada completa — pensado para catálogos que pueden crecer
   * mucho dentro de un mismo alcance (p.ej. Ticket de un solo proyecto con
   * decenas de miles de filas: ahí ni acotar por fecha ni por "activo"
   * alcanza para evitar traer todo de un jalón). `total` es la cantidad real
   * de filas que cumplen el filtro (sin recortar), para poder mostrar
   * "mostrando X de Y" y un "cargar más" que sepa cuándo ya no hay más.
   */
  abstract listarPagina<T>(
    entidad: string,
    filtro: Record<string, unknown> | undefined,
    desde: number,
    cantidad: number,
  ): Observable<ResultadoPagina<T>>;
}

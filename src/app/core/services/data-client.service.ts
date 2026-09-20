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
export abstract class DataClientService {
  /** Lista de registros de una entidad, con filtro opcional (coincidencia parcial en campos de texto, exacta en el resto). */
  abstract list<T>(entidad: string, filtro?: Record<string, unknown>): Observable<T[]>;

  /** Un registro por id. */
  abstract getById<T>(entidad: string, id: number): Observable<T>;

  /** Alta de un registro nuevo. Devuelve el registro creado (con su id asignado). */
  abstract alta<T>(entidad: string, dto: Partial<T>): Observable<T>;

  /** Modificación de un registro existente (debe incluir `id`). Devuelve el registro actualizado. */
  abstract modificacion<T>(entidad: string, dto: Partial<T> & { id: number }): Observable<T>;

  /** Baja (eliminación) de un registro por id. */
  abstract baja(entidad: string, id: number): Observable<void>;
}

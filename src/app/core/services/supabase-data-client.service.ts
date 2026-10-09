import { Injectable, inject } from '@angular/core';
import { Observable, from } from 'rxjs';
import { FunctionsHttpError, PostgrestError } from '@supabase/supabase-js';
import { DataClientService } from './data-client.service';
import { SupabaseService } from './supabase.service';
import { DefinicionTabla, definicionTabla } from './supabase-esquema';
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
 * Mismo contrato que IndexedDbDataClientService, así que ninguna pantalla
 * cambia:
 *  - la entidad ('MovimientoPresupuesto') se traduce a esquema.tabla
 *    (presupuesto.movimiento_presupuesto) con el mapa de supabase-esquema.ts;
 *  - los campos viajan camelCase ↔ snake_case;
 *  - el filtro de list() se comporta igual que en IndexedDB: texto =
 *    contiene (sin mayúsculas), resto = igualdad exacta;
 *  - las entidades *Adjunto guardan el archivo en Storage (bucket
 *    "adjuntos") y devuelven en `contenido` una URL firmada temporal, para
 *    que `<a [href]="adjunto.contenido">` siga funcionando;
 *  - 'Usuario' crea / cambia contraseña / elimina la cuenta de acceso
 *    (Supabase Auth) vía la Edge Function "admin-usuarios".
 * Qué ve cada usuario lo deciden las reglas RLS en la base, no este servicio.
 */
@Injectable({ providedIn: 'root' })
export class SupabaseDataClientService extends DataClientService {
  private readonly sb = inject(SupabaseService).cliente;
  private readonly toast = inject(ToastService);

  override list<T>(entidad: string, filtro?: Record<string, unknown>): Observable<T[]> {
    return from(this.conToast(() => this.listar(entidad, filtro))) as Observable<T[]>;
  }

  override getById<T>(entidad: string, id: number): Observable<T> {
    return from(this.conToast(() => this.obtener(entidad, id))) as Observable<T>;
  }

  override alta<T>(entidad: string, dto: Partial<T>): Observable<T> {
    return from(this.conToast(() => this.insertar(entidad, dto as Fila))) as Observable<T>;
  }

  override modificacion<T>(entidad: string, dto: Partial<T> & { id: number }): Observable<T> {
    return from(this.conToast(() => this.actualizar(entidad, dto as Fila & { id: number }))) as Observable<T>;
  }

  override baja(entidad: string, id: number): Observable<void> {
    return from(this.conToast(() => this.eliminar(entidad, id)));
  }

  // ── Operaciones ─────────────────────────────────────────────────────────

  private tabla(def: DefinicionTabla) {
    return this.sb.schema(def.esquema).from(def.tabla);
  }

  private async listar(entidad: string, filtro?: Record<string, unknown>): Promise<Fila[]> {
    const def = definicionTabla(entidad);
    const filas: Fila[] = [];
    for (let desde = 0; ; desde += TAMANO_PAGINA) {
      let consulta = this.tabla(def).select('*');
      for (const [clave, valor] of Object.entries(filtro ?? {})) {
        if (valor === null || valor === undefined || valor === '') continue;
        const columna = def.columnas.get(clave);
        // Igual que en IndexedDB: filtrar por un campo que el registro no
        // tiene no coincide con nada.
        if (!columna) return [];
        consulta =
          typeof valor === 'string' && columna.tipo === 't'
            ? consulta.ilike(columna.snake, `%${escaparLike(valor)}%`)
            : consulta.eq(columna.snake, valor);
      }
      const { data, error } = await consulta.order('id').range(desde, desde + TAMANO_PAGINA - 1);
      if (error) throw error;
      filas.push(...((data ?? []) as Fila[]));
      if (!data || data.length < TAMANO_PAGINA) break;
    }
    const resultado = filas.map(filaACamel);
    return esTablaAdjuntos(def) ? this.firmarAdjuntos(resultado) : resultado;
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
    const def = definicionTabla(entidad);
    if (entidad === 'Usuario') await this.sincronizarCuenta(dto);

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
    const ruta = `${entidad}/${padre}/${crypto.randomUUID()}-${nombreSeguro}`;

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

  /** Si cambió el correo o viene contraseña nueva, actualiza la cuenta de
   *  acceso antes de guardar el perfil. */
  private async sincronizarCuenta(dto: Fila & { id: number }): Promise<void> {
    const password = typeof dto['password'] === 'string' && dto['password'] ? dto['password'] : undefined;
    let email: string | undefined;
    if (typeof dto['email'] === 'string' && dto['email']) {
      const { data } = await this.sb.schema('seguridad').from('usuario').select('email').eq('id', dto.id).maybeSingle();
      const actual = (data as { email?: string } | null)?.email;
      if (actual && actual.toLowerCase() !== dto['email'].toLowerCase()) email = dto['email'];
    }
    if (!password && !email) return;
    await this.invocarAdminUsuarios({ accion: 'sincronizar', usuarioId: dto.id, email, password });
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
   *  deja propagarse para que la pantalla también pueda reaccionar. */
  private async conToast<R>(operacion: () => Promise<R>): Promise<R> {
    try {
      return await operacion();
    } catch (error) {
      const mensaje = mensajeError(error);
      this.toast.error(mensaje);
      throw error instanceof Error ? error : new Error(mensaje);
    }
  }
}

import { Injectable } from '@angular/core';

/**
 * Motor genérico sobre la API nativa `indexedDB` del navegador.
 *
 * Una sola base de datos ("SaurixDB") con un object store por entidad
 * (keyPath 'id', autoIncrement). Los stores se crean sobre la marcha:
 * la primera vez que se pide un store que no existe, se cierra la
 * conexión y se reabre con la versión incrementada dentro de un
 * `onupgradeneeded`, que es el único momento en que IndexedDB permite
 * crear object stores. Así no hace falta mantener a mano una lista fija
 * de entidades: cualquier `entidad` nueva que use `DataClientService`
 * simplemente provoca (una vez) esa migración automática.
 *
 * Todas las operaciones públicas se encolan (`encolar`) para que se
 * ejecuten de una en una, de principio a fin (incluida la propia
 * transacción). Sin esto, dos llamadas concurrentes que usan una entidad
 * nueva (p. ej. varias pestañas del detalle de un ticket cargando a la
 * vez) podían cerrar/reabrir la conexión al mismo tiempo; una tercera
 * llamada que ya tenía la referencia "vieja" de la conexión terminaba
 * fallando con `InvalidStateError: The database connection is closing`
 * al intentar abrir su propia transacción. Al encolar cada operación
 * completa, solo una interactúa con la conexión a la vez y esa carrera
 * ya no puede ocurrir.
 */
@Injectable({ providedIn: 'root' })
export class IndexedDbEngineService {
  private static readonly DB_NAME = 'SaurixDB';

  private db: IDBDatabase | null = null;
  private openPromise: Promise<IDBDatabase> | null = null;
  private version: number | undefined;
  private readonly storesConocidos = new Set<string>();

  /** Cola global: cada operación espera a que termine la anterior antes de empezar. */
  private cola: Promise<unknown> = Promise.resolve();

  private encolar<T>(tarea: () => Promise<T>): Promise<T> {
    const resultado = this.cola.then(tarea, tarea);
    // La cola avanza pase lo que pase (éxito o error) con la tarea anterior;
    // el resultado/error real se lo queda quien llamó a encolar().
    this.cola = resultado.then(
      () => undefined,
      () => undefined,
    );
    return resultado;
  }

  private abrir(): Promise<IDBDatabase> {
    if (this.db) return Promise.resolve(this.db);
    if (this.openPromise) return this.openPromise;

    this.openPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.version
        ? indexedDB.open(IndexedDbEngineService.DB_NAME, this.version)
        : indexedDB.open(IndexedDbEngineService.DB_NAME);

      // Si el bloqueo no se libera solo (otra pestaña vieja, de antes de
      // este arreglo, que todavía no cierra su conexión sola — ver
      // onversionchange más abajo — o de verdad congelada), se informa con
      // un error claro en vez de dejar la operación colgada para siempre.
      let bloqueoTimeout: ReturnType<typeof setTimeout> | undefined;

      request.onupgradeneeded = () => {
        const db = request.result;
        for (const store of this.storesConocidos) {
          if (!db.objectStoreNames.contains(store)) {
            db.createObjectStore(store, { keyPath: 'id', autoIncrement: true });
          }
        }
      };
      request.onsuccess = () => {
        if (bloqueoTimeout) clearTimeout(bloqueoTimeout);
        this.db = request.result;
        this.version = request.result.version;
        this.db.onclose = () => {
          this.db = null;
        };
        // Si OTRA pestaña necesita subir de versión (p. ej. creó una
        // entidad nueva primero), esta conexión se cierra sola para no
        // bloquearla — sin esto, dos pestañas de Saurix abiertas a la vez
        // podían quedarse bloqueando indefinidamente la migración una a la
        // otra (ver onblocked, abajo).
        this.db.onversionchange = () => {
          this.db?.close();
          this.db = null;
        };
        resolve(request.result);
      };
      request.onerror = () => {
        if (bloqueoTimeout) clearTimeout(bloqueoTimeout);
        reject(request.error);
      };
      request.onblocked = () => {
        // No es un fallo definitivo: en cuanto la otra pestaña cierre su
        // conexión (lo hace sola gracias a onversionchange, arriba), este
        // mismo request sigue su curso y dispara onupgradeneeded/onsuccess
        // con normalidad. Solo se rechaza si el bloqueo persiste pasado un
        // rato (p. ej. una pestaña vieja que todavía no tiene ese arreglo).
        console.warn('IndexedDB: esperando a que se cierren otras pestañas de Saurix para actualizar la base de datos…');
        bloqueoTimeout = setTimeout(() => {
          reject(
            new Error(
              'No se pudo actualizar la base de datos: hay otra pestaña de Saurix abierta bloqueando la operación. Cierra las demás pestañas de Saurix y recarga esta página.',
            ),
          );
        }, 4000);
      };
    }).finally(() => {
      this.openPromise = null;
    });

    return this.openPromise;
  }

  /** Garantiza que el store de `entidad` existe, migrando la base si hace falta.
   *  Debe llamarse siempre desde dentro de una tarea encolada (ver `encolar`). */
  private async asegurarStore(entidad: string): Promise<IDBDatabase> {
    this.storesConocidos.add(entidad);
    let db = await this.abrir();
    if (db.objectStoreNames.contains(entidad)) return db;

    db.close();
    this.db = null;
    this.version = (this.version ?? db.version) + 1;
    db = await this.abrir();
    return db;
  }

  async getAll<T>(entidad: string): Promise<T[]> {
    return this.encolar(async () => {
      const db = await this.asegurarStore(entidad);
      return new Promise<T[]>((resolve, reject) => {
        const tx = db.transaction(entidad, 'readonly');
        const request = tx.objectStore(entidad).getAll();
        request.onsuccess = () => resolve(request.result as T[]);
        request.onerror = () => reject(request.error);
      });
    });
  }

  async getById<T>(entidad: string, id: number): Promise<T | undefined> {
    return this.encolar(async () => {
      const db = await this.asegurarStore(entidad);
      return new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(entidad, 'readonly');
        const request = tx.objectStore(entidad).get(id);
        request.onsuccess = () => resolve(request.result as T | undefined);
        request.onerror = () => reject(request.error);
      });
    });
  }

  /** Inserta un registro nuevo; si no trae `id`, el store genera uno (autoIncrement). */
  async add<T extends Record<string, unknown>>(entidad: string, valor: T): Promise<T> {
    return this.encolar(async () => {
      const db = await this.asegurarStore(entidad);
      return new Promise<T>((resolve, reject) => {
        const tx = db.transaction(entidad, 'readwrite');
        const request = tx.objectStore(entidad).add(valor);
        request.onsuccess = () => resolve({ ...valor, id: request.result as number });
        request.onerror = () => reject(request.error);
      });
    });
  }

  /** Reemplaza (o crea) un registro por su `id`. */
  async put<T extends Record<string, unknown>>(entidad: string, valor: T): Promise<T> {
    return this.encolar(async () => {
      const db = await this.asegurarStore(entidad);
      return new Promise<T>((resolve, reject) => {
        const tx = db.transaction(entidad, 'readwrite');
        const request = tx.objectStore(entidad).put(valor);
        request.onsuccess = () => resolve({ ...valor, id: request.result as number });
        request.onerror = () => reject(request.error);
      });
    });
  }

  async remove(entidad: string, id: number): Promise<void> {
    return this.encolar(async () => {
      const db = await this.asegurarStore(entidad);
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(entidad, 'readwrite');
        const request = tx.objectStore(entidad).delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    });
  }

  /**
   * Respaldo completo: TODOS los stores que existen hoy en la base, con
   * todos sus registros tal cual (incluye el `id`, indispensable para que
   * al restaurar las relaciones entre entidades — usuarioId, proyectoId,
   * etc. — sigan apuntando a lo correcto). Pensado para "Panel de Control →
   * Respaldo y restauración": exportar aquí y restaurar en otro dispositivo,
   * mientras no exista un backend real que sincronice esto solo.
   */
  async exportarTodo(): Promise<Record<string, unknown[]>> {
    return this.encolar(async () => {
      const db = await this.abrir();
      const resultado: Record<string, unknown[]> = {};
      for (const nombre of Array.from(db.objectStoreNames)) {
        resultado[nombre] = await new Promise<unknown[]>((resolve, reject) => {
          const tx = db.transaction(nombre, 'readonly');
          const request = tx.objectStore(nombre).getAll();
          request.onsuccess = () => resolve(request.result as unknown[]);
          request.onerror = () => reject(request.error);
        });
      }
      return resultado;
    });
  }

  /**
   * Restaura un respaldo de exportarTodo(): por cada store del respaldo,
   * BORRA lo que haya en este dispositivo y pone en su lugar los registros
   * del respaldo (con put, no add, para conservar los mismos id — si se
   * regeneraran, todas las relaciones entre entidades quedarían rotas).
   * Un store que el respaldo trae pero este dispositivo todavía no conoce
   * se crea sobre la marcha, igual que asegurarStore(); un store que este
   * dispositivo ya tiene pero el respaldo no incluye se deja intacto (no se
   * borra "lo que no venía en el respaldo").
   */
  async restaurarTodo(datosPorEntidad: Record<string, unknown[]>): Promise<void> {
    return this.encolar(async () => {
      let db: IDBDatabase | null = null;
      for (const entidad of Object.keys(datosPorEntidad)) {
        db = await this.asegurarStore(entidad);
      }
      db ??= await this.abrir();

      for (const [entidad, filas] of Object.entries(datosPorEntidad)) {
        await new Promise<void>((resolve, reject) => {
          const tx = db!.transaction(entidad, 'readwrite');
          const store = tx.objectStore(entidad);
          store.clear();
          for (const fila of filas) store.put(fila as Record<string, unknown>);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      }
    });
  }

  /** Inserta datos de ejemplo solo si el store todavía está vacío (útil para "sembrar" catálogos base). */
  async seedSiVacio<T extends Record<string, unknown>>(entidad: string, filas: T[]): Promise<void> {
    return this.encolar(async () => {
      const db = await this.asegurarStore(entidad);
      const existentes = await new Promise<T[]>((resolve, reject) => {
        const tx = db.transaction(entidad, 'readonly');
        const request = tx.objectStore(entidad).getAll();
        request.onsuccess = () => resolve(request.result as T[]);
        request.onerror = () => reject(request.error);
      });
      if (existentes.length > 0) return;

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(entidad, 'readwrite');
        const store = tx.objectStore(entidad);
        for (const fila of filas) store.add(fila);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    });
  }
}

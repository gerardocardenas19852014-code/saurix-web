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

      request.onupgradeneeded = () => {
        const db = request.result;
        for (const store of this.storesConocidos) {
          if (!db.objectStoreNames.contains(store)) {
            db.createObjectStore(store, { keyPath: 'id', autoIncrement: true });
          }
        }
      };
      request.onsuccess = () => {
        this.db = request.result;
        this.version = request.result.version;
        this.db.onclose = () => {
          this.db = null;
        };
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('IndexedDB: la actualización de la base de datos está bloqueada por otra pestaña abierta.'));
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

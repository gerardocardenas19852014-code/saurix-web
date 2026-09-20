import { Injectable, inject } from '@angular/core';
import { Observable, from } from 'rxjs';
import { DataClientService } from './data-client.service';
import { IndexedDbEngineService } from './indexeddb-engine.service';

/** Coincidencia de filtro: substring (sin mayúsculas/minúsculas) en texto, igualdad exacta en el resto. */
function coincideFiltro(fila: Record<string, unknown>, filtro: Record<string, unknown>): boolean {
  for (const [clave, valor] of Object.entries(filtro)) {
    if (valor === null || valor === undefined || valor === '') continue;
    const valorFila = fila[clave];
    if (typeof valor === 'string' && typeof valorFila === 'string') {
      if (!valorFila.toLowerCase().includes(valor.toLowerCase())) return false;
    } else if (valorFila !== valor) {
      return false;
    }
  }
  return true;
}

/**
 * Implementación activa por ahora: persiste todo en IndexedDB, en el
 * propio navegador. No requiere conexión ni backend .NET.
 */
@Injectable({ providedIn: 'root' })
export class IndexedDbDataClientService extends DataClientService {
  private readonly engine = inject(IndexedDbEngineService);

  override list<T>(entidad: string, filtro?: Record<string, unknown>): Observable<T[]> {
    return from(
      this.engine.getAll<T & Record<string, unknown>>(entidad).then((filas) =>
        filtro ? filas.filter((fila) => coincideFiltro(fila, filtro)) : filas,
      ),
    ) as Observable<T[]>;
  }

  override getById<T>(entidad: string, id: number): Observable<T> {
    return from(
      this.engine.getById<T>(entidad, id).then((fila) => {
        if (!fila) throw new Error(`No se encontró el registro ${id} en ${entidad}.`);
        return fila;
      }),
    );
  }

  override alta<T>(entidad: string, dto: Partial<T>): Observable<T> {
    // Los stores usan keyPath 'id' con autoIncrement, pero IndexedDB solo
    // autogenera la clave cuando la propiedad 'id' está AUSENTE del objeto.
    // Los formularios reactivos de la app inicializan sus records nuevos con
    // `id: 0` (para poder reusar el mismo FormGroup en alta y edición), y si
    // ese 0 llega hasta aquí, IndexedDB lo toma como clave explícita: el
    // primer alta cae en id=0 y CUALQUIER alta siguiente choca con
    // "ConstraintError: Key already exists". Se quita 'id' del dto antes de
    // insertar para que autoIncrement siempre genere la clave en un alta.
    const { id: _id, ...sinId } = dto as Record<string, unknown> & { id?: unknown };
    const conFechas = { ...sinId, fechaCreacion: new Date().toISOString() };
    return from(this.engine.add<Record<string, unknown>>(entidad, conFechas)) as Observable<T>;
  }

  override modificacion<T>(entidad: string, dto: Partial<T> & { id: number }): Observable<T> {
    const conFechas = { ...dto, fechaModificacion: new Date().toISOString() } as Record<string, unknown>;
    return from(this.engine.put<Record<string, unknown>>(entidad, conFechas)) as Observable<T>;
  }

  override baja(entidad: string, id: number): Observable<void> {
    return from(this.engine.remove(entidad, id));
  }
}

import { Injectable, inject } from '@angular/core';
import { Observable, from } from 'rxjs';
import { DataClientService, FiltroNulo, FiltroRango, ResultadoPagina, OrdenPagina } from './data-client.service';

function esFiltroRango(valor: unknown): valor is FiltroRango {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor) && ('gte' in valor || 'lte' in valor);
}

function esFiltroNulo(valor: unknown): valor is FiltroNulo {
  return typeof valor === 'object' && valor !== null && (valor as FiltroNulo).esNulo === true;
}
import { IndexedDbEngineService } from './indexeddb-engine.service';

/** Coincidencia de filtro: substring (sin mayúsculas/minúsculas) en texto, igualdad exacta en el resto. */
function coincideFiltro(fila: Record<string, unknown>, filtro: Record<string, unknown>): boolean {
  for (const [clave, valor] of Object.entries(filtro)) {
    if (valor === null || valor === undefined || valor === '') continue;
    const valorFila = fila[clave];
    // Un arreglo = "está en esta lista" — mismo significado que el .in()
    // del lado Supabase (ver supabase-data-client.service.ts: listar()).
    if (Array.isArray(valor)) {
      if (!valor.includes(valorFila)) return false;
      continue;
    }
    // {gte, lte} = acotar a un rango (ver supabase-data-client.service.ts).
    if (esFiltroRango(valor)) {
      const comparable = valorFila as string | number;
      if (valor.gte !== undefined && comparable < valor.gte) return false;
      if (valor.lte !== undefined && comparable > valor.lte) return false;
      continue;
    }
    // {esNulo: true} = "columna IS NULL" (ver supabase-data-client.service.ts).
    if (esFiltroNulo(valor)) {
      if (valorFila !== null && valorFila !== undefined) return false;
      continue;
    }
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

  override listarPagina<T>(
    entidad: string,
    filtro: Record<string, unknown> | undefined,
    desde: number,
    cantidad: number,
    orden?: OrdenPagina,
  ): Observable<ResultadoPagina<T>> {
    return from(
      this.engine.getAll<T & Record<string, unknown>>(entidad).then((filas) => {
        const filtradas = filtro ? filas.filter((fila) => coincideFiltro(fila, filtro)) : filas;
        const ordenadas = orden ? ordenarFilas(filtradas, orden) : filtradas;
        return { filas: ordenadas.slice(desde, desde + cantidad), total: ordenadas.length } as ResultadoPagina<T>;
      }),
    );
  }
}

/** Mismo criterio de comparación que DataTableComponent.compararValores()
 *  (números/booleanos por valor, resto por texto con numeric:true), con
 *  `id` como desempate para un orden estable — igual que listarUnaPagina()
 *  en el modo Supabase. */
function ordenarFilas<T extends Record<string, unknown>>(filas: T[], orden: OrdenPagina): T[] {
  const direccion = orden.direccion === 'desc' ? -1 : 1;
  return [...filas].sort((a, b) => {
    const resultado = compararValoresOrden(a[orden.columna], b[orden.columna]) * direccion;
    if (resultado !== 0) return resultado;
    return Number((a as { id?: number }).id ?? 0) - Number((b as { id?: number }).id ?? 0);
  });
}

function compararValoresOrden(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined || a === '') return -1;
  if (b === null || b === undefined || b === '') return 1;
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : 1;
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === false ? -1 : 1;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

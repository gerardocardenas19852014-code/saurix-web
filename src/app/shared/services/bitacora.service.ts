import { Injectable, inject } from '@angular/core';
import { EMPTY, Observable, catchError } from 'rxjs';
import { DataClientService } from '../../core/services/data-client.service';

export interface BitacoraCambio {
  campo: string;
  anterior: unknown;
  actual: unknown;
}

export interface BitacoraRegistro {
  id: number;
  modulo: string;
  entidad: string;
  accion: string;
  registroId?: number;
  usuario: string;
  fecha: string;
  cambios: BitacoraCambio[];
}

export interface BitacoraEntrada {
  modulo: string;
  entidad: string;
  accion: string;
  /** Quién hizo la acción. Lo da el llamador (no se infiere aquí) para no
   *  depender de AuthService: AuthService también necesita registrar eventos
   *  en la Bitácora (inicio de sesión), y si BitacoraService dependiera de
   *  AuthService se formaría una dependencia circular en el DI de Angular. */
  usuario: string;
  registroId?: number;
  anterior?: Record<string, unknown> | null;
  actual?: Record<string, unknown> | null;
}

const CAMPOS_SENSIBLES = new Set(['password', 'confirmacionPassword']);

@Injectable({ providedIn: 'root' })
export class BitacoraService {
  private readonly data = inject(DataClientService);

  listar(modulo: string): Observable<BitacoraRegistro[]> {
    return new Observable<BitacoraRegistro[]>((suscriptor) => {
      this.data.list<BitacoraRegistro>('Bitacora', { modulo }).subscribe({
        next: (registros) => {
          suscriptor.next(registros.sort((a, b) => b.fecha.localeCompare(a.fecha)));
          suscriptor.complete();
        },
        error: (error) => suscriptor.error(error),
      });
    });
  }

  registrar(entrada: BitacoraEntrada): Observable<BitacoraRegistro> {
    const anterior = this.sanitizar(entrada.anterior);
    const actual = this.sanitizar(entrada.actual);
    const cambios = this.comparar(anterior, actual);
    const registro: Partial<BitacoraRegistro> = {
      modulo: entrada.modulo,
      entidad: entrada.entidad,
      accion: entrada.accion,
      registroId: entrada.registroId,
      usuario: entrada.usuario || 'Sistema',
      fecha: new Date().toISOString(),
      cambios,
    };

    // catchError centralizado: así CUALQUIER llamador que haga
    // `bitacora.registrar(...).subscribe()` sin manejar error (patrón repetido
    // en ~20+ archivos) queda protegido en un solo lugar contra un "Uncaught
    // (in promise)" en consola si falla el guardado de bitácora.
    return this.data.alta<BitacoraRegistro>('Bitacora', registro).pipe(
      catchError((error) => {
        console.warn('No se pudo registrar en la bitácora:', error);
        return EMPTY;
      }),
    );
  }

  registrarConsulta(modulo: string, entidad: string, usuario: string, registroId?: number): Observable<BitacoraRegistro> {
    return this.registrar({ modulo, entidad, accion: 'Consulta de detalle', usuario, registroId });
  }

  private sanitizar(valor: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
    if (!valor) return null;
    return Object.fromEntries(Object.entries(valor).filter(([campo]) => !CAMPOS_SENSIBLES.has(campo)));
  }

  private comparar(
    anterior: Record<string, unknown> | null,
    actual: Record<string, unknown> | null,
  ): BitacoraCambio[] {
    const campos = new Set([...Object.keys(anterior ?? {}), ...Object.keys(actual ?? {})]);
    return [...campos]
      .filter((campo) => !this.iguales(anterior?.[campo], actual?.[campo]))
      .map((campo) => ({ campo, anterior: anterior?.[campo] ?? null, actual: actual?.[campo] ?? null }));
  }

  private iguales(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }
}

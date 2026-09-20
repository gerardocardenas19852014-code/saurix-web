import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DataClientService } from './data-client.service';

/**
 * Implementación FUTURA: llama a los endpoints reales de PlataformaSaurix
 * (.NET), con la convención /api/{Entidad}/{Accion}. Hoy no está activa
 * (ver `app.config.ts`) — cuando el backend esté listo, basta con cambiar
 * el `provide` de `DataClientService` para que apunte a esta clase en vez
 * de `IndexedDbDataClientService`. Ningún componente cambia.
 */
@Injectable({ providedIn: 'root' })
export class HttpDataClientService extends DataClientService {
  private readonly http = inject(HttpClient);

  private url(entidad: string): string {
    return `${environment.apiUrl}/api/${entidad}`;
  }

  override list<T>(entidad: string, filtro?: Record<string, unknown>): Observable<T[]> {
    let params = new HttpParams();
    if (filtro) {
      for (const [clave, valor] of Object.entries(filtro)) {
        if (valor !== null && valor !== undefined && valor !== '') {
          params = params.set(clave, String(valor));
        }
      }
    }
    return this.http.get<T[]>(`${this.url(entidad)}/GetList`, { params });
  }

  override getById<T>(entidad: string, id: number): Observable<T> {
    return this.http.get<T>(`${this.url(entidad)}/GetById`, { params: { id } });
  }

  override alta<T>(entidad: string, dto: Partial<T>): Observable<T> {
    return this.http.post<T>(`${this.url(entidad)}/Alta`, dto);
  }

  override modificacion<T>(entidad: string, dto: Partial<T> & { id: number }): Observable<T> {
    return this.http.put<T>(`${this.url(entidad)}/Modificacion`, dto);
  }

  override baja(entidad: string, id: number): Observable<void> {
    return this.http.delete<void>(`${this.url(entidad)}/Baja`, { params: { id } });
  }
}

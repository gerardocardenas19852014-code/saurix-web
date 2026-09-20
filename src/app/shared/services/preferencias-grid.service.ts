import { Injectable, signal } from '@angular/core';

const CLAVE_TAMANO_PAGINA = 'saurix.tamanoPaginaGrid';

/**
 * Preferencia de "Registros por página" configurada en Panel de Control →
 * Apariencia → Tablas y listados. Se guarda en localStorage; cualquier
 * pantalla de listado inyecta este servicio y pasa
 * `[tamanoPagina]="preferenciasGrid.tamanoPagina()"` a su `<app-data-table>`
 * para que respete el tamaño de página elegido por el usuario en vez del
 * valor fijo de 10 que trae el componente por defecto.
 *
 * Usuarios (features/seguridad/usuarios) es la primera pantalla que lo usa
 * y es el modelo/estándar a copiar: el resto de los listados del sistema
 * deben ir adoptando este mismo patrón conforme se retomen.
 */
@Injectable({ providedIn: 'root' })
export class PreferenciasGridService {
  readonly tamanoPagina = signal(this.leerNumero(CLAVE_TAMANO_PAGINA, 10));

  cambiarTamanoPagina(valor: number): void {
    this.tamanoPagina.set(valor);
    try {
      localStorage.setItem(CLAVE_TAMANO_PAGINA, String(valor));
    } catch {
      /* localStorage no disponible; se ignora */
    }
  }

  private leerNumero(clave: string, porDefecto: number): number {
    try {
      const valor = localStorage.getItem(clave);
      return valor === null ? porDefecto : Number(valor);
    } catch {
      return porDefecto;
    }
  }
}

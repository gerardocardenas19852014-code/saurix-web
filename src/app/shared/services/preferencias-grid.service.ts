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

  // ── Anchos de columna personalizados por pantalla (DataTableComponent.
  // redimensionable) -- ver mandato "Ajuste de ancho y desplazamiento del
  // grid de tickets", nov-2026. A diferencia de tamanoPagina (una sola
  // preferencia global), cada pantalla que usa <app-data-table> necesita
  // su PROPIO juego de anchos -- por eso se guarda bajo una clave de
  // localStorage distinta por `idGrid` (p.ej. "tickets-lista") en vez de
  // un signal único compartido. DataTableComponent no conoce este
  // servicio en absoluto (sigue sin inyectar nada, igual que siempre) --
  // cada pantalla que quiera persistencia lee/guarda desde aquí y pasa el
  // resultado como input/escucha el output de <app-data-table>.

  private claveAnchos(idGrid: string): string {
    return `saurix.anchosGrid.${idGrid}`;
  }

  /** Anchos guardados para esta pantalla (vacío si nunca se personalizó
   *  ninguna columna, o si localStorage no está disponible). */
  leerAnchosColumnas(idGrid: string): Record<string, number> {
    try {
      const crudo = localStorage.getItem(this.claveAnchos(idGrid));
      if (!crudo) return {};
      const valor = JSON.parse(crudo);
      return valor && typeof valor === 'object' ? valor : {};
    } catch {
      return {};
    }
  }

  /** Guarda (o actualiza) el ancho de UNA columna para esta pantalla, sin
   *  tocar los anchos ya guardados de las demás columnas. */
  guardarAnchoColumna(idGrid: string, clave: string, ancho: number): void {
    try {
      const actuales = this.leerAnchosColumnas(idGrid);
      actuales[clave] = ancho;
      localStorage.setItem(this.claveAnchos(idGrid), JSON.stringify(actuales));
    } catch {
      /* localStorage no disponible; se ignora */
    }
  }
}

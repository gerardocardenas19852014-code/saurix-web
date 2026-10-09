import { environment } from '../../../environments/environment';

/**
 * De dónde lee y guarda la app:
 *  - 'supabase'  → base de datos en la nube, compartida entre dispositivos.
 *  - 'indexeddb' → solo en este navegador, sin internet (modo anterior).
 *
 * Se elige en la pantalla de login y se recuerda en este navegador. Si
 * nunca se ha elegido, se usa environment.fuenteDatos. El proveedor de
 * DataClientService se decide al arrancar la app, por eso cambiar de fuente
 * recarga la página.
 */
export type FuenteDatos = 'supabase' | 'indexeddb';

const CLAVE = 'saurix.fuenteDatos';

export function fuenteDatosActual(): FuenteDatos {
  try {
    const guardada = localStorage.getItem(CLAVE);
    if (guardada === 'supabase' || guardada === 'indexeddb') return guardada;
  } catch {
    /* localStorage no disponible; se usa el valor por defecto */
  }
  return environment.fuenteDatos;
}

export function guardarFuenteDatos(fuente: FuenteDatos): void {
  try {
    localStorage.setItem(CLAVE, fuente);
  } catch {
    /* localStorage no disponible; se ignora */
  }
}

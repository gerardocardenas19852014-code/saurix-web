import { Injectable, signal } from '@angular/core';

/**
 * "Año de trabajo" — una sola selección COMPARTIDA entre Movimientos, Fijos
 * y Proyección y Proyección, en vez de que cada pantalla tuviera su propio
 * filtro de Año (que se "olvidaba" al cambiar de pantalla). Elegir un año
 * en cualquiera de las 3 se refleja de inmediato en las otras dos, porque
 * las 3 leen y escriben esta MISMA señal (providedIn: 'root' = una sola
 * instancia para toda la app).
 *
 * 'todos' = sin filtrar — el comportamiento de siempre, nadie está
 * obligado a elegir un año. Cuando se elige uno:
 *  - Movimientos y Proyección filtran su vista por default a ese año (el
 *    usuario puede volver a "Todos" cuando quiera — sigue siendo un
 *    filtro, no un bloqueo).
 *  - Fijos y Proyección usa ese año como punto de partida por defecto del
 *    campo "Desde" al generar futuros (ver resetearDesdeGenerar() en
 *    recurrentes.component.ts).
 *  - Nuevo movimiento arranca su fecha en ese año en vez del año calendario
 *    actual (ver fechaPorDefecto() en movimientos.component.ts).
 *
 * Este servicio SOLO guarda cuál año está elegido — cada pantalla sigue
 * siendo dueña de calcular cuáles años son válidos como opción, a partir
 * de su propio catálogo "Presupuesto por año" (Catálogos), igual que ya
 * hacían antes de este servicio existir.
 */
@Injectable({ providedIn: 'root' })
export class AnioTrabajoService {
  readonly seleccionado = signal<number | 'todos'>('todos');

  /** Ya no hay opción "Todos" en los selectores de Año (Movimientos y
   *  Proyección) — el selector siempre debe mostrar un año real. Cada
   *  pantalla llama esto con SUS años registrados (Catálogos →
   *  Presupuesto por año) apenas los conoce; si todavía no hay ninguno
   *  elegido, propone uno (el año actual si ya está registrado, si no el
   *  más próximo) para que el selector nunca se quede sin nada que
   *  mostrar. Si el usuario ya eligió un año a mano, no se toca. */
  asegurarSeleccion(anios: number[]): void {
    if (this.seleccionado() !== 'todos' || anios.length === 0) return;
    const hoy = new Date().getFullYear();
    const elegido = anios.includes(hoy) ? hoy : (anios.find((a) => a >= hoy) ?? anios[anios.length - 1]);
    this.seleccionado.set(elegido);
  }
}

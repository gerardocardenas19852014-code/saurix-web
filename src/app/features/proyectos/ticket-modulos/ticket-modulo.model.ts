/**
 * Catálogo del módulo/área del sistema al que pertenece un ticket (p.ej.
 * Frontend, Backend, Base de datos, Infraestructura) — mismo patrón que
 * TicketTipo (ver ticket-tipo.model.ts), pero independiente del "Tipo de
 * ticket": un ticket puede ser un Bug (Tipo) del módulo Backend (Módulo).
 * Se llama "TicketModulo" (no solo "Modulo") para no confundirse con el
 * selector de módulos del sistema (WikiDocs/Seguridad/Presupuesto/etc.) que
 * se ve al iniciar sesión — en la UI siempre se muestra simplemente como
 * "Módulo".
 */
export interface TicketModulo {
  id: number;
  nombre: string;
  clave: string;
  icono: string | null;
  activo: boolean;
}

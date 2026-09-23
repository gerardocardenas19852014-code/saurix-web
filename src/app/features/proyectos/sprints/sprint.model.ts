export type EstadoSprint = 'planeado' | 'activo' | 'cerrado';

/**
 * Un Sprint agrupa tickets de un proyecto en una iteración con fechas —
 * patrón Scrum de Jira (Backlog + Sprints). Ticket.sprintId apunta aquí;
 * null significa "está en el Backlog", sin sprint asignado.
 *
 * Solo puede haber un sprint 'activo' por proyecto a la vez (ver
 * iniciarSprint en backlog.component.ts, misma regla que Jira/Scrum real).
 * 'cerrado' es el equivalente de "completado". Al completar un sprint, los
 * tickets que no se resolvieron regresan solos al Backlog (sprintId = null);
 * los resueltos se quedan con el sprint como registro histórico de qué se
 * cerró en esa iteración. Un sprint cerrado por error se puede reabrir (ver
 * reabrirSprint en backlog.component.ts, vuelve a 'activo') — los tickets
 * liberados al cerrarlo no vuelven solos. También se puede eliminar un
 * sprint en cualquier estado (ver eliminarSprint/confirmarEliminarSprint):
 * sus tickets siempre regresan primero al Backlog.
 */
export interface Sprint {
  id: number;
  proyectoId: number;
  nombre: string;
  objetivo: string | null;
  fechaInicio: string | null;
  fechaFin: string | null;
  estado: EstadoSprint;
  /** Orden manual elegido por el usuario (ver moverSprint en backlog.component.ts) —
   *  null en sprints creados antes de este campo, que se siguen ordenando por
   *  fechaInicio hasta que alguien los reordene por primera vez. */
  orden?: number | null;
}

/** Versión corta del nombre de un sprint, para columnas angostas de grid (Kanban/Lista,
 *  Mi Dashboard) donde el nombre completo hace que el renglón se estire de más — el
 *  Backlog (donde sí hay espacio) sigue mostrando sprint.nombre tal cual. La mayoría de
 *  los sprints terminan en un número de versión (p.ej. "...Obligaciones 10.74.0"), que en
 *  la práctica es la parte que distingue un sprint de otro con el mismo "Paquete de
 *  Liberación de..."; si se encuentra ese patrón se usa solo eso, si no se recorta el
 *  nombre tal cual (p.ej. "RQS SEFIN", que ya es corto de por sí). */
export function nombreSprintCorto(nombre: string): string {
  const version = nombre.match(/\d+(?:\.\d+)+\s*$/);
  if (version) return version[0].trim();
  return nombre.length > 22 ? `${nombre.slice(0, 21)}…` : nombre;
}

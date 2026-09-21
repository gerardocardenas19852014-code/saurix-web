export type EstadoSprint = 'planeado' | 'activo' | 'cerrado';

/**
 * Un Sprint agrupa tickets de un proyecto en una iteración con fechas —
 * patrón Scrum de Jira (Backlog + Sprints). Ticket.sprintId apunta aquí;
 * null significa "está en el Backlog", sin sprint asignado.
 *
 * Solo puede haber un sprint 'activo' por proyecto a la vez (ver
 * iniciarSprint en backlog.component.ts, misma regla que Jira/Scrum real).
 * 'cerrado' es el equivalente de "completado": no se reabre. Al completar
 * un sprint, los tickets que no se resolvieron regresan solos al Backlog
 * (sprintId = null); los resueltos se quedan con el sprint como registro
 * histórico de qué se cerró en esa iteración.
 */
export interface Sprint {
  id: number;
  proyectoId: number;
  nombre: string;
  objetivo: string | null;
  fechaInicio: string | null;
  fechaFin: string | null;
  estado: EstadoSprint;
}

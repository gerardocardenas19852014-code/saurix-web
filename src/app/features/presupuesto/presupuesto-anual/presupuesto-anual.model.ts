/** Estatus viene del catálogo "Listas de valores" (Catálogos → Estatus de
 *  presupuesto anual), grupo PresupuestoAnualEstatus — por defecto Creación,
 *  Proyección, Autorizado y Ejecutado, pero se puede ampliar desde ahí.
 *  'Autorizado' y 'Ejecutado' están protegidas (ver
 *  PresupuestoAnualEstatusComponent) porque la Proyección las compara tal
 *  cual para decidir si un año ya se bloqueó para edición manual. */
export type EstatusPresupuestoAnual = string;

/**
 * Catálogo compartido (Presupuesto Personal): "Presupuesto por Año" — lleva
 * el control de en qué etapa está el presupuesto de cada año (Creación →
 * Proyección → Autorizado → Ejecutado). Cuando el estatus es Autorizado o
 * Ejecutado, la pantalla de Proyección deja de permitir editar a mano las
 * celdas de ese año (ya se revisó/aprobó, no debería seguir moviéndose).
 *
 * `fechaAlta` es un campo capturable (cuándo se dio de alta este año en el
 * control), distinto de `fechaCreacion` (auditoría automática del sistema).
 */
export interface PresupuestoAnual {
  id: number;
  anio: number;
  fechaAlta: string;
  descripcion: string;
  estatusClave: EstatusPresupuestoAnual;
  /** Igual que en otros catálogos: permite archivar/ocultar un año viejo de
   *  la lista por default sin borrarlo (independiente de estatusClave, que
   *  es la etapa del flujo Creación→Proyección→Autorizado→Ejecutado).
   *  undefined en filas viejas se trata como activo. */
  activo?: boolean;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

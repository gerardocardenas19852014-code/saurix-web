/**
 * Catálogo genérico para los combos de tipo/estado que antes estaban fijos
 * en el código (ver auditoría 2026-09-20: tipo de cuenta, tipo de
 * movimiento, frecuencia de fijos, proveedor de conexión, y cualquier otro
 * que se agregue después). Cada fila pertenece a un "grupo" (una etiqueta
 * de texto libre, no una FK a otra tabla): los grupos se descubren solos a
 * partir de lo que ya existe aquí mismo, así que agregar un grupo nuevo es
 * tan simple como crear su primer valor — nada que preparar de antemano.
 */
export interface ValorLista {
  id: number;
  grupo: string;
  clave: string;
  etiqueta: string;
  orden: number;
  /** Opcional y solo relevante para los grupos cuya pantalla habilita
   *  `soportaInactivos` (ver ValorListaGrupoBase) — el resto de los grupos
   *  (p.ej. Proveedor de conexión) lo ignoran por completo, así que
   *  quedarse sin valor (undefined) en filas viejas se trata como activo. */
  activo?: boolean;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

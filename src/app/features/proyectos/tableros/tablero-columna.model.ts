export interface TableroColumna {
  id: number;
  proyectoId: number;
  clave: string;
  nombre: string;
  orden: number;
  permiteActividades: boolean;
  permiteAnexos: boolean;
  permiteAsociados: boolean;
  /**
   * JSON con reglas editable/obligatorio por campo del ticket ("Gestor de
   * Estados" del prototipo) — ver `ConfiguracionCamposTicket` más abajo.
   * Se edita desde Gestión de Proyectos → Gestor de Estados → "⚙ Campos".
   */
  configuracionCamposJson: string | null;
  /**
   * IDs de columnas destino a las que se puede mover un ticket DESDE esta
   * columna arrastrándolo en el Tablero — null (el valor por defecto, y lo
   * que tienen todas las columnas creadas antes de este campo) significa
   * "sin restricción configurada": se puede mover a cualquier otra columna.
   * Un array (aunque esté vacío) SÍ es una restricción real: [] significa
   * "no se puede mover a ninguna otra desde aquí". Se edita en Gestor de
   * Estados → "🔀 Flujo" — ver parsearTransicionesPermitidas/puedeMoverA.
   */
  transicionesPermitidasJson: string | null;
  /**
   * Posición (x, y en píxeles) de la caja de esta columna en el diagrama de
   * flujo visual de Gestor de Estados — null (columnas nunca movidas ahí, o
   * creadas antes de este campo) usa una posición automática en cuadrícula
   * calculada al vuelo. Se actualiza arrastrando la caja; ver PosicionDiagrama
   * / parsearPosicionDiagrama más abajo.
   */
  posicionDiagramaJson: string | null;
  activo: boolean;
}

export interface ProyectoOpcion {
  id: number;
  nombre: string;
  clave: string;
}

/** Los 13 campos del Ticket que el "Gestor de Estados" permite configurar por
 *  columna (editable/obligatorio) — mismo conjunto fijo que en el prototipo. */
export type CampoTicketConfigurable =
  | 'folioInterno'
  | 'descripcion'
  | 'ticketTipoId'
  | 'ticketPrioridadId'
  | 'ticketModuloId'
  | 'asignadoUsuarioId'
  | 'reportadoPorUsuarioId'
  | 'planeado'
  | 'tiempoEstimadoDias'
  | 'fechaFinAnalisis'
  | 'fechaFinDesarrollo'
  | 'fechaFinCliente'
  | 'solucion';

export interface ReglaCampoTicket {
  editable: boolean;
  obligatorio: boolean;
}

/** Forma real de `TableroColumna.configuracionCamposJson` una vez parseado. */
export type ConfiguracionCamposTicket = Partial<Record<CampoTicketConfigurable, ReglaCampoTicket>>;

export const TICKET_CAMPOS_CONFIGURABLES: { clave: CampoTicketConfigurable; etiqueta: string }[] = [
  { clave: 'folioInterno', etiqueta: 'Folio interno' },
  { clave: 'descripcion', etiqueta: 'Descripción' },
  { clave: 'ticketTipoId', etiqueta: 'Tipo' },
  { clave: 'ticketPrioridadId', etiqueta: 'Prioridad' },
  { clave: 'ticketModuloId', etiqueta: 'Módulo' },
  { clave: 'asignadoUsuarioId', etiqueta: 'Asignado a' },
  { clave: 'reportadoPorUsuarioId', etiqueta: 'Reportado por' },
  { clave: 'planeado', etiqueta: 'Planeado' },
  // El formulario captura/edita esto en DÍAS (ver kanban.component.ts); el campo real
  // del Ticket (tiempoEstimadoMin) sigue guardándose en minutos.
  { clave: 'tiempoEstimadoDias', etiqueta: 'Tiempo estimado (días)' },
  { clave: 'fechaFinAnalisis', etiqueta: 'Fin de análisis' },
  { clave: 'fechaFinDesarrollo', etiqueta: 'Fin de desarrollo' },
  { clave: 'fechaFinCliente', etiqueta: 'Fin cliente' },
  { clave: 'solucion', etiqueta: 'Solución' },
];

const REGLA_POR_DEFECTO: ReglaCampoTicket = { editable: true, obligatorio: false };

/** Parseo defensivo: JSON inválido o ausente (columnas creadas antes de este
 *  editor) se trata como "sin reglas propias" — todo editable, nada obligatorio. */
export function parsearConfiguracionCampos(json: string | null | undefined): ConfiguracionCamposTicket {
  if (!json) return {};
  try {
    const valor = JSON.parse(json);
    return valor && typeof valor === 'object' ? (valor as ConfiguracionCamposTicket) : {};
  } catch {
    return {};
  }
}

export function reglaCampo(config: ConfiguracionCamposTicket, campo: CampoTicketConfigurable): ReglaCampoTicket {
  return config[campo] ?? REGLA_POR_DEFECTO;
}

/** Parseo defensivo, mismo criterio que parsearConfiguracionCampos: JSON
 *  inválido o ausente (columna creada antes de este campo, o que nunca
 *  configuró su flujo) se trata como "sin restricción" (null). */
export function parsearTransicionesPermitidas(json: string | null | undefined): number[] | null {
  if (!json) return null;
  try {
    const valor = JSON.parse(json);
    return Array.isArray(valor) ? valor.map(Number) : null;
  } catch {
    return null;
  }
}

/** true si un ticket puede moverse (arrastrándolo en el Tablero) de
 *  `columnaOrigen` a la columna con id `columnaDestinoId`. Sin restricción
 *  configurada (transicionesPermitidasJson null) se puede mover a
 *  cualquier otra columna — nunca a sí misma. */
export function puedeMoverA(columnaOrigen: TableroColumna, columnaDestinoId: number): boolean {
  if (Number(columnaOrigen.id) === Number(columnaDestinoId)) return false;
  const permitidas = parsearTransicionesPermitidas(columnaOrigen.transicionesPermitidasJson);
  if (permitidas === null) return true;
  return permitidas.includes(Number(columnaDestinoId));
}

/** Posición (x, y) de una caja en el diagrama de flujo, en píxeles dentro del lienzo. */
export interface PosicionDiagrama {
  x: number;
  y: number;
}

/** Parseo defensivo: JSON inválido, ausente, o con forma inesperada se trata
 *  como "sin posición guardada" (null) — el diagrama entonces calcula una
 *  posición automática para esa columna. */
export function parsearPosicionDiagrama(json: string | null | undefined): PosicionDiagrama | null {
  if (!json) return null;
  try {
    const valor = JSON.parse(json);
    if (valor && typeof valor.x === 'number' && typeof valor.y === 'number') {
      return { x: valor.x, y: valor.y };
    }
    return null;
  } catch {
    return null;
  }
}

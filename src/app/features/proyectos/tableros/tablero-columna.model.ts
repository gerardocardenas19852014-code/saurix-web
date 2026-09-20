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
   * Se edita desde Panel de Control → Gestión de Proyectos → Gestor de Estados → "⚙ Campos".
   */
  configuracionCamposJson: string | null;
  activo: boolean;
}

export interface ProyectoOpcion {
  id: number;
  nombre: string;
  clave: string;
}

/** Los 12 campos del Ticket que el "Gestor de Estados" permite configurar por
 *  columna (editable/obligatorio) — mismo conjunto fijo que en el prototipo. */
export type CampoTicketConfigurable =
  | 'folioInterno'
  | 'descripcion'
  | 'ticketTipoId'
  | 'ticketPrioridadId'
  | 'asignadoUsuarioId'
  | 'reportadoPorUsuarioId'
  | 'planeado'
  | 'tiempoEstimadoMin'
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
  { clave: 'asignadoUsuarioId', etiqueta: 'Asignado a' },
  { clave: 'reportadoPorUsuarioId', etiqueta: 'Reportado por' },
  { clave: 'planeado', etiqueta: 'Planeado' },
  { clave: 'tiempoEstimadoMin', etiqueta: 'Tiempo estimado' },
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

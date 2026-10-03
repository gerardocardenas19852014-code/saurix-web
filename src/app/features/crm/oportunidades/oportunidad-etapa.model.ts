/**
 * Etapa configurable del pipeline de Oportunidades ("Gestor de Etapas",
 * CRM → Catálogos) — mismo patrón que `TableroColumna` en Proyectos
 * (ver tablero-columna.model.ts), adaptado a Oportunidad: no tiene un
 * "proyecto" padre (el pipeline de Oportunidades es uno solo, no uno por
 * proyecto) y, en vez de los permiteActividades/Anexos/Asociados de
 * Ticket, usa dos banderas propias (`esGanada`/`esPerdida`) para marcar
 * las etapas "terminales" que antes eran los valores fijos 'Ganada' y
 * 'Perdida' del enum OportunidadEtapa que este Gestor reemplaza.
 */
export interface OportunidadEtapaConfig {
  id: number;
  clave: string;
  nombre: string;
  orden: number;
  /** Marca esta etapa como cierre GANADO — se excluye del pipeline abierto
   *  (ver totalPipelineAbierto en oportunidades-kanban.component.ts), igual
   *  que antes hacía la etapa fija 'Ganada'. */
  esGanada: boolean;
  /** Marca esta etapa como cierre PERDIDO — se excluye del pipeline abierto
   *  y, igual que antes con la etapa fija 'Perdida', exige capturar un
   *  motivo (catálogo MotivoPerdida) antes de guardar o mover una
   *  oportunidad aquí. */
  esPerdida: boolean;
  /**
   * JSON con reglas editable/obligatorio por campo de la oportunidad —
   * mismo mecanismo que ConfiguracionCamposTicket. Se edita desde CRM →
   * Oportunidades → Gestor de Etapas → "⚙ Campos".
   */
  configuracionCamposJson: string | null;
  /**
   * IDs de etapas destino a las que se puede mover una oportunidad DESDE
   * esta etapa arrastrándola en el tablero — null (el valor por defecto)
   * significa "sin restricción configurada": se puede mover a cualquier
   * otra. Un array (aunque esté vacío) SÍ es una restricción real. Se
   * edita en Gestor de Etapas → "🔀 Flujo".
   */
  transicionesPermitidasJson: string | null;
  /**
   * Posición (x, y en píxeles) de la caja de esta etapa en el diagrama de
   * flujo visual de Gestor de Etapas — null usa una posición automática en
   * cuadrícula calculada al vuelo.
   */
  posicionDiagramaJson: string | null;
  activo: boolean;
}

/** Los 5 campos de la Oportunidad que el "Gestor de Etapas" permite
 *  configurar por etapa (editable/obligatorio). */
export type CampoOportunidadConfigurable = 'clienteId' | 'valorEstimado' | 'fechaCierreEstimada' | 'motivoPerdidaId' | 'notas';

export interface ReglaCampoOportunidad {
  editable: boolean;
  obligatorio: boolean;
}

/** Forma real de `OportunidadEtapaConfig.configuracionCamposJson` ya parseado. */
export type ConfiguracionCamposOportunidad = Partial<Record<CampoOportunidadConfigurable, ReglaCampoOportunidad>>;

export const OPORTUNIDAD_CAMPOS_CONFIGURABLES: { clave: CampoOportunidadConfigurable; etiqueta: string }[] = [
  { clave: 'clienteId', etiqueta: 'Cliente' },
  { clave: 'valorEstimado', etiqueta: 'Valor estimado' },
  { clave: 'fechaCierreEstimada', etiqueta: 'Cierre estimado' },
  // motivoPerdidaId también se exige SIEMPRE que la etapa tenga esPerdida=true
  // (ver guardar() en oportunidades-kanban.component.ts) — esta regla de
  // "editable" solo decide si el campo aparece en el formulario en otras etapas.
  { clave: 'motivoPerdidaId', etiqueta: 'Motivo de pérdida' },
  { clave: 'notas', etiqueta: 'Notas' },
];

const REGLA_POR_DEFECTO: ReglaCampoOportunidad = { editable: true, obligatorio: false };

/** Parseo defensivo: JSON inválido o ausente (etapas creadas antes de este
 *  editor) se trata como "sin reglas propias" — todo editable, nada obligatorio. */
export function parsearConfiguracionCamposOportunidad(json: string | null | undefined): ConfiguracionCamposOportunidad {
  if (!json) return {};
  try {
    const valor = JSON.parse(json);
    return valor && typeof valor === 'object' ? (valor as ConfiguracionCamposOportunidad) : {};
  } catch {
    return {};
  }
}

export function reglaCampoOportunidad(config: ConfiguracionCamposOportunidad, campo: CampoOportunidadConfigurable): ReglaCampoOportunidad {
  return config[campo] ?? REGLA_POR_DEFECTO;
}

/** Parseo defensivo, mismo criterio que parsearConfiguracionCamposOportunidad. */
export function parsearTransicionesPermitidasOportunidad(json: string | null | undefined): number[] | null {
  if (!json) return null;
  try {
    const valor = JSON.parse(json);
    return Array.isArray(valor) ? valor.map(Number) : null;
  } catch {
    return null;
  }
}

/** true si una oportunidad puede moverse (arrastrándola en el tablero) de
 *  `etapaOrigen` a la etapa con id `etapaDestinoId`. Sin restricción
 *  configurada se puede mover a cualquier otra — nunca a sí misma. */
export function puedeMoverAOportunidad(etapaOrigen: OportunidadEtapaConfig, etapaDestinoId: number): boolean {
  if (Number(etapaOrigen.id) === Number(etapaDestinoId)) return false;
  const permitidas = parsearTransicionesPermitidasOportunidad(etapaOrigen.transicionesPermitidasJson);
  if (permitidas === null) return true;
  return permitidas.includes(Number(etapaDestinoId));
}

/** Posición (x, y) de una caja en el diagrama de flujo, en píxeles dentro del lienzo. */
export interface PosicionDiagramaOportunidad {
  x: number;
  y: number;
}

/** Parseo defensivo: JSON inválido, ausente o con forma inesperada se trata
 *  como "sin posición guardada" (null) — el diagrama entonces calcula una
 *  posición automática para esa etapa. */
export function parsearPosicionDiagramaOportunidad(json: string | null | undefined): PosicionDiagramaOportunidad | null {
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

/**
 * Semilla por defecto: las 6 etapas que antes eran el enum fijo
 * OportunidadEtapa — se crean automáticamente la primera vez que se abre
 * el pipeline y el catálogo de etapas todavía está vacío (ver
 * sembrarEtapasPorDefecto() en oportunidades-kanban.component.ts), para
 * que una base ya en uso no "pierda" sus columnas de la noche a la mañana.
 */
export const OPORTUNIDAD_ETAPAS_SEED: Omit<OportunidadEtapaConfig, 'id'>[] = [
  { clave: 'prospeccion', nombre: 'Prospección', orden: 1, esGanada: false, esPerdida: false, configuracionCamposJson: null, transicionesPermitidasJson: null, posicionDiagramaJson: null, activo: true },
  { clave: 'calificacion', nombre: 'Calificación', orden: 2, esGanada: false, esPerdida: false, configuracionCamposJson: null, transicionesPermitidasJson: null, posicionDiagramaJson: null, activo: true },
  { clave: 'propuesta', nombre: 'Propuesta', orden: 3, esGanada: false, esPerdida: false, configuracionCamposJson: null, transicionesPermitidasJson: null, posicionDiagramaJson: null, activo: true },
  { clave: 'negociacion', nombre: 'Negociación', orden: 4, esGanada: false, esPerdida: false, configuracionCamposJson: null, transicionesPermitidasJson: null, posicionDiagramaJson: null, activo: true },
  { clave: 'ganada', nombre: 'Ganada', orden: 5, esGanada: true, esPerdida: false, configuracionCamposJson: null, transicionesPermitidasJson: null, posicionDiagramaJson: null, activo: true },
  { clave: 'perdida', nombre: 'Perdida', orden: 6, esGanada: false, esPerdida: true, configuracionCamposJson: null, transicionesPermitidasJson: null, posicionDiagramaJson: null, activo: true },
];

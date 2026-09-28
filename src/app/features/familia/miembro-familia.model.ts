/**
 * Miembro de familia — ficha con sus datos básicos, información médica de
 * emergencia y RFC/CURP (autogenerados con la misma calculadora de Panel de
 * Control → Generación de RFC y CURP, ver rfc-curp.util.ts, pero editables
 * a mano por si el cálculo no coincide con el documento oficial).
 *
 * No lleva creadoPorUsuarioId: a diferencia de Presupuesto Personal (datos
 * privados por usuario), este es un directorio compartido de la familia —
 * cualquier usuario que entre a Saurix ve el mismo registro.
 */
export interface MiembroFamilia {
  id: number;
  nombre: string;
  apellidoPaterno: string;
  /** Opcional: quien no tiene apellido materno registrado deja esto vacío. */
  apellidoMaterno: string;
  /** Clave de ValorLista grupo 'FamiliaParentesco' (ver parentesco.component.ts). */
  parentescoClave: string;
  /** Formato 'YYYY-MM-DD'. */
  fechaNacimiento: string;
  /** 'H'/'M' — mismo catálogo que usa el cálculo de RFC/CURP (ver OPCIONES_SEXO en rfc-curp.util.ts). */
  sexo: string;
  /** Código de 2 letras de la entidad de nacimiento (ver OPCIONES_ENTIDAD) o 'NE' si nació en el extranjero — se necesita para calcular RFC/CURP. */
  entidadNacimiento: string;
  /** Uno de TIPOS_SANGRE, o '' si no se ha capturado. */
  tipoSangre: string;
  telefono: string;
  /** RFC con homoclave (13 caracteres) — autogenerado, editable. */
  rfc: string;
  /** CURP (18 caracteres) — autogenerado, editable. */
  curp: string;
  /** Alergias conocidas, en texto libre (p.ej. "Penicilina, mariscos"). */
  alergias: string;
  /** Condiciones crónicas relevantes en una emergencia (p.ej. "Asma, diabetes tipo 1"). */
  condicionesCronicas: string;
  /** Medicamentos que toma de forma regular. */
  medicamentos: string;
  contactoEmergenciaNombre: string;
  contactoEmergenciaTelefono: string;
  aseguradora: string;
  numeroPoliza: string;
  /** Alta lógica, mismo patrón que otros catálogos con "Mostrar inactivos". */
  activo: boolean;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

/** Catálogo fijo (no ValorLista): los 8 tipos de sangre humanos no cambian
 *  ni se personalizan por familia, así que va como un arreglo simple, igual
 *  que OPCIONES_SEXO/OPCIONES_ENTIDAD en rfc-curp.util.ts. */
export const TIPOS_SANGRE: string[] = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'];

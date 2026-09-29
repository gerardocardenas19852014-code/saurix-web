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
  /** Clave de ValorLista grupo GRUPO_SEXO (ver sexo.component.ts) — mismas claves que exige la librería "curp" para calcularRfcYCurp(). */
  sexo: string;
  /** Clave de ValorLista grupo GRUPO_ENTIDAD_NACIMIENTO (ver entidad-nacimiento.component.ts), o 'NE' si nació en el extranjero — se necesita para calcular RFC/CURP. */
  entidadNacimiento: string;
  /** Clave de ValorLista grupo GRUPO_TIPO_SANGRE (ver tipo-sangre.component.ts), o '' si no se ha capturado. */
  tipoSangre: string;
  telefono: string;
  /** Foto de la persona en base64 (data URL), ya redimensionada/comprimida en el navegador antes de guardarse. Opcional: sin foto se muestra un avatar con iniciales. */
  foto?: string;
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
  /** Número de Seguro Social (IMSS/ISSSTE u otra institución) — útil para
   *  que el personal médico ubique el expediente en una emergencia. Texto
   *  libre (no se valida formato), igual que RFC/CURP. */
  numeroSeguroSocial: string;
  contactoEmergenciaNombre: string;
  contactoEmergenciaTelefono: string;
  aseguradora: string;
  numeroPoliza: string;
  /** Alta lógica, mismo patrón que otros catálogos con "Mostrar inactivos". */
  activo: boolean;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

// ── Sexo, Entidad de nacimiento y Tipo de sangre ahora son catálogos
// ValorLista propios (pantallas dedicadas bajo Familia → Catálogos), no
// arreglos fijos en código — a pedido explícito, para que se vean/editen
// igual que Parentesco y Tipo de documento. Sexo y Entidad de nacimiento
// SÍ necesitan sembrarse con datos de fábrica desde el primer uso (ver
// obtenerOSembrarValorLista en familia.util.ts) porque sus claves las exige
// la librería "curp" para calcularRfcYCurp(): por eso cada pantalla marca
// esas claves como clavesProtegidas (no se pueden borrar ni renombrar, solo
// cambiar su Etiqueta). Tipo de sangre no tiene esa dependencia, así que
// su catálogo es 100% libre.

export const GRUPO_SEXO = 'FamiliaSexo';
export const GRUPO_ENTIDAD_NACIMIENTO = 'FamiliaEntidadNacimiento';
export const GRUPO_TIPO_SANGRE = 'FamiliaTipoSangre';

/** Semilla de fábrica para GRUPO_TIPO_SANGRE — sin claves protegidas, el usuario puede agregar/quitar/renombrar libremente. */
export const SEMILLA_TIPO_SANGRE: { clave: string; etiqueta: string }[] = [
  'O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-',
].map((t) => ({ clave: t, etiqueta: t }));

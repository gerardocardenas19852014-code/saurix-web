import RfcFacil from 'rfc-facil';
import * as curp from 'curp';

/**
 * Datos capturados en el formulario para calcular RFC y CURP. Se usan los
 * mismos datos para ambos cálculos (el RFC no necesita sexo/entidad, pero
 * pedirlos una sola vez evita capturar todo dos veces).
 */
export interface DatosPersonaRfcCurp {
  nombre: string;
  apellidoPaterno: string;
  /** Opcional: quien no tiene apellido materno registrado deja esto vacío. */
  apellidoMaterno: string;
  /** Formato 'YYYY-MM-DD', tal como lo entrega un <input type="date">. */
  fechaNacimiento: string;
  sexo: string;
  /** Código de 2 letras (ver OPCIONES_ENTIDAD) o 'NE' si nació en el extranjero. */
  entidadNacimiento: string;
}

export interface ResultadoRfcCurp {
  rfc: string;
  curp: string;
}

/** Catálogo de entidades federativas (para el <select>), tal como lo define
 *  la librería "curp" — así no se duplica a mano la lista de 32 estados. */
export const OPCIONES_ENTIDAD: { valor: string; etiqueta: string }[] = curp
  .getEstados()
  .map((e) => ({ valor: e.value, etiqueta: e.label }));

export const OPCIONES_SEXO: { valor: string; etiqueta: string }[] = curp
  .getGeneros()
  .map((g) => ({ valor: g.value, etiqueta: g.label }));

/**
 * Calcula el RFC (con homoclave, 13 caracteres) y el CURP (18 caracteres)
 * de una persona física a partir de sus datos.
 *
 * - RFC: usa la librería "rfc-facil" (algoritmo del IFAI, homoclave incluida).
 * - CURP: usa la librería "curp" (algoritmo del Instructivo Normativo de
 *   RENAPO, incluye el dígito verificador).
 *
 * IMPORTANTE: en el CURP, la posición 17 ("diferenciador de homonimia") la
 * asigna RENAPO solo cuando detecta que dos personas obtendrían la misma
 * clave — no se puede calcular de antemano sin consultar su registro. Estas
 * librerías (como cualquier calculadora no oficial) usan el valor por
 * defecto ('0' o 'A' según el año de nacimiento), así que el resultado es
 * una PRE-validación: coincide con el CURP oficial salvo que exista ese caso
 * de homonimia, en cuyo caso RENAPO asignaría un carácter distinto ahí.
 */
export function calcularRfcYCurp(datos: DatosPersonaRfcCurp): ResultadoRfcCurp {
  const [anioTexto, mesTexto, diaTexto] = datos.fechaNacimiento.split('-');
  const anio = Number(anioTexto);
  const mes = Number(mesTexto);
  const dia = Number(diaTexto);

  const rfc = RfcFacil.forNaturalPerson({
    name: datos.nombre,
    firstLastName: datos.apellidoPaterno,
    secondLastName: datos.apellidoMaterno,
    day: dia,
    month: mes,
    year: anio,
  });

  const persona = curp.getPersona();
  persona.nombre = datos.nombre;
  persona.apellidoPaterno = datos.apellidoPaterno;
  if (datos.apellidoMaterno.trim()) {
    persona.apellidoMaterno = datos.apellidoMaterno;
  }
  persona.genero = datos.sexo;
  persona.estado = datos.entidadNacimiento;
  persona.fechaNacimiento = `${diaTexto.padStart(2, '0')}-${mesTexto.padStart(2, '0')}-${anioTexto}`;

  const curpCalculada = curp.generar(persona);

  return { rfc, curp: curpCalculada };
}

/**
 * Esquema de vacunación de referencia general (no sustituye indicación
 * médica) usado SOLO para sugerir, en la pestaña Salud de cada miembro,
 * qué vacunas comunes podrían faltarle según su edad. No es un catálogo
 * editable por el usuario (a diferencia de ValorLista) porque es
 * información de referencia, no una configuración del sistema.
 */
export interface VacunaReferencia {
  clave: string;
  nombre: string;
  /** Edad mínima recomendada, en meses cumplidos, para esta vacuna/dosis. */
  edadMesesMinima: number;
  dosis: string;
}

export const ESQUEMA_VACUNACION_REFERENCIA: VacunaReferencia[] = [
  { clave: 'bcg', nombre: 'BCG (tuberculosis)', edadMesesMinima: 0, dosis: 'Única, al nacer' },
  { clave: 'hepb', nombre: 'Hepatitis B', edadMesesMinima: 0, dosis: '1ª dosis, al nacer' },
  { clave: 'pentavalente-1', nombre: 'Pentavalente (DPT/Hib/Polio) 1ª dosis', edadMesesMinima: 2, dosis: '1ª dosis' },
  { clave: 'pentavalente-2', nombre: 'Pentavalente (DPT/Hib/Polio) 2ª dosis', edadMesesMinima: 4, dosis: '2ª dosis' },
  { clave: 'pentavalente-3', nombre: 'Pentavalente (DPT/Hib/Polio) 3ª dosis', edadMesesMinima: 6, dosis: '3ª dosis' },
  { clave: 'rotavirus', nombre: 'Rotavirus', edadMesesMinima: 2, dosis: 'Serie de 2-3 dosis' },
  { clave: 'neumococo', nombre: 'Neumocócica conjugada', edadMesesMinima: 2, dosis: 'Serie de 3 dosis' },
  { clave: 'srp', nombre: 'SRP (sarampión, rubéola, paperas)', edadMesesMinima: 12, dosis: '1ª dosis' },
  { clave: 'varicela', nombre: 'Varicela', edadMesesMinima: 12, dosis: 'Única o 2 dosis' },
  { clave: 'hepa', nombre: 'Hepatitis A', edadMesesMinima: 12, dosis: 'Serie de 2 dosis' },
  { clave: 'dpt-refuerzo', nombre: 'DPT refuerzo', edadMesesMinima: 48, dosis: 'Refuerzo 4-6 años' },
  { clave: 'vph', nombre: 'VPH (virus del papiloma humano)', edadMesesMinima: 132, dosis: 'Serie de 2 dosis, desde 11 años' },
  { clave: 'influenza', nombre: 'Influenza estacional', edadMesesMinima: 6, dosis: 'Anual' },
  { clave: 'td-adulto', nombre: 'Tétanos-difteria (Td) adulto', edadMesesMinima: 216, dosis: 'Refuerzo cada 10 años' },
];

/** Normaliza (sin acentos, minúsculas) para comparar nombres de forma
 *  flexible — mismo criterio que usa Asistente Saurix para búsquedas. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Compara el esquema de referencia contra lo ya capturado para un miembro
 *  (match flexible por nombre) y regresa las vacunas que aplican por edad
 *  y todavía no tienen registro — es solo una sugerencia, nunca bloquea
 *  nada ni valida la captura real. */
export function vacunasSugeridasPendientes(
  edadMeses: number | null,
  vacunasCapturadas: { nombre: string }[],
): VacunaReferencia[] {
  if (edadMeses === null) return [];
  const capturadasNormalizadas = vacunasCapturadas.map((v) => normalizar(v.nombre));
  return ESQUEMA_VACUNACION_REFERENCIA.filter((ref) => {
    if (ref.edadMesesMinima > edadMeses) return false;
    const refNorm = normalizar(ref.nombre.split(' ')[0]);
    return !capturadasNormalizadas.some((cap) => cap.includes(refNorm) || refNorm.includes(cap));
  });
}

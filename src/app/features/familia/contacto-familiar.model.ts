/**
 * Directorio familiar general — a diferencia del directorio de contactos de
 * emergencia que vive dentro de cada miembro (pestaña Datos → Contacto y
 * seguro), este NO pertenece a ningún miembro en particular: médico de
 * cabecera, escuela, veterinario, aseguradora, plomero de confianza, etc.
 * Compartido entre todos los usuarios, igual que el resto de Familia.
 */
export interface ContactoFamiliar {
  id: number;
  nombre: string;
  /** Clave de ValorLista grupo GRUPO_CATEGORIA_CONTACTO (ver categoria-contacto.component.ts) — catálogo editable, igual que Parentesco o Tipo de sangre. */
  categoria: string;
  telefono: string;
  correo: string;
  direccion: string;
  notas: string;
  activo: boolean;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

export const GRUPO_CATEGORIA_CONTACTO = 'FamiliaCategoriaContacto';

/** Semilla de fábrica para GRUPO_CATEGORIA_CONTACTO — sin claves protegidas,
 *  el usuario puede agregar/quitar/renombrar libremente desde Familia →
 *  Catálogos → Categoría de contacto (mismo criterio que Tipo de sangre). */
export const SEMILLA_CATEGORIA_CONTACTO: { clave: string; etiqueta: string }[] = [
  { clave: 'Medico', etiqueta: 'Médico' },
  { clave: 'Escuela', etiqueta: 'Escuela' },
  { clave: 'Veterinario', etiqueta: 'Veterinario' },
  { clave: 'Seguro', etiqueta: 'Seguro' },
  { clave: 'MantenimientoHogar', etiqueta: 'Mantenimiento del hogar' },
  { clave: 'Otro', etiqueta: 'Otro' },
];

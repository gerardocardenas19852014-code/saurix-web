/**
 * Contacto de emergencia adicional de un miembro — siempre texto libre, a
 * propósito (no una FK a otro MiembroFamilia): puede ser un vecino, un
 * amigo o un familiar que no está capturado en el sistema. Los campos
 * contactoEmergenciaNombre/contactoEmergenciaTelefono de MiembroFamilia
 * (un solo contacto, el que sale en la tarjeta de emergencia impresa) NO
 * se tocan ni se reemplazan: esto es un directorio aparte, para cuando se
 * necesita más de un contacto.
 */
export interface ContactoEmergenciaMiembro {
  id: number;
  miembroFamiliaId: number;
  nombre: string;
  relacion: string;
  telefono: string;
  notas: string;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

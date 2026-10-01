/** Estados fijos del embudo de calificación de un Lead — mismo criterio que
 *  Comercio.Cotizacion.Estado (string fijo, no un catálogo aparte: son pocos
 *  valores y su significado está ligado a lógica de la app, como el botón
 *  "Convertir a cliente" que solo aplica en 'Calificado'). */
export type LeadEstado = 'Nuevo' | 'Contactado' | 'Calificado' | 'Descartado' | 'Convertido';

export const LEAD_ESTADOS: LeadEstado[] = ['Nuevo', 'Contactado', 'Calificado', 'Descartado', 'Convertido'];

export interface Lead {
  id: number;
  nombre: string;
  empresa: string | null;
  telefono: string | null;
  email: string | null;
  /** FK a LeadOrigen (catálogo) — de dónde llegó el prospecto. */
  origenId: number | null;
  estado: LeadEstado;
  notas: string | null;
  /** Id del Cliente (Comercio) creado al convertir este lead — null mientras
   *  no se haya convertido. Una vez con valor, el lead queda de solo lectura
   *  (ver leads-list.component.ts: convertirACliente()). */
  clienteConvertidoId: number | null;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

/** Catálogo simple (CatalogoSimpleComponent) — de dónde vienen los leads
 *  (web, referido, feria, redes, etc.), lista abierta a que el usuario la
 *  edite según su negocio. */
export interface LeadOrigen {
  id: number;
  nombre: string;
  activo: boolean;
}

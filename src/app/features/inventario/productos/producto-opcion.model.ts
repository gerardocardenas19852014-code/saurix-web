/**
 * Variantes de un Producto con costo adicional — al estilo "combo de
 * cine" (ver captura de Cinépolis que mandó el usuario): un grupo es una
 * pregunta ("Elige el sabor"), y cada valor es una opción seleccionable
 * con su propio `precioAdicional` (puede ser 0, o incluso no usarse —
 * simplemente no se le da de alta ningún grupo a ese producto).
 *
 * Solo importan para la TIENDA PÚBLICA (ver /tienda — tienda.service.ts
 * y seguridad.tienda_detalle en la base) y para que el cliente arme bien
 * su pedido antes de mandarlo por WhatsApp/correo; Cobro (venta normal en
 * el POS) no los usa todavía — ahí sigue siendo "Venta simple"/producto
 * sin variantes, igual que hasta ahora.
 */
export type TipoSeleccionOpcion = 'unica' | 'multiple';

export const TIPOS_SELECCION_OPCION: { valor: TipoSeleccionOpcion; etiqueta: string }[] = [
  { valor: 'unica', etiqueta: 'Única (radio) — el cliente elige solo una' },
  { valor: 'multiple', etiqueta: 'Múltiple (checkbox) — el cliente puede elegir varias' },
];

export interface ProductoOpcionGrupo {
  id: number;
  productoId: number;
  nombre: string;
  tipoSeleccion: TipoSeleccionOpcion;
  /** Si es true, el cliente debe elegir algo de este grupo antes de poder
   *  agregar el producto a su carrito en /tienda. */
  requerido: boolean;
  /** Solo tienen sentido con tipoSeleccion 'multiple' (en 'unica' siempre
   *  es exactamente 1) — mínimo/máximo de valores que puede marcar. */
  minimo: number;
  maximo: number;
  /** Orden de aparición entre los grupos de un mismo producto. */
  orden: number;
  activo: boolean;
}

export interface ProductoOpcionValor {
  id: number;
  grupoId: number;
  nombre: string;
  /** Costo que se SUMA al precio base del producto si el cliente elige
   *  este valor — puede ser 0 (opción sin costo extra). */
  precioAdicional: number;
  /** Orden de aparición entre los valores de un mismo grupo. */
  orden: number;
  activo: boolean;
}

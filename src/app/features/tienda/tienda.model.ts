/**
 * Formas que devuelve seguridad.tienda_detalle()/tiendas_activas() (ver
 * supabase/migrations/27_tienda_publica.sql) — reflejan EXACTAMENTE las
 * claves del jsonb armado ahí (camelCase, porque esas 2 funciones ya
 * devuelven los nombres así, a diferencia del resto del sistema que pasa
 * por filaACamel() en supabase-data-client.service.ts: aquí no aplica
 * porque no son tablas leídas por el contrato DataClientService, son RPC
 * de solo lectura pública, llamadas directo con el cliente de Supabase —
 * ver tienda-publica.service.ts).
 */
export interface TiendaActiva {
  clave: string;
  nombre: string;
  descripcion: string | null;
  logo: string | null;
}

export type TipoSeleccionOpcionTienda = 'unica' | 'multiple';

export interface OpcionValorTienda {
  id: number;
  nombre: string;
  precioAdicional: number;
}

export interface OpcionGrupoTienda {
  id: number;
  nombre: string;
  tipoSeleccion: TipoSeleccionOpcionTienda;
  requerido: boolean;
  minimo: number;
  maximo: number;
  valores: OpcionValorTienda[];
}

export interface ProductoTienda {
  id: number;
  nombre: string;
  descripcion: string | null;
  precio: number;
  foto: string | null;
  /** false = sin existencia (no es servicio) — se muestra pero no se puede agregar al carrito. */
  disponible: boolean;
  opciones: OpcionGrupoTienda[];
}

export interface EmpresaTienda {
  clave: string;
  nombre: string;
  descripcion: string | null;
  telefono: string | null;
  correo: string | null;
  logo: string | null;
}

export interface TiendaDetalle {
  empresa: EmpresaTienda;
  productos: ProductoTienda[];
}

/** Una línea del carrito — vive SOLO en memoria del navegador (signal del
 *  componente), nunca se guarda en ningún lado: no hay pedido en la base,
 *  ver el comentario grande en 27_tienda_publica.sql sobre por qué. Un
 *  mismo producto con distintas opciones elegidas son líneas separadas
 *  (p.ej. 2 Bolis de fresa + 1 de limón = 2 líneas). */
export interface LineaCarritoTienda {
  /** Identificador de línea (no de producto) — para poder tener el mismo
   *  producto varias veces con distintas opciones. */
  claveLinea: string;
  productoId: number;
  nombreProducto: string;
  precioBase: number;
  /** Cada valor elegido, de cualquier grupo, ya "aplanado" — para el
   *  mensaje y para sumar el total. */
  opcionesElegidas: { grupoNombre: string; valorNombre: string; precioAdicional: number }[];
  cantidad: number;
}

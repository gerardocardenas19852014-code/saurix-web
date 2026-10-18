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
  /** Categoría de inventario.categoria_producto — para agrupar/separar el
   *  catálogo público por categoría (ver migración 29). */
  categoriaId: number;
  categoriaNombre: string;
  opciones: OpcionGrupoTienda[];
  /** La empresa lo marcó para la sección "⭐ Destacados" del catálogo. */
  destacado: boolean;
  /** Para la insignia "🆕 Nuevo" — se compara contra hoy en el navegador
   *  (nuevoCatalogoTienda(), ver catalogo-tienda.component.ts), igual
   *  criterio que estadoHorario() con horario_atencion. */
  fechaCreacion: string;
  /** true = existencia baja (por debajo de su nivel mínimo configurado en
   *  Productos) pero no agotado — para la insignia "⚡ Pocas piezas". Nunca
   *  expone la cantidad exacta, solo esta bandera (calculada en el RPC). */
  pocasExistencias: boolean;
}

export interface HorarioDiaTienda {
  /** 0 = domingo … 6 = sábado, igual que Date.getDay() en JS. */
  dia: number;
  abre: string;
  cierra: string;
  cerrado: boolean;
}

export interface EmpresaTienda {
  clave: string;
  nombre: string;
  descripcion: string | null;
  telefono: string | null;
  correo: string | null;
  logo: string | null;
  /** Arreglo vacío = sin horario configurado (no se muestra el badge de
   *  abierto/cerrado). */
  horario: HorarioDiaTienda[];
  metodosPago: string[];
  /** null = sin pedido mínimo. */
  pedidoMinimo: number | null;
  /** Si está en false, no se muestra el banner "¿Pedir lo mismo que la
   *  última vez?" aunque el navegador tenga un pedido anterior guardado —
   *  ver volverPedirActivo() de la empresa en el panel y el banner en
   *  catalogo-tienda.component.html. */
  volverPedirActivo: boolean;
  /** Color de marca elegido por la empresa (hex, p.ej. "#e11d48") — se
   *  aplica como la variable CSS --color-primario en toda la tienda (ver
   *  [style.--color-primario] en catalogo-tienda.component.html). null =
   *  usa el azul por defecto del frontend. */
  colorAcento: string | null;
  // ── Envío por distancia (línea recta) — ver catalogo-tienda.component.ts.
  // null en origen o en precioKm = envío por distancia desactivado. ──────
  envioOrigenLat: number | null;
  envioOrigenLng: number | null;
  envioPrecioKm: number | null;
  envioMinimo: number | null;
  envioDistanciaMaximaKm: number | null;
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

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
  /** Color de letra del banner (hex, p.ej. "#1f2937") — independiente de
   *  colorAcento (ese es el FONDO del banner). null = usa el blanco por
   *  defecto del frontend; existe porque con un colorAcento claro/pastel
   *  el texto blanco casi no se alcanza a leer. */
  colorTextoBanner: string | null;
  // ── Envío por distancia (línea recta) — ver catalogo-tienda.component.ts.
  // null en origen o en precioKm = envío por distancia desactivado. ──────
  envioOrigenLat: number | null;
  envioOrigenLng: number | null;
  envioPrecioKm: number | null;
  envioMinimo: number | null;
  envioDistanciaMaximaKm: number | null;
  /** false = "menú visual": catálogo solo informativo, sin carrito ni envío
   *  de pedido (ver 42_tienda_catalogo_visual.sql) — el negocio solo quiere
   *  mostrar su menú/catálogo bonito, accesible por el mismo QR de siempre,
   *  pero no toma pedidos en línea. Default true (no cambia tiendas ya
   *  configuradas, ver catalogo-tienda.component.ts: modoVisual()). */
  aceptaPedidos: boolean;
  // ── Modalidades de entrega (ver 43_tienda_modalidades_entrega.sql) ────
  /** Apaga/prende TEMPORALMENTE el envío por distancia ya configurado
   *  arriba (envioOrigenLat/envioPrecioKm, etc. — esos campos NO se
   *  tocan al apagar esto, solo se deja de ofrecer la modalidad).
   *  Default true: una tienda que ya usaba envío por distancia (p.ej. La
   *  Reyna de los Bolis) sigue exactamente igual sin que el dueño toque
   *  nada nuevo. */
  envioPropioActivo: boolean;
  /** Mínimo de SUBTOTAL de productos (antes del costo de envío) para
   *  poder elegir "Envío del negocio" — null = sin mínimo específico
   *  (distinto de pedidoMinimo, que aplica a CUALQUIER modalidad). */
  envioPropioPedidoMinimo: number | null;
  /** "Pasar a recoger en sucursal" — sin GPS, sin costo. */
  recoleccionActiva: boolean;
  /** Dirección en texto para mostrar en "Pasar a recoger" — no existía
   *  ningún campo de dirección legible antes de esto (envioOrigenLat/Lng
   *  son coordenadas, no texto). null = no se muestra la línea. */
  direccionPublica: string | null;
  /** "Envío por plataforma" (Uber/inDrive/etc.) — Saurix NO integra
   *  ninguna API ni calcula tarifas, solo prepara la información
   *  (ubicación/referencias) para que el negocio cotice el repartidor
   *  aparte. Tiene 2 variantes independientes, ver abajo. */
  envioPlataformaActivo: boolean;
  /** Variante A: el negocio recibe el pedido, cotiza el repartidor y
   *  confirma el costo con el cliente antes de solicitarlo. */
  envioPlataformaNegocioSolicita: boolean;
  /** Variante B: el cliente solicitará y pagará su propio repartidor —
   *  la tienda solo le avisa cuándo está listo para recoger. */
  envioPlataformaClienteSolicita: boolean;
}

/** Las 3 modalidades grandes que el cliente elige en el paso "Entrega"
 *  (ver catalogo-tienda.component.ts: modalidadEntrega()). Cuando es
 *  'plataforma' y la empresa ofrece las 2 variantes, hay una elección
 *  secundaria (ver VariantePlataformaTienda, abajo). */
export type ModalidadEntregaTienda = 'envio_propio' | 'recoleccion' | 'plataforma';

/** Sub-elección dentro de 'plataforma' — cuál de las 2 variantes
 *  configurables usa este pedido en concreto. */
export type VariantePlataformaTienda = 'negocio' | 'cliente';

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
  /** Para la miniatura en el panel del carrito — null si el producto no
   *  tiene foto (se usa el mismo placeholder que en la tarjeta). Un
   *  carrito guardado de ANTES de este campo (localStorage, "volver a
   *  pedir") simplemente no lo trae — se trata como null, no rompe nada. */
  fotoProducto: string | null;
  /** Cada valor elegido, de cualquier grupo, ya "aplanado" — para el
   *  mensaje y para sumar el total. */
  opcionesElegidas: { grupoNombre: string; valorNombre: string; precioAdicional: number }[];
  cantidad: number;
}

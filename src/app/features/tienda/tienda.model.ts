/**
 * Formas que devuelven las funciones RPC públicas del sistema (ver
 * supabase/migrations/27_tienda_publica.sql y la homologación de
 * rendimiento de 2026-10: seguridad.tienda_detalle() ahora solo trae la
 * configuración de la tienda — el catálogo se carga aparte, paginado, vía
 * fn_catalogo_tienda_pagina()/fn_tienda_categorias()/fn_tienda_destacados())
 * — llamadas directo con el cliente de Supabase, sin pasar por
 * DataClientService, porque NO son tablas: son funciones security definer
 * que ya filtran por empresa_id adentro. No requieren sesión (se llaman
 * con el rol `anon`) — por eso esta pantalla funciona sin login, a
 * diferencia de todo lo demás en Saurix. Los nombres de los campos vienen
 * en camelCase directo del RPC (no pasan por filaACamel()).
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
  /** URL pública (Supabase Storage, bucket "catalogo-publico") para la
   *  tarjeta de catálogo/carrusel de destacados/miniatura del carrito —
   *  null = sin foto (se muestra el placeholder 📦). Antes era base64
   *  incrustado en el mismo JSON del catálogo; ahora es una URL aparte que
   *  el navegador pide solo cuando de verdad va a pintar esa tarjeta (y
   *  puede quedar cacheada por el navegador entre visitas). */
  fotoThumbUrl: string | null;
  /** URL pública de mayor resolución — se usa SOLO al ampliar la imagen
   *  (ver ampliarImagen() en catalogo-tienda.component.ts), para no bajar
   *  la versión grande mientras se navega el catálogo normal. */
  fotoDetalleUrl: string | null;
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
   *  expone la cantidad exacta, solo esta bandera (calculada en el RPC,
   *  reutilizando inventario.existencia_producto_resumen cuando existe). */
  pocasExistencias: boolean;
}

export interface HorarioDiaTienda {
  /** 0 = domingo … 6 = sábado, igual que Date.getDay() en JS. */
  dia: number;
  abre: string;
  cierra: string;
  cerrado: boolean;
}

/** Modo de funcionamiento de la tienda pública — ver EmpresaTienda.modo y
 *  seguridad.empresa.modo_tienda. */
export type ModoTienda = 'menu_visual' | 'menu_orden' | 'pedidos_online';

export interface EmpresaTienda {
  clave: string;
  nombre: string;
  descripcion: string | null;
  telefono: string | null;
  correo: string | null;
  /** URL pública del logo (antes base64) — también usada para
   *  og:image/twitter:image (ver actualizarMetadatos()): con URL real, la
   *  vista previa al compartir por WhatsApp/redes ya funciona. */
  logo: string | null;
  /** URL pública de la imagen de portada (hero) configurada por la
   *  empresa en Empresas — mismo mecanismo que el logo (base64 -> trigger
   *  -> edge function tienda-imagenes -> Storage). null = la empresa no
   *  configuró una; en ese caso heroImagenUrl() en catalogo-tienda.component.ts
   *  devuelve null y se muestra el degradado con el color de marca. */
  imagenPortada: string | null;
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
  /** Modo de funcionamiento de la tienda pública (ver empresas.component.ts
   *  y catalogo-tienda.component.ts: modoVisual()/modoTienda()):
   *  - 'menu_visual': catálogo solo informativo, sin carrito ni pedido.
   *  - 'menu_orden': "Menú + Mi orden" — el cliente arma una orden local y
   *    la muestra en caja (folio/QR), NO es un pedido en línea ni una venta.
   *  - 'pedidos_online': flujo completo actual de carrito/entrega/envío.
   *  Sustituye al antiguo booleano aceptaPedidos (ver modo_tienda en
   *  seguridad.empresa). */
  modo: ModoTienda;
  // ── Modalidades de entrega (ver 43_tienda_modalidades_entrega.sql) ────
  /** Apaga/prende TEMPORALMENTE el envío por distancia ya configurado
   *  arriba (envioOrigenLat/envioPrecioKm, etc. — esos campos NO se
   *  tocan al apagar esto, solo se deja de ofrecer la modalidad).
   *  Default true: una tienda que ya usaba envío por distancia (p.ej. La
   *  Reyna de los Bolis) sigue exactamente igual sin que el dueño toque
   *  nada nuevo. */
  envioPropioActivo: boolean;
  /** Cantidad mínima de PRODUCTOS/PIEZAS en el carrito (suma de
   *  cantidades, no dinero) para poder elegir "Envío del negocio" — null
   *  = sin mínimo específico (distinto de pedidoMinimo, que es un monto
   *  en dinero y aplica a CUALQUIER modalidad). */
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

/** seguridad.tienda_detalle(p_clave) — SOLO la configuración de la tienda
 *  (desde la homologación de rendimiento de 2026-10, ya no trae
 *  "productos": eso se carga aparte y paginado, ver abajo). */
export interface ConfiguracionTienda {
  empresa: EmpresaTienda;
}

/** seguridad.fn_tienda_categorias(p_clave) — chips de categoría, consulta
 *  chica e independiente del catálogo paginado (ver sección K de la
 *  homologación: nunca se derivan descargando el catálogo completo). */
export interface CategoriaTienda {
  id: number;
  nombre: string;
}

/** Cursor de keyset para seguir pidiendo páginas del catálogo — se manda
 *  tal cual lo regresó la página anterior; el campo que de verdad importa
 *  depende del orden activo ('categoria' usa categoriaNombre+nombre+id,
 *  'precio' usa precio+id), pero se guarda completo para no tener que
 *  recordar qué orden estaba activo cuando se pidió. */
export interface CursorCatalogoTienda {
  categoriaNombre: string | null;
  nombre: string | null;
  precio: number | null;
  id: number | null;
}

/** seguridad.fn_catalogo_tienda_pagina(...) — una página del catálogo. */
export interface PaginaCatalogoTienda {
  productos: ProductoTienda[];
  hayMas: boolean;
  cursor: CursorCatalogoTienda | null;
  /** Solo presente si la clave no resolvió a una tienda válida. */
  error?: string;
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
   *  pedir") simplemente no lo trae — se trata como null, no rompe nada.
   *  Desde la homologación de 2026-10 guarda la URL del thumbnail, no
   *  base64. */
  fotoProducto: string | null;
  /** Cada valor elegido, de cualquier grupo, ya "aplanado" — para el
   *  mensaje y para sumar el total. */
  opcionesElegidas: { grupoNombre: string; valorNombre: string; precioAdicional: number; valorId: number }[];
  cantidad: number;
}

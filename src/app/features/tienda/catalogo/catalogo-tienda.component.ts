import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Meta, Title } from '@angular/platform-browser';
import { TiendaPublicaService } from '../tienda-publica.service';
import { EmpresaTienda, LineaCarritoTienda, ModalidadEntregaTienda, ProductoTienda, TiendaDetalle, VariantePlataformaTienda } from '../tienda.model';

/** Selección en curso dentro del modal de un producto: por cada grupo de
 *  opciones, los id de valor marcados (radio = 1 elemento, checkbox =
 *  varios). Vive solo mientras el modal está abierto. */
type SeleccionOpciones = Record<number, number[]>;

/** Nombres largos de los 7 días, en el mismo orden que Date.getDay() (0 =
 *  domingo) — para armar el texto "Cerrado · abre el martes a las…". */
const NOMBRES_DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** Distancia en línea recta entre 2 puntos (fórmula de Haversine, km) — NO
 *  es distancia real por calles (eso necesitaría contratar un servicio
 *  externo tipo Google Maps), pero alcanza para estimar un envío sin
 *  depender de ninguna cuenta/llave de API. */
function distanciaKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const radianes = Math.PI / 180;
  const dLat = (lat2 - lat1) * radianes;
  const dLng = (lng2 - lng1) * radianes;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * radianes) * Math.cos(lat2 * radianes) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** metodosPago es texto libre (lo captura la empresa en Seguridad →
 *  Empresas, sin catálogo cerrado — ver 32_tienda_horario_pago_minimo.sql),
 *  así que el icono se adivina por palabras clave en vez de un catálogo
 *  fijo de opciones. Si no coincide con ninguna, se muestra sin icono (solo
 *  el texto tal cual lo escribió la empresa). */
function calcularIconoMetodoPago(metodo: string): string {
  const texto = metodo
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (texto.includes('efectivo')) return '💵';
  if (texto.includes('tarjeta') || texto.includes('credito') || texto.includes('debito')) return '💳';
  if (texto.includes('transfer') || texto.includes('deposito') || texto.includes('spei')) return '🏦';
  if (texto.includes('paypal')) return '🅿️';
  if (texto.includes('mercado pago') || texto.includes('mercadopago')) return '🅼';
  return '🏷️';
}

@Component({
  selector: 'app-catalogo-tienda',
  standalone: true,
  imports: [RouterLink, ReactiveFormsModule, DecimalPipe],
  templateUrl: './catalogo-tienda.component.html',
  styleUrl: './catalogo-tienda.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatalogoTiendaComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly tiendaService = inject(TiendaPublicaService);
  private readonly fb = inject(FormBuilder);
  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);

  // Elementos de <head> que esta pantalla agrega para "Agregar a pantalla de
  // inicio" (ver actualizarAccesoDirecto()) — se quitan en ngOnDestroy() para
  // no dejarle su manifest/ícono a otra pantalla de la app.
  private linkManifest: HTMLLinkElement | null = null;
  private linkIcono: HTMLLinkElement | null = null;
  private urlManifestAnterior: string | null = null;

  protected readonly cargando = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly detalle = signal<TiendaDetalle | null>(null);
  protected readonly busqueda = signal('');
  /** Cuadrícula (tarjetas) o lista (renglones compactos) — se recuerda por
   *  navegador (localStorage) para que no se tenga que elegir cada visita;
   *  si no está disponible (modo privado, etc.) simplemente no se recuerda. */
  protected readonly vistaLista = signal(this.leerVistaGuardada());
  /** Agrupar las secciones del catálogo por categoría (como siempre) o por
   *  precio — igual que vistaLista(), es un interruptor tipo lista/cuadrícula
   *  y también se recuerda por navegador. */
  protected readonly agruparPorPrecio = signal(this.leerAgrupacionGuardada());

  protected readonly carrito = signal<LineaCarritoTienda[]>([]);
  protected readonly carritoAbierto = signal(false);

  // ── Modal de "elige tus opciones" (al estilo combo de cine) ──────────
  protected readonly productoEnModal = signal<ProductoTienda | null>(null);
  protected readonly seleccionModal = signal<SeleccionOpciones>({});
  protected readonly cantidadModal = signal(1);

  // ── Modal de "enviar pedido" (datos del cliente antes del WhatsApp/correo) ──
  //    Internamente son 3 PASOS visuales (datos → entrega → revisar) sobre
  //    el MISMO modal/form de siempre — no cambia nada de la lógica de
  //    envío, solo el orden en que se muestran los campos (ver
  //    siguientePaso()/pasoAnterior() más abajo). El panel del carrito
  //    (más arriba en el HTML) funciona como el paso implícito "Tu pedido".
  protected readonly modalEnviarAbierto = signal(false);
  protected readonly pasoModal = signal<'datos' | 'entrega' | 'revisar'>('datos');
  protected readonly formCliente = this.fb.nonNullable.group({
    nombre: ['', [Validators.required, Validators.maxLength(80)]],
    telefono: ['', [Validators.required, Validators.maxLength(30)]],
    notas: ['', [Validators.maxLength(300)]],
  });

  // ── Ubicación por GPS (reemplaza un campo de dirección escrita a mano:
  //    el cliente comparte su posición real y se manda como link de Maps
  //    en el mensaje) — opcional, no bloquea el envío si la niega o falla. ──
  protected readonly ubicacion = signal<{ lat: number; lng: number } | null>(null);
  protected readonly obteniendoUbicacion = signal(false);
  protected readonly ubicacionError = signal<string | null>(null);

  // ── Compartir (copiar link / código QR) ──────────────────────────────
  protected readonly modalCompartirAbierto = signal(false);
  protected readonly linkCopiado = signal(false);

  // ── "Volver a pedir lo mismo" — el último pedido enviado desde este
  //    navegador en ESTA tienda, guardado en localStorage (sin cuenta, ver
  //    guardarUltimoPedido()/volverAPedir()). ──────────────────────────
  protected readonly ultimoPedidoDisponible = signal(false);

  // ── Ver imagen grande (botón "+" sobre la foto del producto). ────────
  protected readonly imagenAmpliada = signal<string | null>(null);

  // ── Pulso del botón del carrito al agregar algo (micro-interacción) —
  //    se enciende en dispararPulsoCarrito() y se apaga solo medio segundo
  //    después; ver agregarLineaAlCarrito() y cambiarCantidadProducto(). ──
  protected readonly pulsoCarrito = signal(false);

  private dispararPulsoCarrito(): void {
    this.pulsoCarrito.set(false);
    setTimeout(() => this.pulsoCarrito.set(true));
    setTimeout(() => this.pulsoCarrito.set(false), 500);
  }

  // ── Confeti al mandar el pedido por WhatsApp (ver enviarPorWhatsapp()) ──
  //    Fijo (no aleatorio) para que sea el mismo array de siempre — nomás
  //    la posición/retraso de cada pieza varía por CSS (nth-child). ──────
  protected readonly confetiPiezas = ['🎉', '🎊', '✨', '🎉', '🎊', '✨', '🎉', '🎊'];
  protected readonly confetiVisible = signal(false);

  private mostrarConfeti(): void {
    this.confetiVisible.set(true);
    setTimeout(() => this.confetiVisible.set(false), 1800);
  }

  // ── Mensaje de "pedido listo" justo al abrir WhatsApp — deja clarísimo
  //    que mandar el mensaje NO equivale a que el negocio ya lo aceptó
  //    (ver el texto exacto en enviarPorWhatsapp()). Se apaga solo. ──────
  protected readonly mensajeExitoEnvio = signal<string | null>(null);

  private mostrarExitoEnvio(texto: string): void {
    this.mensajeExitoEnvio.set(texto);
    setTimeout(() => this.mensajeExitoEnvio.set(null), 4500);
  }

  protected readonly productosFiltrados = computed<ProductoTienda[]>(() => {
    const texto = this.busqueda().trim().toLowerCase();
    const productos = this.detalle()?.productos ?? [];
    if (!texto) return productos;
    return productos.filter(
      (p) => p.nombre.toLowerCase().includes(texto) || (p.descripcion ?? '').toLowerCase().includes(texto),
    );
  });

  // ── Chips de categoría (arriba del catálogo) — null = "Todas". Un filtro
  // MÁS sobre productosFiltrados() (la búsqueda), no lo reemplaza: se
  // pueden combinar los dos. Si la categoría activa deja de existir (p.ej.
  // la búsqueda ya no trae ningún producto de esa categoría), el filtro
  // sigue aplicado pero simplemente no hay resultados — no se resetea solo,
  // para no perder la selección del cliente mientras sigue escribiendo. ──
  protected readonly categoriaActiva = signal<number | null>(null);

  /** Lista de categorías con al menos un producto disponible para mostrar
   *  como chips — se arma de los productos YA filtrados por búsqueda, para
   *  que no aparezcan chips de categorías sin resultados mientras se busca. */
  protected readonly categoriasDisponibles = computed<{ id: number; nombre: string }[]>(() => {
    const vistas = new Map<number, string>();
    for (const p of this.productosFiltrados()) {
      if (!vistas.has(p.categoriaId)) vistas.set(p.categoriaId, p.categoriaNombre);
    }
    return [...vistas.entries()]
      .map(([id, nombre]) => ({ id, nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  });

  protected elegirCategoria(id: number | null): void {
    this.categoriaActiva.set(id);
  }

  /** productosFiltrados() + el chip de categoría — es lo que de verdad
   *  alimenta gruposProductos() de abajo. */
  protected readonly productosVisibles = computed<ProductoTienda[]>(() => {
    const categoriaId = this.categoriaActiva();
    const productos = this.productosFiltrados();
    return categoriaId == null ? productos : productos.filter((p) => p.categoriaId === categoriaId);
  });

  /** true = "menú visual" (ver 42_tienda_catalogo_visual.sql): la empresa
   *  apagó los pedidos en línea — el catálogo se muestra igual (mismo QR),
   *  pero sin carrito, sin "Agregar"/"Elegir" y sin botón de enviar pedido.
   *  Se deriva del detalle cargado, no es un signal propio: no hay forma de
   *  cambiarlo desde el navegador del cliente. */
  protected readonly modoVisual = computed(() => this.detalle()?.empresa.aceptaPedidos === false);

  /** Carrusel "⭐ Destacados" arriba del catálogo — los que la empresa marcó
   *  como destacado() en Productos y que sigan disponibles. A propósito NO
   *  se filtran por la búsqueda (busqueda()): es una vitrina fija, no otra
   *  lista de resultados; si se vacía, el carrusel completo desaparece. */
  protected readonly productosDestacados = computed<ProductoTienda[]>(() =>
    (this.detalle()?.productos ?? []).filter((p) => p.destacado && p.disponible),
  );

  /** "🆕 Nuevo" en la tarjeta si se dio de alta hace 14 días o menos (no hay
   *  "más vendido": el RPC público no tiene acceso a datos de ventas). */
  protected esNuevo(fechaCreacion: string): boolean {
    const dias = (Date.now() - new Date(fechaCreacion).getTime()) / 86_400_000;
    return dias >= 0 && dias <= 14;
  }

  /** Catálogo agrupado por categoría o por precio (en vez de una sola rejilla
   *  plana) según agruparPorPrecio() — ver cambiarAgrupacion(). Por categoría,
   *  el RPC ya devuelve los productos ordenados por categoriaNombre y luego
   *  por nombre (ver migración 29), así que basta con juntar consecutivos en
   *  el mismo grupo; por precio se ordenan aquí mismo de menor a mayor. */
  protected readonly gruposProductos = computed<{ clave: string; titulo: string; productos: ProductoTienda[] }[]>(() => {
    const productos = this.productosVisibles();
    const porPrecio = this.agruparPorPrecio();
    const ordenados = porPrecio
      ? [...productos].sort((a, b) => a.precio - b.precio || a.nombre.localeCompare(b.nombre))
      : productos;

    const grupos: { clave: string; titulo: string; productos: ProductoTienda[] }[] = [];
    for (const producto of ordenados) {
      const clave = porPrecio ? producto.precio.toFixed(2) : String(producto.categoriaId);
      const titulo = porPrecio ? `$${producto.precio.toFixed(2)}` : producto.categoriaNombre;
      const grupoActual = grupos[grupos.length - 1];
      if (grupoActual && grupoActual.clave === clave) {
        grupoActual.productos.push(producto);
      } else {
        grupos.push({ clave, titulo, productos: [producto] });
      }
    }
    return grupos;
  });

  /** Cuántas unidades de cada producto (sumando todas sus variantes/opciones)
   *  ya están en el carrito — para mostrar el botón 🗑 junto a "Agregar" en el
   *  catálogo solo cuando aplica (ver quitarProductoDelCarrito()). */
  protected readonly cantidadesEnCarrito = computed<Record<number, number>>(() => {
    const totales: Record<number, number> = {};
    for (const linea of this.carrito()) {
      totales[linea.productoId] = (totales[linea.productoId] ?? 0) + linea.cantidad;
    }
    return totales;
  });

  protected readonly totalCarrito = computed(() =>
    this.carrito().reduce((acc, l) => acc + this.subtotalLinea(l), 0),
  );
  protected readonly cantidadArticulos = computed(() => this.carrito().reduce((acc, l) => acc + l.cantidad, 0));

  /** Total adicional de las opciones marcadas AHORA en el modal (antes de confirmar). */
  protected readonly precioExtraModal = computed(() => {
    const producto = this.productoEnModal();
    if (!producto) return 0;
    const seleccion = this.seleccionModal();
    let extra = 0;
    for (const grupo of producto.opciones) {
      for (const valorId of seleccion[grupo.id] ?? []) {
        const valor = grupo.valores.find((v) => v.id === valorId);
        if (valor) extra += valor.precioAdicional;
      }
    }
    return extra;
  });

  protected readonly precioUnitarioModal = computed(() => (this.productoEnModal()?.precio ?? 0) + this.precioExtraModal());

  /** "Abierto ahora"/"Cerrado · abre…" calculado con la hora LOCAL del
   *  navegador contra detalle().empresa.horario — null si la empresa no
   *  configuró horario (no se muestra ningún badge en ese caso). */
  protected readonly estadoHorario = computed<{ abierto: boolean; texto: string } | null>(() => {
    const horario = this.detalle()?.empresa.horario ?? [];
    if (horario.length === 0) return null;
    const ahora = new Date();
    const diaHoy = ahora.getDay();
    const horaActual = `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`;
    const porDia = new Map(horario.map((h) => [h.dia, h]));

    const hoy = porDia.get(diaHoy);
    if (hoy && !hoy.cerrado && horaActual >= hoy.abre && horaActual < hoy.cierra) {
      return { abierto: true, texto: `Abierto ahora · cierra a las ${hoy.cierra}` };
    }

    // Busca el próximo día con horario (empezando hoy, si es que todavía no abre hoy).
    for (let i = 0; i < 7; i++) {
      const dia = (diaHoy + i) % 7;
      const fila = porDia.get(dia);
      if (!fila || fila.cerrado) continue;
      if (i === 0 && horaActual >= fila.abre) continue; // hoy ya cerró
      const cuando = i === 0 ? `hoy a las ${fila.abre}` : i === 1 ? `mañana a las ${fila.abre}` : `el ${NOMBRES_DIAS[dia]} a las ${fila.abre}`;
      return { abierto: false, texto: `Cerrado · abre ${cuando}` };
    }
    return { abierto: false, texto: 'Cerrado' };
  });

  /** null = sin pedido mínimo configurado. */
  protected readonly pedidoMinimo = computed(() => this.detalle()?.empresa.pedidoMinimo ?? null);
  /** Cuánto falta para llegar al mínimo — 0 si ya se alcanzó o no hay mínimo. */
  protected readonly faltaParaMinimo = computed(() => {
    const minimo = this.pedidoMinimo();
    if (!minimo) return 0;
    const falta = minimo - this.totalCarrito();
    return falta > 0 ? falta : 0;
  });
  protected readonly cumpleMinimo = computed(() => this.faltaParaMinimo() === 0);

  /** Envío estimado según la distancia en línea recta entre el negocio y la
   *  ubicación que el cliente comparte (ver ubicacion()/compartirUbicacion())
   *  — null si la empresa no configuró envío por distancia o el cliente
   *  todavía no comparte su ubicación. fueraDeZona es solo informativo, NO
   *  bloquea el envío (la empresa de todas formas valida el pedido a mano). */
  protected readonly envioInfo = computed<{ km: number; costo: number; fueraDeZona: boolean } | null>(() => {
    const empresa = this.detalle()?.empresa;
    const miUbicacion = this.ubicacion();
    if (!empresa || !miUbicacion || empresa.envioOrigenLat == null || empresa.envioOrigenLng == null || !empresa.envioPrecioKm) {
      return null;
    }
    const km = distanciaKm(empresa.envioOrigenLat, empresa.envioOrigenLng, miUbicacion.lat, miUbicacion.lng);
    const costo = Math.max(km * empresa.envioPrecioKm, empresa.envioMinimo ?? 0);
    const fueraDeZona = empresa.envioDistanciaMaximaKm != null && km > empresa.envioDistanciaMaximaKm;
    return { km, costo, fueraDeZona };
  });

  /** Total del carrito + envío estimado (si aplica) — lo que de verdad se
   *  manda como "Total" en el mensaje de WhatsApp cuando hay envío. */
  protected readonly totalConEnvio = computed(() => this.totalCarrito() + (this.envioInfo()?.costo ?? 0));

  // ── Modalidades de entrega (ver 43_tienda_modalidades_entrega.sql) ──────
  //    Diseño a propósito "aditivo": si una tienda nunca configuró ninguna
  //    de las 3 (modalidadesDisponibles() queda vacío — el caso de CASI
  //    toda tienda existente hoy), el paso "Entrega" se ve y se comporta
  //    EXACTO que antes de esta migración (ubicación opcional + notas, sin
  //    tarjetas de elegir, sin bloqueos nuevos). Si configuró solo una
  //    (p.ej. La Reyna de los Bolis, que ya traía envío por distancia), esa
  //    única modalidad se autoselecciona en abrirEnvio() y tampoco ve
  //    tarjetas — sigue siendo, en los hechos, el mismo flujo de un único
  //    envío de siempre. Las tarjetas de elegir SOLO aparecen cuando de
  //    verdad hay 2 o más modalidades entre las que escoger. ─────────────
  protected readonly modalidadEntrega = signal<ModalidadEntregaTienda | null>(null);
  protected readonly variantePlataforma = signal<VariantePlataformaTienda | null>(null);

  protected readonly envioPropioDisponible = computed(() => {
    const e = this.detalle()?.empresa;
    return !!e && e.envioPropioActivo && e.envioOrigenLat != null && e.envioOrigenLng != null && !!e.envioPrecioKm;
  });
  protected readonly recoleccionDisponible = computed(() => !!this.detalle()?.empresa.recoleccionActiva);
  protected readonly plataformaDisponible = computed(() => {
    const e = this.detalle()?.empresa;
    return !!e && e.envioPlataformaActivo && (e.envioPlataformaNegocioSolicita || e.envioPlataformaClienteSolicita);
  });

  protected readonly modalidadesDisponibles = computed<ModalidadEntregaTienda[]>(() => {
    const lista: ModalidadEntregaTienda[] = [];
    if (this.envioPropioDisponible()) lista.push('envio_propio');
    if (this.recoleccionDisponible()) lista.push('recoleccion');
    if (this.plataformaDisponible()) lista.push('plataforma');
    return lista;
  });

  /** Aviso corto ANTES del checkout de qué modalidades hay (el cliente no
   *  debe descubrirlo hasta el final) — null = tienda en modo visual o sin
   *  ninguna modalidad nueva configurada (nada que avisar aparte). */
  protected readonly resumenModalidades = computed(() => {
    if (this.modoVisual()) return null;
    const disponibles = this.modalidadesDisponibles();
    if (disponibles.length === 0) return null;
    const etiquetas: Record<ModalidadEntregaTienda, string> = {
      envio_propio: '🛵 Envíos disponibles',
      recoleccion: '🏪 Recolección disponible',
      plataforma: '🚗 Envío por plataforma',
    };
    return disponibles.map((m) => etiquetas[m]).join(' · ');
  });

  /** Mínimo de SUBTOTAL (antes del envío) para poder elegir "Envío del
   *  negocio" — distinto del pedidoMinimo general, que aplica siempre. */
  protected readonly envioPropioPedidoMinimo = computed(() => this.detalle()?.empresa.envioPropioPedidoMinimo ?? null);
  protected readonly envioPropioFaltaMinimo = computed(() => {
    const minimo = this.envioPropioPedidoMinimo();
    if (!minimo) return 0;
    const falta = minimo - this.totalCarrito();
    return falta > 0 ? falta : 0;
  });

  /** Reutiliza envioInfo().fueraDeZona (migración 33) tal cual — solo
   *  cambia CÓMO se interpreta: ver puedeAvanzarEntrega() abajo. */
  protected readonly envioPropioFueraDeZona = computed(() => this.envioInfo()?.fueraDeZona ?? false);

  /** Costo que de verdad se suma al total — SOLO con "Envío del negocio"
   *  elegido; recolección y plataforma nunca cobran envío aquí (el costo
   *  del repartidor de plataforma se cotiza aparte, fuera del sistema). */
  protected readonly costoEntrega = computed(() =>
    this.modalidadEntrega() === 'envio_propio' ? (this.envioInfo()?.costo ?? 0) : 0,
  );
  protected readonly totalConEntrega = computed(() => this.totalCarrito() + this.costoEntrega());

  protected elegirModalidadEntrega(modalidad: ModalidadEntregaTienda): void {
    this.modalidadEntrega.set(modalidad);
    if (modalidad !== 'plataforma') {
      this.variantePlataforma.set(null);
      return;
    }
    // Si la empresa solo activó una de las 2 variantes, se autoselecciona
    // — el cliente no ve una elección de un solo botón.
    const e = this.detalle()?.empresa;
    if (e?.envioPlataformaNegocioSolicita && !e.envioPlataformaClienteSolicita) {
      this.variantePlataforma.set('negocio');
    } else if (!e?.envioPlataformaNegocioSolicita && e?.envioPlataformaClienteSolicita) {
      this.variantePlataforma.set('cliente');
    } else {
      this.variantePlataforma.set(null);
    }
  }

  protected elegirVariantePlataforma(variante: VariantePlataformaTienda): void {
    this.variantePlataforma.set(variante);
  }

  /** Compuerta del botón "Siguiente" del paso Entrega. */
  protected readonly puedeAvanzarEntrega = computed(() => {
    const modalidad = this.modalidadEntrega();
    if (this.modalidadesDisponibles().length === 0) return true; // flujo de siempre, nunca bloquea
    if (!modalidad) return false; // debe elegir una tarjeta
    if (modalidad === 'plataforma') {
      const e = this.detalle()?.empresa;
      const dosVariantes = !!e?.envioPlataformaNegocioSolicita && !!e?.envioPlataformaClienteSolicita;
      return !dosVariantes || !!this.variantePlataforma();
    }
    if (modalidad === 'envio_propio') {
      if (this.envioPropioFaltaMinimo() > 0) return false;
      // "Fuera de zona" solo bloquea si hay a dónde cambiarse — si esta es
      // la ÚNICA modalidad, se mantiene el aviso de siempre (no bloquea).
      if (this.envioPropioFueraDeZona() && this.modalidadesDisponibles().length > 1) return false;
    }
    return true;
  });

  /** Clave de la tienda actual (ver ngOnInit) — se reutiliza al mandar el
   *  pedido, para crearPedidoPendiente() (ver enviarPorWhatsapp()). */
  private clave = '';

  ngOnInit(): void {
    this.clave = this.route.snapshot.paramMap.get('clave') ?? '';
    try {
      this.ultimoPedidoDisponible.set(!!localStorage.getItem(this.claveUltimoPedido()));
    } catch {
      this.ultimoPedidoDisponible.set(false);
    }
    this.tiendaService
      .tiendaDetalle(this.clave)
      .then((detalle) => {
        if (!detalle) {
          this.error.set('Esta tienda no existe o todavía no está disponible.');
          return;
        }
        this.detalle.set(detalle);
        this.actualizarMetadatos(detalle.empresa);
      })
      .catch(() => this.error.set('No se pudo cargar el catálogo. Intenta de nuevo en un momento.'))
      .finally(() => this.cargando.set(false));
  }

  ngOnDestroy(): void {
    // No deja el título/metadatos de ESTA tienda puestos si el navegador
    // sigue vivo (SPA) y el cliente navega a otra pantalla.
    this.titleService.setTitle('Saurix');
    for (const propiedad of ['og:title', 'og:description', 'og:type', 'og:url', 'og:image']) {
      this.metaService.removeTag(`property="${propiedad}"`);
    }
    for (const nombre of ['description', 'twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) {
      this.metaService.removeTag(`name="${nombre}"`);
    }
    this.linkManifest?.remove();
    this.linkIcono?.remove();
    if (this.urlManifestAnterior) URL.revokeObjectURL(this.urlManifestAnterior);
  }

  subtotalLinea(linea: LineaCarritoTienda): number {
    const extra = linea.opcionesElegidas.reduce((acc, o) => acc + o.precioAdicional, 0);
    return (linea.precioBase + extra) * linea.cantidad;
  }

  private leerVistaGuardada(): boolean {
    try {
      return localStorage.getItem('tienda-vista') === 'lista';
    } catch {
      return false;
    }
  }

  cambiarVista(lista: boolean): void {
    this.vistaLista.set(lista);
    try {
      localStorage.setItem('tienda-vista', lista ? 'lista' : 'grid');
    } catch {
      // localStorage puede no estar disponible (modo privado, etc.) — no es crítico.
    }
  }

  private leerAgrupacionGuardada(): boolean {
    try {
      return localStorage.getItem('tienda-agrupacion') === 'precio';
    } catch {
      return false;
    }
  }

  cambiarAgrupacion(porPrecio: boolean): void {
    this.agruparPorPrecio.set(porPrecio);
    try {
      localStorage.setItem('tienda-agrupacion', porPrecio ? 'precio' : 'categoria');
    } catch {
      // localStorage puede no estar disponible (modo privado, etc.) — no es crítico.
    }
  }

  // ── Agregar al carrito ────────────────────────────────────────────
  /** Productos sin ningún grupo de opciones se agregan directo, sin abrir modal. */
  agregar(producto: ProductoTienda): void {
    if (this.modoVisual() || !producto.disponible) return;
    if (producto.opciones.length > 0) {
      this.abrirModal(producto);
      return;
    }
    this.agregarLineaAlCarrito(producto, [], 1);
  }

  abrirModal(producto: ProductoTienda): void {
    // Defensa extra — también se llama directo desde el carrusel de
    // Destacados (ver el .html), que no pasa por agregar().
    if (this.modoVisual()) return;
    this.productoEnModal.set(producto);
    this.cantidadModal.set(1);
    // Grupos de selección única con exactamente 1 valor: se pre-marca el
    // primero, para no obligar un clic extra cuando de todas formas hay
    // que elegir algo — el cliente puede cambiarlo.
    const inicial: SeleccionOpciones = {};
    for (const grupo of producto.opciones) {
      if (grupo.tipoSeleccion === 'unica' && grupo.valores.length > 0) {
        inicial[grupo.id] = [grupo.valores[0].id];
      } else {
        inicial[grupo.id] = [];
      }
    }
    this.seleccionModal.set(inicial);
  }

  cerrarModal(): void {
    this.productoEnModal.set(null);
  }

  disminuirCantidadModal(): void {
    this.cantidadModal.update((n) => Math.max(1, n - 1));
  }

  aumentarCantidadModal(): void {
    this.cantidadModal.update((n) => n + 1);
  }

  elegirUnica(grupoId: number, valorId: number): void {
    this.seleccionModal.update((sel) => ({ ...sel, [grupoId]: [valorId] }));
  }

  toggleMultiple(grupoId: number, valorId: number, grupo: ProductoTienda['opciones'][number]): void {
    this.seleccionModal.update((sel) => {
      const actual = sel[grupoId] ?? [];
      if (actual.includes(valorId)) {
        return { ...sel, [grupoId]: actual.filter((id) => id !== valorId) };
      }
      if (actual.length >= grupo.maximo) return sel; // ya está en el tope, ignora el clic
      return { ...sel, [grupoId]: [...actual, valorId] };
    });
  }

  /** false si falta elegir algo obligatorio o no se cumple el mínimo de un grupo múltiple. */
  protected readonly modalValido = computed(() => {
    const producto = this.productoEnModal();
    if (!producto) return false;
    const seleccion = this.seleccionModal();
    return producto.opciones.every((grupo) => {
      const elegidos = seleccion[grupo.id] ?? [];
      if (grupo.tipoSeleccion === 'unica') return !grupo.requerido || elegidos.length === 1;
      if (!grupo.requerido && elegidos.length === 0) return true;
      return elegidos.length >= grupo.minimo && elegidos.length <= grupo.maximo;
    });
  });

  confirmarModal(): void {
    const producto = this.productoEnModal();
    if (!producto || !this.modalValido()) return;
    const seleccion = this.seleccionModal();
    const opcionesElegidas = producto.opciones.flatMap((grupo) =>
      (seleccion[grupo.id] ?? [])
        .map((valorId) => grupo.valores.find((v) => v.id === valorId))
        .filter((v): v is NonNullable<typeof v> => !!v)
        .map((v) => ({ grupoNombre: grupo.nombre, valorNombre: v.nombre, precioAdicional: v.precioAdicional })),
    );
    this.agregarLineaAlCarrito(producto, opcionesElegidas, this.cantidadModal());
    this.cerrarModal();
  }

  /** Determinista a partir de producto+opciones (en vez de timestamp/random):
   *  así dos "Agregar" del mismo producto con las MISMAS opciones elegidas
   *  caen en la misma línea del carrito — ver agregarLineaAlCarrito(). Las
   *  opciones se ordenan antes de armar la clave para que el orden en que
   *  se eligieron no importe (fresa+chocolate === chocolate+fresa). */
  private claveLineaDe(productoId: number, opcionesElegidas: LineaCarritoTienda['opcionesElegidas']): string {
    const opciones = opcionesElegidas
      .map((o) => `${o.grupoNombre}:${o.valorNombre}`)
      .sort()
      .join('|');
    return `${productoId}::${opciones}`;
  }

  private agregarLineaAlCarrito(
    producto: ProductoTienda,
    opcionesElegidas: LineaCarritoTienda['opcionesElegidas'],
    cantidad: number,
  ): void {
    const claveLinea = this.claveLineaDe(producto.id, opcionesElegidas);
    this.carrito.update((lineas) => {
      // Mismo producto + mismas opciones ya en el carrito → se acumula la
      // cantidad en esa línea en vez de crear una línea nueva idéntica.
      const yaExiste = lineas.some((l) => l.claveLinea === claveLinea);
      if (yaExiste) {
        return lineas.map((l) => (l.claveLinea === claveLinea ? { ...l, cantidad: l.cantidad + cantidad } : l));
      }
      return [
        ...lineas,
        {
          claveLinea,
          productoId: producto.id,
          nombreProducto: producto.nombre,
          precioBase: producto.precio,
          fotoProducto: producto.foto,
          opcionesElegidas,
          cantidad,
        },
      ];
    });
    // A propósito NO se abre el panel aquí (antes sí, y tapaba el catálogo
    // en celular en cada "Agregar") — el cliente sigue viendo la cuadrícula
    // y usa la barra inferior fija (.tienda-barra-inferior, siempre visible
    // mientras haya algo en el carrito) para abrir el pedido cuando quiera.
    // En vez de eso, el botón del carrito del banner "pulsa" un instante
    // para confirmar que sí se agregó — ver dispararPulsoCarrito().
    this.dispararPulsoCarrito();
  }

  cambiarCantidadLinea(claveLinea: string, delta: number): void {
    this.carrito.update((lineas) =>
      lineas
        .map((l) => (l.claveLinea === claveLinea ? { ...l, cantidad: l.cantidad + delta } : l))
        .filter((l) => l.cantidad > 0),
    );
  }

  quitarLinea(claveLinea: string): void {
    this.carrito.update((lineas) => lineas.filter((l) => l.claveLinea !== claveLinea));
  }

  /** Botón 🗑 junto a "Agregar" en el catálogo (no en el carrito): quita de
   *  un jalón TODAS las líneas de este producto, sin importar sus variantes
   *  elegidas — para corregir rápido sin tener que abrir el carrito. */
  quitarProductoDelCarrito(productoId: number): void {
    this.carrito.update((lineas) => lineas.filter((l) => l.productoId !== productoId));
  }

  /** +/- del catálogo (stepper): solo aplica a productos SIN variantes
   *  (opciones.length === 0), donde hay como máximo una línea de carrito
   *  por producto y su clave es siempre la misma (sin opciones elegidas).
   *  Para productos CON variantes no hay un +/- simple porque un mismo
   *  producto puede tener varias líneas (una por combinación de opciones
   *  elegida) y no hay forma de saber cuál debe bajar — esos productos
   *  siguen usando "Elegir" (abre el modal) + el botón 🗑 Quitar. */
  cambiarCantidadProducto(producto: ProductoTienda, delta: number): void {
    if (delta > 0) {
      this.agregarLineaAlCarrito(producto, [], 1);
      return;
    }
    const claveLinea = this.claveLineaDe(producto.id, []);
    this.cambiarCantidadLinea(claveLinea, delta);
  }

  /** Centavos de un monto, como texto de 2 dígitos (p.ej. 11459.4 → "40")
   *  — para el precio del stepper del catálogo, que muestra los centavos
   *  chicos en superíndice (mismo estilo que un precio de tienda en
   *  línea). Con Math.round() para no arrastrar errores de punto flotante
   *  (11459.4 * 100 puede dar 1145939.9999...). */
  protected centavos(monto: number): string {
    return (Math.round(monto * 100) % 100).toString().padStart(2, '0');
  }

  /** Botón "+" sobre la foto del producto (catálogo) — abre la imagen en
   *  grande encima de todo (ver imagenAmpliada()/.tienda-imagen-ampliada en
   *  el HTML/SCSS). Solo la vista, no cambia nada del carrito. */
  ampliarImagen(url: string): void {
    this.imagenAmpliada.set(url);
  }

  cerrarImagenAmpliada(): void {
    this.imagenAmpliada.set(null);
  }

  /** Wrapper del template: ver calcularIconoMetodoPago() arriba del archivo. */
  protected iconoMetodoPago(metodo: string): string {
    return calcularIconoMetodoPago(metodo);
  }

  // ── Enviar pedido (WhatsApp/correo) — NO se guarda nada en la base, ver
  //    el comentario grande en 27_tienda_publica.sql. La empresa recibe el
  //    mensaje, valida con el cliente y ella captura la venta a mano en
  //    Ventas → Cobro (usando el campo "Canal" para marcarla). ────────────
  abrirEnvio(): void {
    if (this.modoVisual() || this.carrito().length === 0) return;
    // Limpio para no arrastrar nota/ubicación de un pedido anterior ya
    // enviado en esta misma visita.
    this.formCliente.patchValue({ notas: '' });
    this.ubicacion.set(null);
    this.ubicacionError.set(null);
    this.pasoModal.set('datos');
    // Si solo hay UNA modalidad configurada (o ninguna), se autoselecciona
    // — el cliente nunca ve una pantalla de "elegir" con un solo botón (o
    // ninguno). Con 2+ disponibles, arranca sin elegir y ve las tarjetas.
    const disponibles = this.modalidadesDisponibles();
    if (disponibles.length === 1) {
      this.elegirModalidadEntrega(disponibles[0]);
    } else {
      this.modalidadEntrega.set(null);
      this.variantePlataforma.set(null);
    }
    this.modalEnviarAbierto.set(true);
  }

  // ── Navegación entre los 3 pasos visuales del modal de enviar ────────
  protected siguientePasoDatos(): void {
    // Solo nombre/teléfono son obligatorios en este paso — si faltan, se
    // marcan como tocados para que se vea el error en rojo, igual que al
    // intentar enviar directo (ver enviarPorWhatsapp()).
    const nombre = this.formCliente.controls.nombre;
    const telefono = this.formCliente.controls.telefono;
    if (nombre.invalid || telefono.invalid) {
      nombre.markAsTouched();
      telefono.markAsTouched();
      return;
    }
    this.pasoModal.set('entrega');
  }

  protected siguientePasoEntrega(): void {
    if (!this.puedeAvanzarEntrega()) return;
    this.pasoModal.set('revisar');
  }

  protected pasoAnterior(): void {
    this.pasoModal.set(this.pasoModal() === 'revisar' ? 'entrega' : 'datos');
  }

  // ── Navegación de la barra inferior (Inicio | Productos | Carrito) —
  //    scroll normal del navegador, no cambia de ruta ni de estado. ─────
  protected irAInicio(): void {
    document.querySelector('.tienda-banner')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  protected irAProductos(): void {
    document
      .querySelector('.tienda-busqueda, .tienda-categoria')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** La barra inferior fija (Inicio | Productos | Carrito) se esconde
   *  mientras cualquier panel/modal ya ocupa la pantalla — para no
   *  "tapar contenido" (ni duplicar el botón de carrito) encima de otro
   *  overlay, tal como pidió el cliente para la barra anterior. */
  protected readonly ocultarNavInferior = computed(
    () =>
      this.carritoAbierto() ||
      this.modalEnviarAbierto() ||
      this.productoEnModal() !== null ||
      this.modalCompartirAbierto() ||
      this.imagenAmpliada() !== null,
  );

  // ── Ubicación por GPS ──────────────────────────────────────────────
  compartirUbicacion(): void {
    if (!('geolocation' in navigator)) {
      this.ubicacionError.set('Tu navegador no permite compartir ubicación.');
      return;
    }
    this.obteniendoUbicacion.set(true);
    this.ubicacionError.set(null);
    navigator.geolocation.getCurrentPosition(
      (posicion) => {
        this.ubicacion.set({ lat: posicion.coords.latitude, lng: posicion.coords.longitude });
        this.obteniendoUbicacion.set(false);
      },
      (error) => {
        this.obteniendoUbicacion.set(false);
        this.ubicacionError.set(
          error.code === error.PERMISSION_DENIED
            ? 'No autorizaste compartir tu ubicación — puedes seguir sin ella.'
            : 'No se pudo obtener tu ubicación. Intenta de nuevo.',
        );
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  quitarUbicacion(): void {
    this.ubicacion.set(null);
  }

  // ── Formato del mensaje de WhatsApp — mismo contenido de siempre
  //    (productos, cantidades, opciones, subtotales, envío, ubicación,
  //    notas), nomás reacomodado en bloques con mayúsculas/títulos para que
  //    se lea más como un pedido formal y menos como una lista suelta. ───
  /** Arma el mensaje de WhatsApp — el FORMATO cambia segun la modalidad de
   *  entrega elegida (ver 43_tienda_modalidades_entrega.sql), pero toda la
   *  informacion que ya se mandaba (productos/opciones/subtotales/total/
   *  ubicacion/notas) se conserva en los 4 formatos. Si la tienda no tiene
   *  ninguna modalidad nueva configurada (modalidadEntrega() queda null -
   *  la inmensa mayoria de las tiendas hoy), se manda EXACTO el mismo
   *  mensaje de siempre, sin ningun cambio. */
  private construirMensaje(nombreCliente: string, telefonoCliente: string, notas: string): string {
    const empresa = this.detalle()?.empresa;
    const nombreEmpresa = (empresa?.nombre ?? '').toUpperCase();
    const ubicacion = this.ubicacion();
    const modalidad = this.modalidadEntrega();
    const variante = this.variantePlataforma();

    const lineas = this.carrito()
      .map((linea) => {
        const partes = [`${linea.cantidad} \u00d7 ${linea.nombreProducto} \u2014 $${this.subtotalLinea(linea).toFixed(2)}`];
        for (const o of linea.opcionesElegidas) {
          const extra = o.precioAdicional > 0 ? ` (+$${o.precioAdicional.toFixed(2)})` : '';
          partes.push(`   \u2022 ${o.grupoNombre}: ${o.valorNombre}${extra}`);
        }
        return partes.join('\n');
      })
      .join('\n');
    const ubicacionTexto = ubicacion
      ? `https://www.google.com/maps?q=${ubicacion.lat},${ubicacion.lng}`
      : 'No se comparti\u00f3 ubicaci\u00f3n.';

    if (modalidad === 'recoleccion') {
      return [
        `\ud83c\udfea PASAR\u00c1 A RECOGER \u2014 ${nombreEmpresa}`,
        '',
        `Cliente: ${nombreCliente}`,
        `Tel\u00e9fono: ${telefonoCliente}`,
        '',
        'PEDIDO',
        lineas,
        '',
        `TOTAL: $${this.totalCarrito().toFixed(2)}`,
        '',
        'Sucursal:',
        empresa?.nombre ?? '',
        'Direcci\u00f3n:',
        empresa?.direccionPublica?.trim() || 'No especificada',
        '',
        'Pedido generado desde la tienda online \u2014 sujeto a confirmaci\u00f3n de disponibilidad por parte del negocio.',
      ].join('\n');
    }

    if (modalidad === 'plataforma' && variante === 'cliente') {
      return [
        `\ud83d\ude97 RECOGE REPARTIDOR DEL CLIENTE \u2014 ${nombreEmpresa}`,
        '',
        `Cliente: ${nombreCliente}`,
        `Tel\u00e9fono: ${telefonoCliente}`,
        '',
        'PEDIDO',
        lineas,
        '',
        `TOTAL PRODUCTOS: $${this.totalCarrito().toFixed(2)}`,
        '',
        'Recoger en:',
        empresa?.nombre ?? '',
        empresa?.direccionPublica?.trim() || 'No especificada',
        '',
        'El cliente solicitar\u00e1 y pagar\u00e1 su propio servicio de transporte.',
      ].join('\n');
    }

    if (modalidad === 'plataforma' && variante === 'negocio') {
      return [
        '\ud83d\ude97 ENV\u00cdO POR PLATAFORMA \u2014 COTIZAR',
        '',
        `Cliente: ${nombreCliente}`,
        `Tel\u00e9fono: ${telefonoCliente}`,
        '',
        'PEDIDO',
        lineas,
        '',
        `TOTAL PRODUCTOS: $${this.totalCarrito().toFixed(2)}`,
        '',
        'Ubicaci\u00f3n del cliente:',
        ubicacionTexto,
        '',
        'Referencias:',
        notas.trim() || 'Sin referencias.',
        '',
        '\u26a0\ufe0f Costo del repartidor pendiente de cotizar y confirmar con el cliente.',
      ].join('\n');
    }

    if (modalidad === 'envio_propio') {
      const envio = this.envioInfo();
      return [
        `\ud83d\udef5 ENV\u00cdO DEL NEGOCIO \u2014 ${nombreEmpresa}`,
        '',
        `Cliente: ${nombreCliente}`,
        `Tel\u00e9fono: ${telefonoCliente}`,
        '',
        'PEDIDO',
        lineas,
        '',
        `Subtotal: $${this.totalCarrito().toFixed(2)}`,
        `Env\u00edo: $${(envio?.costo ?? 0).toFixed(2)}${envio?.fueraDeZona ? ' \u26a0\ufe0f fuera del radio de entrega habitual' : ''}`,
        `TOTAL: $${this.totalConEntrega().toFixed(2)}`,
        '',
        'Ubicaci\u00f3n:',
        ubicacionTexto,
        '',
        'Referencias:',
        notas.trim() || 'Sin referencias.',
        '',
        'Pedido generado desde la tienda online \u2014 sujeto a confirmaci\u00f3n de disponibilidad por parte del negocio.',
      ].join('\n');
    }

    const envio = this.envioInfo();
    const totalesPartes = [
      envio
        ? `Env\u00edo estimado (${envio.km.toFixed(1)} km): $${envio.costo.toFixed(2)}${envio.fueraDeZona ? ' \u26a0\ufe0f fuera del radio de entrega habitual' : ''}`
        : '',
      `TOTAL: $${(envio ? this.totalConEnvio() : this.totalCarrito()).toFixed(2)}`,
    ].filter(Boolean);

    return [
      `NUEVO PEDIDO \u2014 ${nombreEmpresa}`,
      '',
      `Cliente: ${nombreCliente}`,
      `Tel\u00e9fono: ${telefonoCliente}`,
      '',
      'PEDIDO',
      lineas,
      '',
      ...totalesPartes,
      '',
      'Ubicaci\u00f3n:',
      ubicacionTexto,
      '',
      'Notas:',
      notas.trim() || 'Sin notas.',
      '',
      'Pedido generado desde la tienda online \u2014 sujeto a confirmaci\u00f3n de disponibilidad por parte del negocio.',
    ].join('\n');
  }

  enviarPorWhatsapp(): void {
    if (this.formCliente.invalid) {
      this.formCliente.markAllAsTouched();
      return;
    }
    // Defensa extra — el botón ya viene deshabilitado en el template si no
    // se alcanza el mínimo (ver cumpleMinimo()).
    if (!this.cumpleMinimo()) return;
    const empresa = this.detalle()?.empresa;
    const telefono = (empresa?.telefono ?? '').replace(/\D/g, '');
    if (!telefono) return;
    const v = this.formCliente.getRawValue();
    const mensaje = this.construirMensaje(v.nombre.trim(), v.telefono.trim(), v.notas);
    // window.open() va PRIMERO y sin await — tiene que quedar dentro del
    // mismo gesto de clic del usuario o el navegador bloquea el popup.
    window.open(`https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`, '_blank');

    // Registro ligero "en segundo plano" para que el pedido también
    // aparezca en Ventas → Pedidos web (ver tienda-publica.service.ts) —
    // nunca bloquea ni retrasa el WhatsApp de arriba, que es el canal real:
    // si esto falla, el cliente ya recibió igual su WhatsApp.
    const ubicacion = this.ubicacion();
    this.tiendaService
      .crearPedidoPendiente(this.clave, {
        nombre: v.nombre.trim(),
        telefono: v.telefono.trim(),
        notas: v.notas.trim(),
        lat: ubicacion?.lat ?? null,
        lng: ubicacion?.lng ?? null,
        items: this.carrito(),
        total: this.totalCarrito(),
      })
      .catch(() => {
        /* silencioso a propósito — ver comentario arriba */
      });

    // guardarUltimoPedido() primero (guarda ESTE carrito para "volver a
    // pedir lo mismo") y RECIÉN DESPUÉS se vacía — si no, el cliente se
    // queda con el pedido que ya mandó todavía puesto en el carrito y no
    // puede arrancar uno nuevo sin quitar manualmente cada línea. Las
    // notas son del pedido que se fue, así que también se limpian; nombre
    // y teléfono NO, para no pedírselos de nuevo si hace otro pedido
    // seguido en la misma tienda.
    this.guardarUltimoPedido();
    this.carrito.set([]);
    this.formCliente.patchValue({ notas: '' });
    this.modalEnviarAbierto.set(false);
    // También se cierra el carrito (no solo el modal de enviar) — así el
    // cliente regresa derecho al catálogo de la tienda para agregar otro
    // producto, en vez de quedarse viendo el panel del carrito ya vacío.
    this.carritoAbierto.set(false);
    this.mostrarConfeti();
    this.mostrarExitoEnvio(
      `¡Tu pedido está listo! Te enviamos a WhatsApp para confirmar disponibilidad con ${empresa?.nombre ?? 'el negocio'}.`,
    );
  }

  // ── "Volver a pedir lo mismo" ─────────────────────────────────────
  private claveUltimoPedido(): string {
    return `tienda-ultimo-pedido-${this.clave}`;
  }

  private guardarUltimoPedido(): void {
    try {
      localStorage.setItem(this.claveUltimoPedido(), JSON.stringify(this.carrito()));
      this.ultimoPedidoDisponible.set(true);
    } catch {
      // localStorage puede no estar disponible (modo privado, etc.) — no es crítico.
    }
  }

  /** Carga el último pedido guardado DE VUELTA al carrito actual (lo
   *  reemplaza, no lo suma) — el cliente lo puede seguir editando antes de
   *  mandarlo de nuevo, igual que cualquier otro carrito armado a mano. */
  volverAPedir(): void {
    try {
      const guardado = localStorage.getItem(this.claveUltimoPedido());
      if (!guardado) return;
      this.carrito.set(JSON.parse(guardado) as LineaCarritoTienda[]);
    } catch {
      // dato corrupto o de una versión vieja del carrito — se ignora.
    }
  }

  // ── Compartir (copiar link / código QR) ───────────────────────────
  protected linkTienda(): string {
    return window.location.href;
  }

  protected qrTienda(): string {
    return `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(this.linkTienda())}`;
  }

  abrirCompartir(): void {
    this.linkCopiado.set(false);
    this.modalCompartirAbierto.set(true);
  }

  async copiarLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.linkTienda());
      this.linkCopiado.set(true);
      setTimeout(() => this.linkCopiado.set(false), 2000);
    } catch {
      // Sin permiso/soporte de portapapeles — el link ya está visible en el
      // modal para copiarlo a mano.
    }
  }

  /** Descarga el PNG del QR como archivo en vez de solo abrirlo — si el
   *  navegador bloquea el fetch (CORS raro, sin red, etc.) cae a abrirlo en
   *  una pestaña nueva, donde igual se puede guardar con clic derecho. */
  async descargarQr(): Promise<void> {
    try {
      const respuesta = await fetch(this.qrTienda());
      const blob = await respuesta.blob();
      const url = URL.createObjectURL(blob);
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = `qr-tienda-${this.clave}.png`;
      enlace.click();
      URL.revokeObjectURL(url);
    } catch {
      window.open(this.qrTienda(), '_blank');
    }
  }

  // ── Metadatos (título/Open Graph) y "Agregar a pantalla de inicio" ──
  /** Pone el título de la pestaña y las etiquetas Open Graph/Twitter con
   *  los datos de ESTA empresa — ayuda cuando el link se abre directo o en
   *  apps que sí renderizan la página antes de armar la vista previa.
   *  OJO: WhatsApp/Facebook arman su tarjeta leyendo el HTML tal cual lo
   *  sirve el hosting, SIN ejecutar JavaScript — como este sitio es una SPA
   *  de Angular en GitHub Pages (sin server-side rendering), esas apps en
   *  particular van a seguir mostrando el título/ícono genérico de Saurix
   *  en la vista previa del link, aunque esto sí corrija el título de la
   *  pestaña y sirva si algún día se agrega prerenderizado por ruta. */
  private actualizarMetadatos(empresa: EmpresaTienda): void {
    const titulo = `${empresa.nombre} · Tienda en línea`;
    const descripcion = empresa.descripcion || `Arma tu pedido en ${empresa.nombre} y mándalo por WhatsApp.`;
    this.titleService.setTitle(titulo);
    this.metaService.updateTag({ name: 'description', content: descripcion });
    this.metaService.updateTag({ property: 'og:title', content: titulo });
    this.metaService.updateTag({ property: 'og:description', content: descripcion });
    this.metaService.updateTag({ property: 'og:type', content: 'website' });
    this.metaService.updateTag({ property: 'og:url', content: window.location.href });
    this.metaService.updateTag({ name: 'twitter:title', content: titulo });
    this.metaService.updateTag({ name: 'twitter:description', content: descripcion });
    if (empresa.logo) {
      this.metaService.updateTag({ property: 'og:image', content: empresa.logo });
      this.metaService.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
      this.metaService.updateTag({ name: 'twitter:image', content: empresa.logo });
    }
    this.actualizarAccesoDirecto(empresa);
  }

  /** Manifest + ícono dinámicos (por tienda) para que "Agregar a pantalla
   *  de inicio" use el nombre/logo del negocio en vez del genérico de
   *  Saurix — sin service worker (eso es harina de otro costal, afecta a
   *  toda la app): nomás el ícono/nombre al agregarlo a mano desde el menú
   *  del navegador, no el banner automático de "Instalar" de Android. */
  private actualizarAccesoDirecto(empresa: EmpresaTienda): void {
    try {
      const manifest = {
        name: empresa.nombre,
        short_name: empresa.nombre.slice(0, 30),
        start_url: window.location.pathname,
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#2563eb',
        icons: empresa.logo
          ? [
              { src: empresa.logo, sizes: '192x192', type: 'image/jpeg' },
              { src: empresa.logo, sizes: '512x512', type: 'image/jpeg' },
            ]
          : [],
      };
      if (this.urlManifestAnterior) URL.revokeObjectURL(this.urlManifestAnterior);
      const url = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: 'application/json' }));
      this.urlManifestAnterior = url;

      if (!this.linkManifest) {
        this.linkManifest = document.createElement('link');
        this.linkManifest.rel = 'manifest';
        document.head.appendChild(this.linkManifest);
      }
      this.linkManifest.href = url;

      if (empresa.logo) {
        if (!this.linkIcono) {
          this.linkIcono = document.createElement('link');
          this.linkIcono.rel = 'apple-touch-icon';
          document.head.appendChild(this.linkIcono);
        }
        this.linkIcono.href = empresa.logo;
      }
    } catch {
      // Navegador sin soporte de Blob/manifest dinámico — el catálogo sigue
      // funcionando igual, nomás sin el ícono personalizado al agregarlo.
    }
  }
}

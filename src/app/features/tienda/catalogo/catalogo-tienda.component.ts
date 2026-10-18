import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Meta, Title } from '@angular/platform-browser';
import { TiendaPublicaService } from '../tienda-publica.service';
import { EmpresaTienda, LineaCarritoTienda, ProductoTienda, TiendaDetalle } from '../tienda.model';

/** Selección en curso dentro del modal de un producto: por cada grupo de
 *  opciones, los id de valor marcados (radio = 1 elemento, checkbox =
 *  varios). Vive solo mientras el modal está abierto. */
type SeleccionOpciones = Record<number, number[]>;

/** Nombres largos de los 7 días, en el mismo orden que Date.getDay() (0 =
 *  domingo) — para armar el texto "Cerrado · abre el martes a las…". */
const NOMBRES_DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

@Component({
  selector: 'app-catalogo-tienda',
  standalone: true,
  imports: [RouterLink, ReactiveFormsModule],
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
  protected readonly modalEnviarAbierto = signal(false);
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

  protected readonly productosFiltrados = computed<ProductoTienda[]>(() => {
    const texto = this.busqueda().trim().toLowerCase();
    const productos = this.detalle()?.productos ?? [];
    if (!texto) return productos;
    return productos.filter(
      (p) => p.nombre.toLowerCase().includes(texto) || (p.descripcion ?? '').toLowerCase().includes(texto),
    );
  });

  /** Catálogo agrupado por categoría o por precio (en vez de una sola rejilla
   *  plana) según agruparPorPrecio() — ver cambiarAgrupacion(). Por categoría,
   *  el RPC ya devuelve los productos ordenados por categoriaNombre y luego
   *  por nombre (ver migración 29), así que basta con juntar consecutivos en
   *  el mismo grupo; por precio se ordenan aquí mismo de menor a mayor. */
  protected readonly gruposProductos = computed<{ clave: string; titulo: string; productos: ProductoTienda[] }[]>(() => {
    const productos = this.productosFiltrados();
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
    if (!producto.disponible) return;
    if (producto.opciones.length > 0) {
      this.abrirModal(producto);
      return;
    }
    this.agregarLineaAlCarrito(producto, [], 1);
  }

  abrirModal(producto: ProductoTienda): void {
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
          opcionesElegidas,
          cantidad,
        },
      ];
    });
    // A propósito NO se abre el panel aquí (antes sí, y tapaba el catálogo
    // en celular en cada "Agregar") — el cliente sigue viendo la cuadrícula
    // y usa la barra inferior fija (.tienda-barra-inferior, siempre visible
    // mientras haya algo en el carrito) para abrir el pedido cuando quiera.
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

  // ── Enviar pedido (WhatsApp/correo) — NO se guarda nada en la base, ver
  //    el comentario grande en 27_tienda_publica.sql. La empresa recibe el
  //    mensaje, valida con el cliente y ella captura la venta a mano en
  //    Ventas → Cobro (usando el campo "Canal" para marcarla). ────────────
  abrirEnvio(): void {
    if (this.carrito().length === 0) return;
    // Limpio para no arrastrar nota/ubicación de un pedido anterior ya
    // enviado en esta misma visita.
    this.formCliente.patchValue({ notas: '' });
    this.ubicacion.set(null);
    this.ubicacionError.set(null);
    this.modalEnviarAbierto.set(true);
  }

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

  private construirMensaje(nombreCliente: string, telefonoCliente: string, notas: string): string {
    const empresa = this.detalle()?.empresa;
    const lineas = this.carrito()
      .map((linea, i) => {
        const partes = [`${i + 1}) ${linea.nombreProducto} x${linea.cantidad}`];
        for (const o of linea.opcionesElegidas) {
          const extra = o.precioAdicional > 0 ? ` (+$${o.precioAdicional.toFixed(2)})` : '';
          partes.push(`   - ${o.grupoNombre}: ${o.valorNombre}${extra}`);
        }
        partes.push(`   Subtotal: $${this.subtotalLinea(linea).toFixed(2)}`);
        return partes.join('\n');
      })
      .join('\n\n');

    const ubicacion = this.ubicacion();

    return [
      `Pedido para ${empresa?.nombre ?? ''}`,
      '',
      lineas,
      '',
      `Total: $${this.totalCarrito().toFixed(2)}`,
      '',
      `Cliente: ${nombreCliente}`,
      `Teléfono: ${telefonoCliente}`,
      notas.trim() ? `Nota especial: ${notas.trim()}` : '',
      ubicacion ? `Ubicación: https://www.google.com/maps?q=${ubicacion.lat},${ubicacion.lng}` : '',
    ]
      .filter((l) => l !== '' || true)
      .join('\n');
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

    this.guardarUltimoPedido();
    this.modalEnviarAbierto.set(false);
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

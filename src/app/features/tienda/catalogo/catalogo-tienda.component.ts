import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TiendaPublicaService } from '../tienda-publica.service';
import { LineaCarritoTienda, ProductoTienda, TiendaDetalle } from '../tienda.model';

/** Selección en curso dentro del modal de un producto: por cada grupo de
 *  opciones, los id de valor marcados (radio = 1 elemento, checkbox =
 *  varios). Vive solo mientras el modal está abierto. */
type SeleccionOpciones = Record<number, number[]>;

@Component({
  selector: 'app-catalogo-tienda',
  standalone: true,
  imports: [RouterLink, ReactiveFormsModule],
  templateUrl: './catalogo-tienda.component.html',
  styleUrl: './catalogo-tienda.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatalogoTiendaComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly tiendaService = inject(TiendaPublicaService);
  private readonly fb = inject(FormBuilder);

  protected readonly cargando = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly detalle = signal<TiendaDetalle | null>(null);
  protected readonly busqueda = signal('');

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

  protected readonly productosFiltrados = computed<ProductoTienda[]>(() => {
    const texto = this.busqueda().trim().toLowerCase();
    const productos = this.detalle()?.productos ?? [];
    if (!texto) return productos;
    return productos.filter(
      (p) => p.nombre.toLowerCase().includes(texto) || (p.descripcion ?? '').toLowerCase().includes(texto),
    );
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

  ngOnInit(): void {
    const clave = this.route.snapshot.paramMap.get('clave') ?? '';
    this.tiendaService
      .tiendaDetalle(clave)
      .then((detalle) => {
        if (!detalle) {
          this.error.set('Esta tienda no existe o todavía no está disponible.');
          return;
        }
        this.detalle.set(detalle);
      })
      .catch(() => this.error.set('No se pudo cargar el catálogo. Intenta de nuevo en un momento.'))
      .finally(() => this.cargando.set(false));
  }

  subtotalLinea(linea: LineaCarritoTienda): number {
    const extra = linea.opcionesElegidas.reduce((acc, o) => acc + o.precioAdicional, 0);
    return (linea.precioBase + extra) * linea.cantidad;
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
    const empresa = this.detalle()?.empresa;
    const telefono = (empresa?.telefono ?? '').replace(/\D/g, '');
    if (!telefono) return;
    const v = this.formCliente.getRawValue();
    const mensaje = this.construirMensaje(v.nombre.trim(), v.telefono.trim(), v.notas);
    window.open(`https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`, '_blank');
    this.modalEnviarAbierto.set(false);
  }
}

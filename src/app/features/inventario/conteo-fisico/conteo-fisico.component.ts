import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { ToastService } from '../../../shared/services/toast.service';
import { AuthService } from '../../../core/services/auth.service';
import { Producto } from '../productos/producto.model';
import { Bodega } from '../bodegas/bodega.model';
import { ExistenciaBodega } from '../movimientos-bodega/existencia-bodega.model';
import { MovimientoInventarioService } from '../movimientos-bodega/movimiento-inventario.service';
import { Usuario, nombreCompletoUsuario } from '../../seguridad/usuarios/usuario.model';
import { ConteoFisico, ConteoFisicoDetalle } from './conteo-fisico.model';
import { EscaneoCodigoComponent } from '../../../shared/components/escaneo-codigo/escaneo-codigo.component';
import { exportarCsv } from '../../../shared/utils/csv.util';
import { exportarTablaPdf } from '../../../shared/utils/pdf-tabla.util';

type TabConteoFisico = 'nuevo' | 'historial';

interface FilaConteo {
  productoId: number;
  codigo: string;
  nombre: string;
  sistema: number;
}

/** Una sesión de conteo ya guardada, para el historial de abajo — ver
 *  ConteoFisico en conteo-fisico.model.ts. */
interface FilaHistorialConteo {
  id: number;
  fecha: string;
  bodegaId: number;
  bodegaNombre: string;
  usuarioNombre: string;
  totalProductos: number;
  totalDiferencias: number;
  notas: string | null;
}

/** Una línea del detalle de una sesión, para cuando se expande en el
 *  historial — ver ConteoFisicoDetalle en conteo-fisico.model.ts. */
interface FilaDetalleHistorial {
  productoNombre: string;
  sistema: number;
  contado: number;
  diferencia: number;
}

/**
 * Cuadre de inventario: capturas lo que de verdad contaste en una bodega y
 * el sistema calcula la diferencia contra lo que dice ExistenciaBodega —
 * sin que tengas que calcular tú el ajuste a mano como tocaría hacer con
 * Movimientos entre bodegas (Salida/Ajuste) si encontraras una diferencia.
 *
 * Reutiliza MovimientoInventarioService.registrar() (ver ese archivo) para
 * aplicar los ajustes: si lo contado es MAYOR a lo del sistema, se registra
 * como Entrada (sin origen) a esa bodega; si es MENOR, como Salida/Ajuste
 * (sin destino) desde esa bodega — exactamente el mismo mecanismo que ya
 * usa Movimientos entre bodegas, así que el historial de ahí también
 * muestra estos ajustes con la nota "Ajuste por conteo físico".
 *
 * Además, cada vez que se guarda, la sesión completa queda como su PROPIO
 * registro en ConteoFisico + ConteoFisicoDetalle (ver ese modelo) — con
 * quién la hizo, cuándo, en qué bodega y el detalle de TODOS los productos
 * contados (no solo los que tuvieron diferencia). Antes esto se perdía: un
 * conteo sin diferencias no dejaba ningún rastro, y uno con diferencias
 * solo se veía como ajustes sueltos en Movimientos entre bodegas, sin nada
 * que diga "esto fue UN conteo". Por eso ahora se puede guardar aunque no
 * haya ninguna diferencia (antes el botón se deshabilitaba en ese caso).
 *
 * Solo entran productos que YA tienen un registro en esa bodega — igual
 * que un traspaso o una salida, un producto sin bodega asignada se asigna
 * primero desde Movimientos entre bodegas.
 */
@Component({
  selector: 'app-conteo-fisico',
  standalone: true,
  imports: [DatePipe, EscaneoCodigoComponent],
  templateUrl: './conteo-fisico.component.html',
  styleUrl: './conteo-fisico.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConteoFisicoComponent implements OnInit, OnDestroy {
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly movimientoService = inject(MovimientoInventarioService);
  private readonly auth = inject(AuthService);

  protected readonly productos = signal<Producto[]>([]);
  protected readonly bodegas = signal<Bodega[]>([]);
  protected readonly existenciasBodega = signal<ExistenciaBodega[]>([]);
  protected readonly usuarios = signal<Usuario[]>([]);
  protected readonly conteosFisicos = signal<ConteoFisico[]>([]);
  protected readonly conteoFisicoDetalles = signal<ConteoFisicoDetalle[]>([]);
  protected readonly cargando = signal(false);
  protected readonly guardando = signal(false);
  protected readonly tabActiva = signal<TabConteoFisico>('nuevo');

  seleccionarTab(tab: TabConteoFisico): void {
    this.tabActiva.set(tab);
  }

  protected readonly bodegaId = signal(0);
  /** Lo que el usuario capturó por producto en esta sesión de conteo — solo
   *  mientras no guarde. Se reinicia al cambiar de bodega (ver bodegaId()
   *  más abajo, vía effect-like reset en seleccionarBodega()). */
  protected readonly contados = signal<Record<number, number>>({});
  protected readonly notas = signal('');

  protected readonly bodegasActivas = computed(() => this.bodegas().filter((b) => b.activo !== false));

  protected readonly filas = computed<FilaConteo[]>(() => {
    const bodegaId = this.bodegaId();
    if (!bodegaId) return [];
    const productosPorId = new Map(this.productos().map((p) => [p.id, p]));
    return this.existenciasBodega()
      .filter((e) => e.bodegaId === bodegaId)
      .map((e) => {
        const producto = productosPorId.get(e.productoId);
        return { productoId: e.productoId, codigo: producto?.codigo ?? '', nombre: producto?.nombre ?? '—', sistema: e.existencia };
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  });

  protected readonly hayDiferencias = computed(() => this.filas().some((f) => this.diferencia(f) !== 0));
  protected readonly totalDiferencias = computed(() => this.filas().filter((f) => this.diferencia(f) !== 0).length);

  protected contadoDe(fila: FilaConteo): number {
    return this.contados()[fila.productoId] ?? fila.sistema;
  }

  protected diferencia(fila: FilaConteo): number {
    return this.contadoDe(fila) - fila.sistema;
  }

  protected actualizarContado(productoId: number, valor: string): void {
    const numero = Number(valor);
    this.contados.update((actual) => ({ ...actual, [productoId]: Number.isNaN(numero) ? 0 : Math.max(0, numero) }));
  }

  /** Atajo para contar escaneando (lector USB/Bluetooth o cámara — ver
   *  app-escaneo-codigo): cada escaneo SUMA 1 al contado de ese producto,
   *  en vez de reemplazarlo — así contar 5 piezas iguales es escanearlas 5
   *  veces, igual que en cualquier app de conteo por código de barras. La
   *  primera vez que se escanea un producto (todavía sin tocar a mano en
   *  esta sesión) empieza en 1, no en "lo que ya decía el sistema + 1" —
   *  contadoDe() cae al valor del sistema solo como valor por default
   *  mientras no se haya capturado nada, no como punto de partida real al
   *  escanear. Solo busca entre los productos de la bodega ya elegida
   *  (ver filas()), igual que el resto de esta pantalla. */
  protected escanearProducto(codigo: string): void {
    if (!this.bodegaId()) {
      this.toast.advertencia('Primero elige una bodega.');
      return;
    }
    const normalizado = codigo.trim().toLowerCase();
    const fila = this.filas().find((f) => (f.codigo ?? '').trim().toLowerCase() === normalizado);
    if (!fila) {
      this.toast.advertencia(`No se encontró ningún producto con el código "${codigo}" en esta bodega.`);
      return;
    }
    const yaTocado = fila.productoId in this.contados();
    const nuevoContado = (yaTocado ? this.contadoDe(fila) : 0) + 1;
    this.contados.update((actual) => ({ ...actual, [fila.productoId]: nuevoContado }));
    this.toast.info(`${fila.nombre}: ${nuevoContado} contado(s).`);
  }

  // ── Historial de sesiones de conteo ya guardadas ──
  private nombreBodega(id: number): string {
    return this.bodegas().find((b) => b.id === id)?.nombre ?? '—';
  }
  private nombreUsuario(id: number): string {
    const usuario = this.usuarios().find((u) => u.id === id);
    return usuario ? nombreCompletoUsuario(usuario) : '—';
  }

  protected readonly historialConteos = computed<FilaHistorialConteo[]>(() =>
    this.conteosFisicos()
      .map((c) => ({
        id: c.id,
        fecha: c.fecha,
        bodegaId: c.bodegaId,
        bodegaNombre: this.nombreBodega(c.bodegaId),
        usuarioNombre: this.nombreUsuario(c.usuarioId),
        totalProductos: c.totalProductos,
        totalDiferencias: c.totalDiferencias,
        notas: c.notas,
      }))
      .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id),
  );

  protected readonly filtroHistorialBodegaId = signal(0);
  protected readonly filtroHistorialDesde = signal('');
  protected readonly filtroHistorialHasta = signal('');

  protected readonly hayFiltrosHistorialActivos = computed(
    () => this.filtroHistorialBodegaId() !== 0 || this.filtroHistorialDesde() !== '' || this.filtroHistorialHasta() !== '',
  );

  protected readonly historialFiltrado = computed(() => {
    const bodegaId = this.filtroHistorialBodegaId();
    const desde = this.filtroHistorialDesde();
    const hasta = this.filtroHistorialHasta();
    return this.historialConteos().filter((c) => {
      if (bodegaId && c.bodegaId !== bodegaId) return false;
      if (desde && c.fecha.slice(0, 10) < desde) return false;
      if (hasta && c.fecha.slice(0, 10) > hasta) return false;
      return true;
    });
  });

  limpiarFiltrosHistorial(): void {
    this.filtroHistorialBodegaId.set(0);
    this.filtroHistorialDesde.set('');
    this.filtroHistorialHasta.set('');
  }

  /** Sesión expandida en el historial (su detalle completo, producto por
   *  producto) — null = ninguna; una sola a la vez, igual que un acordeón. */
  protected readonly detalleAbiertoId = signal<number | null>(null);

  toggleDetalle(conteoId: number): void {
    this.detalleAbiertoId.update((actual) => (actual === conteoId ? null : conteoId));
  }

  protected readonly detalleAbierto = computed<FilaDetalleHistorial[]>(() => {
    const id = this.detalleAbiertoId();
    if (id === null) return [];
    const productosPorId = new Map(this.productos().map((p) => [p.id, p]));
    return this.conteoFisicoDetalles()
      .filter((d) => d.conteoFisicoId === id)
      .map((d) => ({
        productoNombre: productosPorId.get(d.productoId)?.nombre ?? '—',
        sistema: d.sistema,
        contado: d.contado,
        diferencia: d.diferencia,
      }))
      .sort((a, b) => a.productoNombre.localeCompare(b.productoNombre));
  });

  ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid'); // ancho completo
    this.cargar();
  }

  private cargar(): void {
    this.cargando.set(true);
    Promise.all([
      firstValueFrom(this.data.list<Producto>('Producto')),
      firstValueFrom(this.data.list<Bodega>('Bodega')),
      firstValueFrom(this.data.list<ExistenciaBodega>('ExistenciaBodega')),
      firstValueFrom(this.data.list<Usuario>('Usuario')),
      firstValueFrom(this.data.list<ConteoFisico>('ConteoFisico')),
      firstValueFrom(this.data.list<ConteoFisicoDetalle>('ConteoFisicoDetalle')),
    ]).then(([productos, bodegas, existenciasBodega, usuarios, conteosFisicos, conteoFisicoDetalles]) => {
      this.productos.set(productos);
      this.bodegas.set(bodegas);
      this.existenciasBodega.set(existenciasBodega);
      this.usuarios.set(usuarios);
      this.conteosFisicos.set(conteosFisicos);
      this.conteoFisicoDetalles.set(conteoFisicoDetalles);
      this.cargando.set(false);
    });
  }

  seleccionarBodega(id: number): void {
    this.bodegaId.set(id);
    this.contados.set({}); // nueva sesión de conteo — descarta lo capturado para la bodega anterior
    this.notas.set('');
  }

  /** Guarda la sesión completa: el encabezado ConteoFisico, una línea de
   *  ConteoFisicoDetalle por CADA producto contado (tenga diferencia o no —
   *  así el historial muestra el conteo completo) y, solo para los que sí
   *  tuvieron diferencia, el ajuste de existencia de siempre (ver
   *  MovimientoInventarioService.registrar()). Se puede guardar aunque no
   *  haya ninguna diferencia: un conteo "todo cuadró" también es historial
   *  válido. */
  async guardarCuadre(): Promise<void> {
    const bodegaId = this.bodegaId();
    const usuarioId = this.auth.usuarioActual()?.id;
    if (!usuarioId) {
      this.toast.error('No se pudo identificar al usuario actual.');
      return;
    }
    const filas = this.filas();
    if (filas.length === 0) return;

    const ajustes = filas.map((fila) => ({ fila, diferencia: this.diferencia(fila) })).filter(({ diferencia }) => diferencia !== 0);

    this.guardando.set(true);
    try {
      for (const { fila, diferencia } of ajustes) {
        const nota = `Ajuste por conteo físico (sistema: ${fila.sistema}, contado: ${this.contadoDe(fila)})`;
        if (diferencia > 0) {
          await this.movimientoService.registrar({
            productoId: fila.productoId,
            bodegaOrigenId: null,
            bodegaDestinoId: bodegaId,
            cantidad: diferencia,
            nota,
          });
        } else {
          await this.movimientoService.registrar({
            productoId: fila.productoId,
            bodegaOrigenId: bodegaId,
            bodegaDestinoId: null,
            cantidad: -diferencia,
            nota,
          });
        }
      }

      const conteo = await firstValueFrom(
        this.data.alta<ConteoFisico>('ConteoFisico', {
          bodegaId,
          usuarioId,
          fecha: new Date().toISOString(),
          totalProductos: filas.length,
          totalDiferencias: ajustes.length,
          notas: this.notas().trim() || null,
        }),
      );

      for (const fila of filas) {
        await firstValueFrom(
          this.data.alta<ConteoFisicoDetalle>('ConteoFisicoDetalle', {
            conteoFisicoId: conteo.id,
            productoId: fila.productoId,
            sistema: fila.sistema,
            contado: this.contadoDe(fila),
            diferencia: this.diferencia(fila),
          }),
        );
      }

      this.toast.exito(
        ajustes.length > 0
          ? `Conteo guardado: ${ajustes.length} ajuste${ajustes.length === 1 ? '' : 's'}.`
          : 'Conteo guardado: sin diferencias.',
      );
      this.contados.set({});
      this.notas.set('');
      this.cargar();
    } finally {
      this.guardando.set(false);
    }
  }

  exportarCsvHistorial(): void {
    exportarCsv(
      'conteo_fisico.csv',
      [
        { clave: 'fecha', etiqueta: 'Fecha' },
        { clave: 'bodegaNombre', etiqueta: 'Bodega' },
        { clave: 'usuarioNombre', etiqueta: 'Usuario' },
        { clave: 'totalProductos', etiqueta: 'Productos contados' },
        { clave: 'totalDiferencias', etiqueta: 'Diferencias' },
        { clave: 'notas', etiqueta: 'Notas' },
      ],
      this.historialFiltrado().map((f) => ({ ...f, notas: f.notas ?? '' })),
    );
  }

  exportarPdfHistorial(): void {
    exportarTablaPdf({
      nombreArchivo: 'conteo_fisico.pdf',
      titulo: 'Historial de conteo físico',
      subtitulo: this.hayFiltrosHistorialActivos() ? 'Con filtros aplicados' : undefined,
      columnas: [
        { etiqueta: 'Fecha', ancho: 32 },
        { etiqueta: 'Bodega', ancho: 36 },
        { etiqueta: 'Usuario', ancho: 40 },
        { etiqueta: 'Productos', ancho: 24 },
        { etiqueta: 'Diferencias', ancho: 26 },
        { etiqueta: 'Notas' },
      ],
      filas: this.historialFiltrado().map((f) => [
        new Date(f.fecha).toLocaleString('es-MX'),
        f.bodegaNombre,
        f.usuarioNombre,
        String(f.totalProductos),
        String(f.totalDiferencias),
        f.notas ?? '',
      ]),
    });
  }
}

import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { Producto } from '../productos/producto.model';
import { alertasStockBajo } from '../productos/producto.util';
import { ExistenciaBodega } from '../movimientos-bodega/existencia-bodega.model';
import { NivelMinimoBodega } from '../productos/nivel-minimo-bodega.model';
import { Bodega } from '../bodegas/bodega.model';
import { Proveedor } from '../proveedores/proveedor.model';
import { ProductoProveedor } from '../proveedores/producto-proveedor.model';
import { ToastService } from '../../../shared/services/toast.service';
import { OrdenCompraBorradorService } from '../compras/orden-compra-borrador.service';

interface FilaReposicion {
  productoId: number;
  codigo: string;
  nombre: string;
  /** null = alerta global "heredada" (sin NivelMinimoBodega propios, ver
   *  alertasStockBajo() en producto.util.ts) — no se puede saber EN CUÁL
   *  bodega concreta comprar. Con número, la bodega exacta que está baja. */
  bodegaId: number | null;
  bodegaNombre: string;
  existencia: number;
  nivelMinimo: number;
  /** Cuánto comprar para volver a quedar con el doble del mínimo, no solo
   *  justo en el mínimo — así no se vuelve a caer en alerta con el primer
   *  movimiento de salida. Ver comentario en `filas` más abajo. */
  sugerida: number;
  proveedorId: number | null;
  proveedorNombre: string;
  costoUnitario: number;
}

/**
 * "Qué comprar y cuánto" — a diferencia de la tarjeta "Stock bajo" de Valor
 * de stock (que solo avisa que algo está por debajo del mínimo), esta
 * pantalla ya calcula una cantidad sugerida y agrupa por proveedor, lista
 * para pasar a quien se le compra. Es de solo lectura: no genera ningún
 * movimiento ni modifica existencia — eso sigue siendo tarea de Movimientos
 * entre bodegas, una vez que de verdad llegue la mercancía (como Entrada).
 *
 * Una fila por ALERTA (ver alertasStockBajo() en producto.util.ts), no por
 * producto: un mismo producto puede aparecer varias veces si tiene varias
 * bodegas con mínimo propio y más de una está baja a la vez.
 */
@Component({
  selector: 'app-sugerencia-reposicion',
  standalone: true,
  imports: [],
  templateUrl: './sugerencia-reposicion.component.html',
  styleUrl: './sugerencia-reposicion.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SugerenciaReposicionComponent implements OnInit {
  private readonly data = inject(DataClientService);
  private readonly router = inject(Router);
  private readonly borradorService = inject(OrdenCompraBorradorService);
  protected readonly toast = inject(ToastService);

  protected readonly productos = signal<Producto[]>([]);
  protected readonly existenciasBodega = signal<ExistenciaBodega[]>([]);
  protected readonly nivelesMinimoBodega = signal<NivelMinimoBodega[]>([]);
  protected readonly bodegas = signal<Bodega[]>([]);
  protected readonly proveedores = signal<Proveedor[]>([]);
  protected readonly productoProveedor = signal<ProductoProveedor[]>([]);
  protected readonly cargando = signal(false);

  /** Proveedor preferido de un producto: el de su ProductoProveedor marcado
   *  `preferido`, o el Producto.proveedorId "heredado" si todavía no tiene
   *  ningún registro en ProductoProveedor — mismo criterio que
   *  proveedor-productos.component.ts. También el precio de compra de ESE
   *  proveedor, para pre-llenar el costo unitario al generar una orden
   *  (ver generarOrdenCompra()), en vez del costo promedio del producto. */
  private proveedorPreferido(producto: Producto): { proveedorId: number | null; precioCompra: number | null } {
    const preferido = this.productoProveedor().find((pp) => pp.productoId === producto.id && pp.preferido);
    if (preferido) return { proveedorId: preferido.proveedorId, precioCompra: preferido.precioCompra };
    return { proveedorId: producto.proveedorId ?? null, precioCompra: null };
  }

  protected readonly filtroProveedorId = signal(0);
  protected readonly filtroBodegaId = signal(0);

  /** Solo productos físicos y activos con al menos una alerta de stock bajo
   *  (ver alertasStockBajo() en producto.util.ts — por bodega si el
   *  producto ya tiene NivelMinimoBodega propios, o global "heredada" si
   *  no). Cantidad sugerida = llegar al DOBLE del mínimo de esa alerta, no
   *  solo igualarlo: comprar justo lo que falta para tocar el mínimo deja
   *  la existencia otra vez en el borde, y con la primera salida ya se
   *  vuelve a disparar la alerta. */
  protected readonly filas = computed<FilaReposicion[]>(() => {
    const nombreProveedor = (id: number | null) => {
      if (!id) return 'Sin proveedor asignado';
      return this.proveedores().find((p) => p.id === id)?.nombre ?? 'Sin proveedor asignado';
    };
    const nombreBodega = (id: number | null) => {
      if (id === null) return 'Todas (sin mínimo por bodega)';
      return this.bodegas().find((b) => b.id === id)?.nombre ?? '—';
    };
    const filas: FilaReposicion[] = [];
    for (const producto of this.productos()) {
      if (!producto.activo) continue;
      const alertas = alertasStockBajo(producto, this.existenciasBodega(), this.nivelesMinimoBodega());
      if (alertas.length === 0) continue;

      const { proveedorId, precioCompra } = this.proveedorPreferido(producto);
      for (const alerta of alertas) {
        const sugerida = Math.max(alerta.nivelMinimo * 2 - alerta.existencia, 1);
        filas.push({
          productoId: producto.id,
          codigo: producto.codigo ?? '',
          nombre: producto.nombre,
          bodegaId: alerta.bodegaId,
          bodegaNombre: nombreBodega(alerta.bodegaId),
          existencia: alerta.existencia,
          nivelMinimo: alerta.nivelMinimo,
          sugerida,
          proveedorId,
          proveedorNombre: nombreProveedor(proveedorId),
          costoUnitario: precioCompra ?? producto.costo,
        });
      }
    }
    return filas.sort((a, b) => a.proveedorNombre.localeCompare(b.proveedorNombre) || b.nivelMinimo - a.nivelMinimo);
  });

  protected readonly opcionesProveedorFiltro = computed(() => {
    const vistos = new Map<number, string>();
    for (const f of this.filas()) {
      if (f.proveedorId) vistos.set(f.proveedorId, f.proveedorNombre);
    }
    return Array.from(vistos.entries())
      .map(([id, nombre]) => ({ id, nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  });

  /** Solo tiene sentido ofrecer este filtro cuando de verdad hay alertas
   *  ligadas a una bodega concreta (no todas "heredadas" globales). */
  protected readonly opcionesBodegaFiltro = computed(() => {
    const vistos = new Map<number, string>();
    for (const f of this.filas()) {
      if (f.bodegaId !== null) vistos.set(f.bodegaId, f.bodegaNombre);
    }
    return Array.from(vistos.entries())
      .map(([id, nombre]) => ({ id, nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  });

  protected readonly filasFiltradas = computed(() => {
    const proveedorId = this.filtroProveedorId();
    const bodegaId = this.filtroBodegaId();
    return this.filas().filter(
      (f) => (!proveedorId || f.proveedorId === proveedorId) && (!bodegaId || f.bodegaId === bodegaId),
    );
  });

  ngOnInit(): void {
    this.cargar();
  }

  private cargar(): void {
    this.cargando.set(true);
    Promise.all([
      firstValueFrom(this.data.list<Producto>('Producto')),
      firstValueFrom(this.data.list<ExistenciaBodega>('ExistenciaBodega')),
      firstValueFrom(this.data.list<NivelMinimoBodega>('NivelMinimoBodega')),
      firstValueFrom(this.data.list<Bodega>('Bodega')),
      firstValueFrom(this.data.list<Proveedor>('Proveedor')),
      firstValueFrom(this.data.list<ProductoProveedor>('ProductoProveedor')),
    ]).then(([productos, existenciasBodega, nivelesMinimoBodega, bodegas, proveedores, productoProveedor]) => {
      this.productos.set(productos);
      this.existenciasBodega.set(existenciasBodega);
      this.nivelesMinimoBodega.set(nivelesMinimoBodega);
      this.bodegas.set(bodegas);
      this.proveedores.set(proveedores);
      this.productoProveedor.set(productoProveedor);
      this.cargando.set(false);
    });
  }

  /** Genera un borrador de Orden de compra con todos los productos
   *  sugeridos de UN proveedor (las órdenes son por proveedor — ver
   *  orden-compra.model.ts) y navega a la ficha de Órdenes de compra para
   *  que el usuario la revise, ajuste bodega/cantidades si hace falta, y
   *  sea él quien la guarde — no se crea nada todavía aquí. Si todas las
   *  líneas sugeridas apuntan a la MISMA bodega, se precarga como bodega
   *  destino (ver OrdenCompraBorradorService); si son de bodegas distintas
   *  (o son alertas "heredadas" sin bodega concreta), se deja que el
   *  usuario la elija él mismo en la ficha, igual que antes. */
  generarOrdenCompra(proveedorId: number): void {
    const filasProveedor = this.filas().filter((f) => f.proveedorId === proveedorId);
    if (filasProveedor.length === 0) return;
    const lineas = filasProveedor.map((f) => ({ productoId: f.productoId, cantidad: f.sugerida, costoUnitario: f.costoUnitario }));
    const bodegasDistintas = new Set(filasProveedor.map((f) => f.bodegaId));
    const bodegaId = bodegasDistintas.size === 1 ? filasProveedor[0].bodegaId : null;
    this.borradorService.establecer({ proveedorId, bodegaId, lineas });
    this.router.navigate(['/inventario/ordenes-compra']);
  }
}

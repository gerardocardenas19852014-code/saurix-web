import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { Producto } from '../productos/producto.model';
import { existenciaTotal } from '../productos/producto.util';
import { ExistenciaBodega } from '../movimientos-bodega/existencia-bodega.model';
import { Proveedor } from '../proveedores/proveedor.model';

interface FilaReposicion {
  productoId: number;
  codigo: string;
  nombre: string;
  existencia: number;
  nivelMinimo: number;
  /** Cuánto comprar para volver a quedar con el doble del mínimo, no solo
   *  justo en el mínimo — así no se vuelve a caer en alerta con el primer
   *  movimiento de salida. Ver comentario en `filas` más abajo. */
  sugerida: number;
  proveedorId: number | null;
  proveedorNombre: string;
}

/**
 * "Qué comprar y cuánto" — a diferencia de la tarjeta "Stock bajo" de Valor
 * de stock (que solo avisa que algo está por debajo del mínimo), esta
 * pantalla ya calcula una cantidad sugerida y agrupa por proveedor, lista
 * para pasar a quien se le compra. Es de solo lectura: no genera ningún
 * movimiento ni modifica existencia — eso sigue siendo tarea de Movimientos
 * entre bodegas, una vez que de verdad llegue la mercancía (como Entrada).
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

  protected readonly productos = signal<Producto[]>([]);
  protected readonly existenciasBodega = signal<ExistenciaBodega[]>([]);
  protected readonly proveedores = signal<Proveedor[]>([]);
  protected readonly cargando = signal(false);

  protected readonly filtroProveedorId = signal(0);

  /** Solo productos físicos, activos, con nivelMinimo definido y por debajo
   *  de él — mismo criterio que `stockBajo` en valor-stock.component.ts,
   *  pero aquí es el punto de entrada de toda la pantalla, no una alerta
   *  aparte. Cantidad sugerida = llegar al DOBLE del mínimo (no solo
   *  igualarlo): comprar justo lo que falta para tocar el mínimo deja la
   *  existencia otra vez en el borde, y con la primera salida ya se vuelve
   *  a disparar la alerta. */
  protected readonly filas = computed<FilaReposicion[]>(() => {
    const nombreProveedor = (id: number | null) => {
      if (!id) return 'Sin proveedor asignado';
      return this.proveedores().find((p) => p.id === id)?.nombre ?? 'Sin proveedor asignado';
    };
    return this.productos()
      // typeof === 'number' (no !== null): ver mismo comentario en valor-stock.component.ts.
      .filter((p) => p.activo && p.existencia !== null && typeof p.nivelMinimo === 'number')
      .map((p) => {
        const existencia = existenciaTotal(p, this.existenciasBodega());
        return { producto: p, existencia };
      })
      .filter(({ producto, existencia }) => existencia < producto.nivelMinimo!)
      .map(({ producto, existencia }) => ({
        productoId: producto.id,
        codigo: producto.codigo ?? '',
        nombre: producto.nombre,
        existencia,
        nivelMinimo: producto.nivelMinimo!,
        sugerida: Math.max(producto.nivelMinimo! * 2 - existencia, 1),
        proveedorId: producto.proveedorId ?? null,
        proveedorNombre: nombreProveedor(producto.proveedorId ?? null),
      }))
      .sort((a, b) => a.proveedorNombre.localeCompare(b.proveedorNombre) || b.nivelMinimo - a.nivelMinimo);
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

  protected readonly filasFiltradas = computed(() => {
    const id = this.filtroProveedorId();
    if (!id) return this.filas();
    return this.filas().filter((f) => f.proveedorId === id);
  });

  ngOnInit(): void {
    this.cargar();
  }

  private cargar(): void {
    this.cargando.set(true);
    Promise.all([
      firstValueFrom(this.data.list<Producto>('Producto')),
      firstValueFrom(this.data.list<ExistenciaBodega>('ExistenciaBodega')),
      firstValueFrom(this.data.list<Proveedor>('Proveedor')),
    ]).then(([productos, existenciasBodega, proveedores]) => {
      this.productos.set(productos);
      this.existenciasBodega.set(existenciasBodega);
      this.proveedores.set(proveedores);
      this.cargando.set(false);
    });
  }
}

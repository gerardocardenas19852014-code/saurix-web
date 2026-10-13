import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { ToastService } from '../../../shared/services/toast.service';
import { Producto } from '../productos/producto.model';
import { Bodega } from '../bodegas/bodega.model';
import { ExistenciaBodega } from '../movimientos-bodega/existencia-bodega.model';
import { MovimientoInventarioService } from '../movimientos-bodega/movimiento-inventario.service';

interface FilaConteo {
  productoId: number;
  codigo: string;
  nombre: string;
  sistema: number;
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
 * Solo entran productos que YA tienen un registro en esa bodega — igual
 * que un traspaso o una salida, un producto sin bodega asignada se asigna
 * primero desde Movimientos entre bodegas.
 */
@Component({
  selector: 'app-conteo-fisico',
  standalone: true,
  imports: [],
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

  protected readonly productos = signal<Producto[]>([]);
  protected readonly bodegas = signal<Bodega[]>([]);
  protected readonly existenciasBodega = signal<ExistenciaBodega[]>([]);
  protected readonly cargando = signal(false);
  protected readonly guardando = signal(false);

  protected readonly bodegaId = signal(0);
  /** Lo que el usuario capturó por producto en esta sesión de conteo — solo
   *  mientras no guarde. Se reinicia al cambiar de bodega (ver bodegaId()
   *  más abajo, vía effect-like reset en seleccionarBodega()). */
  protected readonly contados = signal<Record<number, number>>({});

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
    ]).then(([productos, bodegas, existenciasBodega]) => {
      this.productos.set(productos);
      this.bodegas.set(bodegas);
      this.existenciasBodega.set(existenciasBodega);
      this.cargando.set(false);
    });
  }

  seleccionarBodega(id: number): void {
    this.bodegaId.set(id);
    this.contados.set({}); // nueva sesión de conteo — descarta lo capturado para la bodega anterior
  }

  async guardarCuadre(): Promise<void> {
    const bodegaId = this.bodegaId();
    const ajustes = this.filas()
      .map((fila) => ({ fila, diferencia: this.diferencia(fila) }))
      .filter(({ diferencia }) => diferencia !== 0);

    if (ajustes.length === 0) {
      this.toast.info('No hay diferencias que ajustar.');
      return;
    }

    this.guardando.set(true);
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

    this.guardando.set(false);
    this.contados.set({});
    this.toast.exito(`Cuadre registrado: ${ajustes.length} ajuste${ajustes.length === 1 ? '' : 's'}.`);
    this.cargar();
  }
}

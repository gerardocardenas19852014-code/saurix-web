import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../../core/services/data-client.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Producto } from '../producto.model';
import { Bodega } from '../../bodegas/bodega.model';
import { ExistenciaBodega } from '../../movimientos-bodega/existencia-bodega.model';
import { NivelMinimoBodega } from '../nivel-minimo-bodega.model';

/** Una fila de la tabla: una Bodega activa, con la existencia actual del
 *  producto ahí (solo lectura, de referencia) y su nivel mínimo PROPIO
 *  (editable) — `nivelMinimoBodegaId` es null cuando esa bodega todavía no
 *  tiene un registro de NivelMinimoBodega para este producto. Dejar el
 *  campo vacío y guardar BORRA el registro (vuelve a "sin mínimo propio" en
 *  esa bodega), no lo deja en cero — ver guardarCambios(). Mismo patrón
 *  general que FilaProveedorProducto en proveedor-productos.component.ts. */
interface FilaNivelMinimoBodega {
  bodegaId: number;
  bodegaNombre: string;
  existencia: number;
  nivelMinimoBodegaId: number | null;
  nivelMinimoTexto: string;
  nivelMinimoOriginalTexto: string;
}

@Component({
  selector: 'app-nivel-minimo-bodega',
  standalone: true,
  imports: [],
  templateUrl: './nivel-minimo-bodega.component.html',
  styleUrl: './nivel-minimo-bodega.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NivelMinimoBodegaComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly data = inject(DataClientService);
  private readonly location = inject(Location);
  protected readonly toast = inject(ToastService);

  private productoId!: number;
  protected readonly producto = signal<Producto | null>(null);

  protected readonly filas = signal<FilaNivelMinimoBodega[]>([]);
  protected readonly cargando = signal(false);
  protected readonly guardando = signal(false);
  protected readonly progresoGuardado = signal('');

  protected readonly filasModificadas = computed(() => this.filas().filter((f) => this.estaModificada(f)));

  protected estaModificada(fila: FilaNivelMinimoBodega): boolean {
    return fila.nivelMinimoTexto.trim() !== fila.nivelMinimoOriginalTexto;
  }

  /** Mismo mínimo global "heredado" que se sigue usando mientras este
   *  producto no tenga ningún NivelMinimoBodega propio — ver
   *  alertasStockBajo() en producto.util.ts. Solo informativo aquí. */
  protected readonly nivelMinimoHeredado = computed(() => this.producto()?.nivelMinimo ?? null);
  protected readonly tieneMinimosPropios = computed(() => this.filas().some((f) => f.nivelMinimoBodegaId !== null));

  // Pantalla a ancho completo (html[data-wide='grid'] en styles.scss) — mismo
  // criterio que Proveedores de este producto (ver proveedor-productos.component.ts).
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid');
    this.productoId = Number(this.route.snapshot.paramMap.get('id'));
    this.data.getById<Producto>('Producto', this.productoId).subscribe((p) => this.producto.set(p));
    this.cargar();
  }

  volver(): void {
    this.location.back();
  }

  cargar(): void {
    this.cargando.set(true);
    Promise.all([
      firstValueFrom(this.data.list<Bodega>('Bodega')),
      firstValueFrom(this.data.list<ExistenciaBodega>('ExistenciaBodega', { productoId: this.productoId })),
      firstValueFrom(this.data.list<NivelMinimoBodega>('NivelMinimoBodega', { productoId: this.productoId })),
    ]).then(([bodegas, existencias, niveles]) => {
      const filas: FilaNivelMinimoBodega[] = bodegas
        .filter((b) => b.activo !== false)
        .map((b) => {
          const nivel = niveles.find((n) => n.bodegaId === b.id) ?? null;
          const texto = nivel ? String(nivel.nivelMinimo) : '';
          return {
            bodegaId: b.id,
            bodegaNombre: b.nombre,
            existencia: existencias.find((e) => e.bodegaId === b.id)?.existencia ?? 0,
            nivelMinimoBodegaId: nivel?.id ?? null,
            nivelMinimoTexto: texto,
            nivelMinimoOriginalTexto: texto,
          };
        })
        .sort((a, b) => a.bodegaNombre.localeCompare(b.bodegaNombre));
      this.filas.set(filas);
      this.cargando.set(false);
    });
  }

  cambiarNivelMinimo(bodegaId: number, texto: string): void {
    this.filas.update((filas) => filas.map((f) => (f.bodegaId === bodegaId ? { ...f, nivelMinimoTexto: texto } : f)));
  }

  descartarCambios(): void {
    this.filas.update((filas) => filas.map((f) => ({ ...f, nivelMinimoTexto: f.nivelMinimoOriginalTexto })));
  }

  /** Guarda en bloque solo las filas con cambios — dejar el campo vacío y
   *  guardar BORRA el NivelMinimoBodega de esa bodega (vuelve a depender del
   *  mínimo global heredado ahí), en vez de guardarlo como 0. */
  async guardarCambios(): Promise<void> {
    const modificadas = this.filasModificadas();
    if (modificadas.length === 0) return;

    this.guardando.set(true);
    for (let i = 0; i < modificadas.length; i++) {
      const fila = modificadas[i];
      this.progresoGuardado.set(`Guardando ${i + 1}/${modificadas.length}: ${fila.bodegaNombre}…`);
      const texto = fila.nivelMinimoTexto.trim();

      if (texto === '') {
        if (fila.nivelMinimoBodegaId !== null) {
          await firstValueFrom(this.data.baja('NivelMinimoBodega', fila.nivelMinimoBodegaId));
        }
        continue;
      }

      const nivelMinimo = Number(texto);
      if (Number.isNaN(nivelMinimo) || nivelMinimo < 0) continue;

      if (fila.nivelMinimoBodegaId !== null) {
        await firstValueFrom(
          this.data.modificacion<NivelMinimoBodega>('NivelMinimoBodega', {
            id: fila.nivelMinimoBodegaId,
            productoId: this.productoId,
            bodegaId: fila.bodegaId,
            nivelMinimo,
          }),
        );
      } else {
        await firstValueFrom(
          this.data.alta<NivelMinimoBodega>('NivelMinimoBodega', {
            productoId: this.productoId,
            bodegaId: fila.bodegaId,
            nivelMinimo,
          }),
        );
      }
    }

    this.guardando.set(false);
    this.progresoGuardado.set('');
    this.toast.exito(`${modificadas.length} bodega${modificadas.length === 1 ? '' : 's'} guardada${modificadas.length === 1 ? '' : 's'}.`);
    this.cargar();
  }
}

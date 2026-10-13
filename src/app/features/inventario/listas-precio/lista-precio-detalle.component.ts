import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { ToastService } from '../../../shared/services/toast.service';
import { Producto } from '../productos/producto.model';
import { formatMoneda } from '../productos/producto.util';
import { CategoriaProducto } from '../categorias-producto/categoria-producto.model';
import { TipoListaPrecio } from '../tipos-lista-precio/tipo-lista-precio.model';
import { PrecioLista } from './precio-lista.model';

/** Una fila de la tabla: un Producto activo, con su precio base (de
 *  referencia, no editable aquí) y el precio que tiene en ESTA lista
 *  concreta (editable) — `precioListaId` es null cuando el producto
 *  todavía no tiene un registro de PrecioLista para esta lista (usa el
 *  precio base tal cual). `precioOriginalTexto` guarda el valor con el
 *  que se cargó la fila, para poder detectar cambios sin guardar
 *  (`modificada`) sin tener que ir comparando contra el backend. */
interface FilaPrecioLista {
  productoId: number;
  codigo: string;
  nombre: string;
  categoriaNombre: string;
  precioBase: number;
  precioListaId: number | null;
  precioTexto: string;
  precioOriginalTexto: string;
}

@Component({
  selector: 'app-lista-precio-detalle',
  standalone: true,
  imports: [],
  templateUrl: './lista-precio-detalle.component.html',
  styleUrl: './lista-precio-detalle.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListaPrecioDetalleComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly data = inject(DataClientService);
  private readonly location = inject(Location);
  protected readonly toast = inject(ToastService);
  protected readonly formatMoneda = formatMoneda;

  private tipoListaPrecioId!: number;
  protected readonly tipoListaPrecio = signal<TipoListaPrecio | null>(null);

  protected readonly filas = signal<FilaPrecioLista[]>([]);
  protected readonly cargando = signal(false);
  protected readonly guardando = signal(false);
  protected readonly progresoGuardado = signal('');
  protected readonly busqueda = signal('');

  protected readonly filasFiltradas = computed(() => {
    const texto = this.busqueda().trim().toLowerCase();
    if (!texto) return this.filas();
    return this.filas().filter(
      (f) => f.nombre.toLowerCase().includes(texto) || f.codigo.toLowerCase().includes(texto),
    );
  });

  protected readonly filasModificadas = computed(() => this.filas().filter((f) => this.estaModificada(f)));

  protected estaModificada(fila: FilaPrecioLista): boolean {
    return fila.precioTexto.trim() !== fila.precioOriginalTexto;
  }

  // Pantalla a ancho completo (html[data-wide='grid'] en styles.scss) — mismo
  // criterio que Productos: puede haber muchas filas, una por producto activo.
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid');
    this.tipoListaPrecioId = Number(this.route.snapshot.paramMap.get('id'));
    this.data.getById<TipoListaPrecio>('TipoListaPrecio', this.tipoListaPrecioId).subscribe((t) => this.tipoListaPrecio.set(t));
    this.cargar();
  }

  volver(): void {
    this.location.back();
  }

  cargar(): void {
    this.cargando.set(true);
    Promise.all([
      firstValueFrom(this.data.list<Producto>('Producto')),
      firstValueFrom(this.data.list<CategoriaProducto>('CategoriaProducto')),
      firstValueFrom(this.data.list<PrecioLista>('PrecioLista', { tipoListaPrecioId: this.tipoListaPrecioId })),
    ]).then(([productos, categorias, precios]) => {
      const nombreCategoria = (id: number) => categorias.find((c) => c.id === id)?.nombre ?? '—';
      const filas: FilaPrecioLista[] = productos
        .filter((p) => p.activo !== false)
        .map((p) => {
          const precioExistente = precios.find((pl) => pl.productoId === p.id) ?? null;
          const texto = precioExistente ? String(precioExistente.precio) : '';
          return {
            productoId: p.id,
            codigo: p.codigo ?? '',
            nombre: p.nombre,
            categoriaNombre: nombreCategoria(p.categoriaProductoId),
            precioBase: p.precioUnitario,
            precioListaId: precioExistente?.id ?? null,
            precioTexto: texto,
            precioOriginalTexto: texto,
          };
        })
        .sort((a, b) => a.nombre.localeCompare(b.nombre));
      this.filas.set(filas);
      this.cargando.set(false);
    });
  }

  cambiarPrecio(productoId: number, texto: string): void {
    this.filas.update((filas) => filas.map((f) => (f.productoId === productoId ? { ...f, precioTexto: texto } : f)));
  }

  descartarCambios(): void {
    this.filas.update((filas) => filas.map((f) => ({ ...f, precioTexto: f.precioOriginalTexto })));
  }

  /** Guarda en bloque solo las filas con cambios (ver filasModificadas): deja
   *  el campo vacío borra el precio especial (vuelve a usar el precio base
   *  del producto); un número válido crea o actualiza su PrecioLista. Recorre
   *  las peticiones una por una (mismo patrón que la importación masiva de
   *  Productos) para poder mostrar progreso y no saturar IndexedDB con
   *  muchas escrituras simultáneas. */
  async guardarCambios(): Promise<void> {
    const modificadas = this.filasModificadas();
    if (modificadas.length === 0) return;

    this.guardando.set(true);
    for (let i = 0; i < modificadas.length; i++) {
      const fila = modificadas[i];
      this.progresoGuardado.set(`Guardando ${i + 1}/${modificadas.length}: ${fila.nombre}…`);
      const texto = fila.precioTexto.trim();
      if (texto === '') {
        if (fila.precioListaId !== null) {
          await firstValueFrom(this.data.baja('PrecioLista', fila.precioListaId));
        }
        continue;
      }
      const precio = Number(texto);
      if (Number.isNaN(precio) || precio < 0) continue; // el input ya valida, pero por si acaso no se manda basura
      if (fila.precioListaId !== null) {
        await firstValueFrom(
          this.data.modificacion<PrecioLista>('PrecioLista', { id: fila.precioListaId, tipoListaPrecioId: this.tipoListaPrecioId, productoId: fila.productoId, precio }),
        );
      } else {
        await firstValueFrom(
          this.data.alta<PrecioLista>('PrecioLista', { tipoListaPrecioId: this.tipoListaPrecioId, productoId: fila.productoId, precio }),
        );
      }
    }

    this.guardando.set(false);
    this.progresoGuardado.set('');
    this.toast.exito(`${modificadas.length} precio${modificadas.length === 1 ? '' : 's'} guardado${modificadas.length === 1 ? '' : 's'}.`);
    this.cargar();
  }
}

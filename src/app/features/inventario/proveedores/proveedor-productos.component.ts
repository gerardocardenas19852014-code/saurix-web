import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { ToastService } from '../../../shared/services/toast.service';
import { Producto } from '../productos/producto.model';
import { CategoriaProducto } from '../categorias-producto/categoria-producto.model';
import { Proveedor } from './proveedor.model';
import { ProductoProveedor } from './producto-proveedor.model';

/** Una fila de la tabla: un Producto activo, con el precio de compra y
 *  tiempo de entrega que tiene para ESTE proveedor concreto (editables) —
 *  `productoProveedorId` es null cuando el producto todavía no tiene un
 *  registro de ProductoProveedor para este proveedor. `preferido` es el
 *  estado YA GUARDADO (no pasa por "Guardar cambios": ver marcarPreferido(),
 *  que escribe de inmediato porque además tiene que tocar otras filas).
 *  Mismo patrón exacto que FilaPrecioLista en lista-precio-detalle.component.ts. */
interface FilaProveedorProducto {
  productoId: number;
  codigo: string;
  nombre: string;
  categoriaNombre: string;
  productoProveedorId: number | null;
  precioCompraTexto: string;
  precioCompraOriginalTexto: string;
  tiempoEntregaTexto: string;
  tiempoEntregaOriginalTexto: string;
  preferido: boolean;
}

@Component({
  selector: 'app-proveedor-productos',
  standalone: true,
  imports: [],
  templateUrl: './proveedor-productos.component.html',
  styleUrl: './proveedor-productos.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProveedorProductosComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly data = inject(DataClientService);
  private readonly location = inject(Location);
  protected readonly toast = inject(ToastService);

  private proveedorId!: number;
  protected readonly proveedor = signal<Proveedor | null>(null);

  protected readonly filas = signal<FilaProveedorProducto[]>([]);
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

  protected estaModificada(fila: FilaProveedorProducto): boolean {
    return (
      fila.precioCompraTexto.trim() !== fila.precioCompraOriginalTexto ||
      fila.tiempoEntregaTexto.trim() !== fila.tiempoEntregaOriginalTexto
    );
  }

  // Pantalla a ancho completo (html[data-wide='grid'] en styles.scss) — mismo
  // criterio que Listas de precio: puede haber muchas filas, una por producto activo.
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid');
    this.proveedorId = Number(this.route.snapshot.paramMap.get('id'));
    this.data.getById<Proveedor>('Proveedor', this.proveedorId).subscribe((p) => this.proveedor.set(p));
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
      firstValueFrom(this.data.list<ProductoProveedor>('ProductoProveedor', { proveedorId: this.proveedorId })),
    ]).then(([productos, categorias, asignaciones]) => {
      const nombreCategoria = (id: number) => categorias.find((c) => c.id === id)?.nombre ?? '—';
      const filas: FilaProveedorProducto[] = productos
        .filter((p) => p.activo !== false)
        .map((p) => {
          const existente = asignaciones.find((a) => a.productoId === p.id) ?? null;
          // Si el producto todavía no tiene NINGÚN ProductoProveedor y este
          // es su proveedor "heredado" (Producto.proveedorId), se precarga
          // esa fila como preferida sin precio/tiempo capturados todavía —
          // mismo espíritu que existenciaTotal() en producto.util.ts: no se
          // pierde la asignación que ya existía al pasar al nuevo modelo.
          const esHeredado = !existente && p.proveedorId === this.proveedorId;
          const precioTexto = existente ? String(existente.precioCompra) : '';
          const tiempoTexto = existente?.tiempoEntregaDias != null ? String(existente.tiempoEntregaDias) : '';
          return {
            productoId: p.id,
            codigo: p.codigo ?? '',
            nombre: p.nombre,
            categoriaNombre: nombreCategoria(p.categoriaProductoId),
            productoProveedorId: existente?.id ?? null,
            precioCompraTexto: precioTexto,
            precioCompraOriginalTexto: precioTexto,
            tiempoEntregaTexto: tiempoTexto,
            tiempoEntregaOriginalTexto: tiempoTexto,
            preferido: existente?.preferido ?? esHeredado,
          };
        })
        .sort((a, b) => a.nombre.localeCompare(b.nombre));
      this.filas.set(filas);
      this.cargando.set(false);
    });
  }

  cambiarPrecio(productoId: number, texto: string): void {
    this.filas.update((filas) => filas.map((f) => (f.productoId === productoId ? { ...f, precioCompraTexto: texto } : f)));
  }

  cambiarTiempoEntrega(productoId: number, texto: string): void {
    this.filas.update((filas) => filas.map((f) => (f.productoId === productoId ? { ...f, tiempoEntregaTexto: texto } : f)));
  }

  descartarCambios(): void {
    this.filas.update((filas) =>
      filas.map((f) => ({ ...f, precioCompraTexto: f.precioCompraOriginalTexto, tiempoEntregaTexto: f.tiempoEntregaOriginalTexto })),
    );
  }

  /** Guarda en bloque solo las filas con cambios de precio/tiempo — mismo
   *  patrón exacto que guardarCambios() en lista-precio-detalle.component.ts. */
  async guardarCambios(): Promise<void> {
    const modificadas = this.filasModificadas();
    if (modificadas.length === 0) return;

    this.guardando.set(true);
    for (let i = 0; i < modificadas.length; i++) {
      const fila = modificadas[i];
      this.progresoGuardado.set(`Guardando ${i + 1}/${modificadas.length}: ${fila.nombre}…`);
      const precio = Number(fila.precioCompraTexto.trim() || 0);
      const tiempoTexto = fila.tiempoEntregaTexto.trim();
      const tiempoEntregaDias = tiempoTexto === '' ? null : Number(tiempoTexto);
      if (Number.isNaN(precio) || precio < 0 || (tiempoEntregaDias !== null && Number.isNaN(tiempoEntregaDias))) continue;

      if (fila.productoProveedorId !== null) {
        await firstValueFrom(
          this.data.modificacion<ProductoProveedor>('ProductoProveedor', {
            id: fila.productoProveedorId,
            productoId: fila.productoId,
            proveedorId: this.proveedorId,
            precioCompra: precio,
            tiempoEntregaDias,
            preferido: fila.preferido,
          }),
        );
      } else {
        await firstValueFrom(
          this.data.alta<ProductoProveedor>('ProductoProveedor', {
            productoId: fila.productoId,
            proveedorId: this.proveedorId,
            precioCompra: precio,
            tiempoEntregaDias,
            preferido: fila.preferido,
          }),
        );
      }
    }

    this.guardando.set(false);
    this.progresoGuardado.set('');
    this.toast.exito(`${modificadas.length} producto${modificadas.length === 1 ? '' : 's'} guardado${modificadas.length === 1 ? '' : 's'}.`);
    this.cargar();
  }

  /** Marca este proveedor como el preferido de un producto, de inmediato
   *  (no espera a "Guardar cambios"): crea/actualiza su ProductoProveedor
   *  aquí con preferido=true, y le quita la bandera a cualquier OTRO
   *  proveedor que el producto ya tuviera marcado como preferido — por eso
   *  no puede ser parte del guardado en bloque, que solo toca filas de ESTE
   *  proveedor. */
  async marcarPreferido(fila: FilaProveedorProducto): Promise<void> {
    if (fila.preferido) return;
    this.guardando.set(true);
    this.progresoGuardado.set(`Marcando ${fila.nombre} como preferido…`);
    try {
      const precio = Number(fila.precioCompraTexto.trim() || 0);
      const tiempoTexto = fila.tiempoEntregaTexto.trim();
      const tiempoEntregaDias = tiempoTexto === '' ? null : Number(tiempoTexto);

      const todas = await firstValueFrom(this.data.list<ProductoProveedor>('ProductoProveedor', { productoId: fila.productoId }));
      const otraPreferida = todas.find((a) => a.preferido && a.proveedorId !== this.proveedorId);
      if (otraPreferida) {
        await firstValueFrom(this.data.modificacion<ProductoProveedor>('ProductoProveedor', { ...otraPreferida, preferido: false }));
      }

      if (fila.productoProveedorId !== null) {
        await firstValueFrom(
          this.data.modificacion<ProductoProveedor>('ProductoProveedor', {
            id: fila.productoProveedorId,
            productoId: fila.productoId,
            proveedorId: this.proveedorId,
            precioCompra: precio,
            tiempoEntregaDias,
            preferido: true,
          }),
        );
      } else {
        await firstValueFrom(
          this.data.alta<ProductoProveedor>('ProductoProveedor', {
            productoId: fila.productoId,
            proveedorId: this.proveedorId,
            precioCompra: precio,
            tiempoEntregaDias,
            preferido: true,
          }),
        );
      }
      this.toast.exito(`${fila.nombre}: proveedor preferido actualizado.`);
    } finally {
      this.guardando.set(false);
      this.progresoGuardado.set('');
      this.cargar();
    }
  }
}

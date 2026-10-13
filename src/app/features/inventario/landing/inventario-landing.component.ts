import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Mismo criterio de color que el selector de módulos (modulos.component.ts):
 *  una de las clases .module-tile-* definidas en styles.scss. */
type ColorIcono = 'accent' | 'slate';

interface EnlaceModulo {
  ruta: string;
  icono: string;
  color: ColorIcono;
  titulo: string;
  descripcion: string;
}

interface GrupoModulo {
  titulo: string;
  enlaces: EnlaceModulo[];
}

// Etapas de Inventario: Productos/Servicios + catálogos base ya construidos
// desde el inicio; Listas de precio, Valor de stock y Movimientos entre
// bodegas se agregaron después, uno a la vez, confirmando el alcance con el
// usuario antes de construir cada uno. La existencia por bodega vive en
// ExistenciaBodega (ver existencia-bodega.model.ts) — Producto.existencia
// solo sigue siendo la cifra "heredada" mientras un producto no tenga
// todavía ninguna bodega asignada (ver existenciaTotal() en producto.util.ts)
// — mismo criterio de agrupado que Proyectos/WikiDocs (ver
// proyectos-landing.component.ts/wikidocs-landing.component.ts).
const GRUPOS: GrupoModulo[] = [
  {
    titulo: 'Operación',
    enlaces: [
      {
        ruta: 'productos',
        icono: '📦',
        color: 'accent',
        titulo: 'Productos y servicios',
        descripcion: 'Catálogo de productos y servicios, con importación masiva desde CSV.',
      },
      {
        ruta: 'valor-stock',
        icono: '📊',
        color: 'accent',
        titulo: 'Valor de stock',
        descripcion: 'Valor del inventario (costo × existencia), por producto y por categoría.',
      },
      {
        ruta: 'movimientos-bodega',
        icono: '🚚',
        color: 'accent',
        titulo: 'Movimientos entre bodegas',
        descripcion: 'Entradas y traspasos de existencia entre bodegas, con historial.',
      },
      {
        ruta: 'sugerencia-reposicion',
        icono: '🧾',
        color: 'accent',
        titulo: 'Sugerencia de reposición',
        descripcion: 'Qué comprar y a quién — productos por debajo de su nivel mínimo, con cantidad sugerida.',
      },
      {
        ruta: 'conteo-fisico',
        icono: '🧮',
        color: 'accent',
        titulo: 'Conteo físico',
        descripcion: 'Cuadra la existencia de una bodega contra un conteo real y registra el ajuste automáticamente.',
      },
    ],
  },
  {
    titulo: 'Catálogos',
    enlaces: [
      {
        ruta: 'bodegas',
        icono: '🏬',
        color: 'slate',
        titulo: 'Bodegas',
        descripcion: 'Bodegas/almacenes físicos (catálogo — operar inventario por bodega llega después).',
      },
      {
        ruta: 'proveedores',
        icono: '🚛',
        color: 'slate',
        titulo: 'Proveedores',
        descripcion: 'A quién comprarle cada producto — se asigna desde el formulario de Productos.',
      },
      {
        ruta: 'categorias-producto',
        icono: '🏷️',
        color: 'slate',
        titulo: 'Categorías de producto',
        descripcion: 'Categorías para clasificar productos y servicios.',
      },
      {
        ruta: 'unidades-medida',
        icono: '📏',
        color: 'slate',
        titulo: 'Unidades de medida',
        descripcion: 'Pieza, Kilogramo, Litro, Caja, Hora… las unidades en las que se vende cada producto.',
      },
      {
        ruta: 'tipos-lista-precio',
        icono: '💲',
        color: 'slate',
        titulo: 'Tipos de lista de precio',
        descripcion: 'Segmentos de lista de precio (General, Mayoreo, Distribuidor…) — da clic en "Ver precios" en cada uno para asignar precios por producto.',
      },
    ],
  },
];

@Component({
  selector: 'app-inventario-landing',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './inventario-landing.component.html',
  styleUrl: './inventario-landing.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InventarioLandingComponent {
  protected readonly grupos = GRUPOS;
}

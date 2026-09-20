import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

interface EnlaceComercio {
  ruta: string;
  icono: string;
  eyebrow: string;
  titulo: string;
  descripcion: string;
}

const ENLACES: EnlaceComercio[] = [
  {
    ruta: 'categorias-producto',
    icono: '🏷️',
    eyebrow: 'Comercio',
    titulo: 'Categorías de Producto',
    descripcion: 'Catálogo de categorías para clasificar los productos.',
  },
  {
    ruta: 'productos',
    icono: '📦',
    eyebrow: 'Comercio',
    titulo: 'Productos',
    descripcion: 'Catálogo de productos y servicios, con precio e inventario.',
  },
  {
    ruta: 'clientes',
    icono: '👥',
    eyebrow: 'Comercio',
    titulo: 'Clientes',
    descripcion: 'Directorio de clientes.',
  },
  {
    ruta: 'cotizaciones',
    icono: '📝',
    eyebrow: 'Comercio',
    titulo: 'Cotizaciones',
    descripcion: 'Cotizaciones con partidas, exportables a PDF y convertibles a venta.',
  },
  {
    ruta: 'ventas',
    icono: '💰',
    eyebrow: 'Comercio',
    titulo: 'Ventas',
    descripcion: 'Registro de ventas con partidas y exportación a PDF.',
  },
];

/**
 * Módulo compartido entre todo el equipo: cualquiera con permiso puede ver
 * y editar clientes, productos, cotizaciones y ventas (el vendedor es solo
 * informativo).
 */
@Component({
  selector: 'app-comercio-landing',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './comercio-landing.component.html',
  styleUrl: './comercio-landing.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComercioLandingComponent {
  protected readonly enlaces = ENLACES;
}

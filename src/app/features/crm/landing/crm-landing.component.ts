import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

type ColorIcono = 'siif' | 'personal' | 'generic';

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

/**
 * CRM absorbe lo que antes era el módulo "Comercio": Clientes/Cotizaciones/
 * Ventas viven aquí como el grupo "Ventas" (mismos componentes de siempre,
 * en features/comercio/, solo reubicados bajo esta landing y estas rutas —
 * ver crm.routes.ts). El resto de los grupos son nuevos.
 *
 * Grupos pendientes de agregar conforme se construyan (no se listan
 * todavía para no dejar tarjetas rotas apuntando a rutas que no existen):
 * Pipeline de oportunidades, Casos de servicio, Campañas de marketing.
 */
const GRUPOS: GrupoModulo[] = [
  {
    titulo: 'Leads',
    enlaces: [
      {
        ruta: 'leads',
        icono: '🧲',
        color: 'generic',
        titulo: 'Leads',
        descripcion: 'Prospectos antes de convertirse en Cliente — seguimiento por estado y origen.',
      },
      {
        ruta: 'leads/origenes',
        icono: '📡',
        color: 'generic',
        titulo: 'Orígenes de lead',
        descripcion: 'Catálogo de de dónde llegan los prospectos (web, referido, feria, etc.).',
      },
    ],
  },
  {
    titulo: 'Ventas',
    enlaces: [
      {
        ruta: 'clientes',
        icono: '👥',
        color: 'personal',
        titulo: 'Clientes',
        descripcion: 'Directorio de clientes.',
      },
      {
        ruta: 'cotizaciones',
        icono: '📝',
        color: 'personal',
        titulo: 'Cotizaciones',
        descripcion: 'Cotizaciones con partidas, exportables a PDF y convertibles a venta.',
      },
      {
        ruta: 'ventas',
        icono: '💰',
        color: 'personal',
        titulo: 'Ventas',
        descripcion: 'Registro de ventas con partidas y exportación a PDF.',
      },
      {
        ruta: 'productos',
        icono: '📦',
        color: 'personal',
        titulo: 'Productos',
        descripcion: 'Catálogo de productos y servicios, con precio e inventario.',
      },
      {
        ruta: 'categorias-producto',
        icono: '🏷️',
        color: 'personal',
        titulo: 'Categorías de Producto',
        descripcion: 'Catálogo de categorías para clasificar los productos.',
      },
    ],
  },
];

@Component({
  selector: 'app-crm-landing',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './crm-landing.component.html',
  styleUrl: './crm-landing.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CrmLandingComponent {
  protected readonly grupos = GRUPOS;
}

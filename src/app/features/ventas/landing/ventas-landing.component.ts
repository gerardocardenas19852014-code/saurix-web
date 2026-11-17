import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

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

/** Mismo criterio de agrupado que InventarioLandingComponent: Inicio es
 *  solo un índice de pantallas, con Proceso (el día a día de ventas),
 *  Administración y Catálogos (lo que se configura de vez en cuando) separados.
 *
 *  Mandato 86 (Fase A, nov-2026): se retiraron del todo Apertura/Corte/
 *  Cierre de caja — ya no existen ni como pantallas ni como tarjetas aquí. */
const GRUPOS: GrupoModulo[] = [
  {
    titulo: 'Proceso',
    enlaces: [
      {
        ruta: 'cobro',
        icono: '🧾',
        color: 'accent',
        titulo: 'Cobro',
        descripcion: 'Pantalla de venta — captura rápida, pensada para móvil/touch.',
      },
      {
        ruta: 'cotizaciones',
        icono: '📝',
        color: 'accent',
        titulo: 'Cotizaciones',
        descripcion: 'Propuestas de precio que no afectan inventario hasta convertirse en venta.',
      },
      {
        ruta: 'pedidos-tienda',
        icono: '🛍️',
        color: 'accent',
        titulo: 'Pedidos web',
        descripcion: 'Pedidos recibidos desde tu tienda pública — confirma para registrar la venta o descarta.',
      },
      {
        ruta: 'cuentas-por-cobrar',
        icono: '💳',
        color: 'accent',
        titulo: 'Cuentas por cobrar',
        descripcion: 'Ventas a crédito — registra los abonos del cliente conforme va pagando.',
      },
    ],
  },
  {
    titulo: 'Reportes',
    enlaces: [
      {
        ruta: 'historial',
        icono: '🧾',
        color: 'accent',
        titulo: 'Historial de ventas',
        descripcion: 'Ventas registradas, su detalle, reimpresión de ticket y cancelación.',
      },
      {
        ruta: 'dashboard',
        icono: '📊',
        color: 'accent',
        titulo: 'Dashboard',
        descripcion: 'Ventas de hoy, ticket promedio, método de pago y productos más vendidos.',
      },
      {
        ruta: 'reporte-comisiones',
        icono: '🤝',
        color: 'accent',
        titulo: 'Reporte de comisiones',
        descripcion: 'Comisión a pagar por vendedor en un periodo, según lo configurado en Catálogos.',
      },
    ],
  },
  {
    titulo: 'Administración',
    enlaces: [
      {
        ruta: 'clientes',
        icono: '👤',
        color: 'slate',
        titulo: 'Clientes',
        descripcion: 'Contactos con datos fiscales para facturar — incluye "Público en General".',
      },
      {
        ruta: 'configuracion-lealtad',
        icono: '🎁',
        color: 'slate',
        titulo: 'Programa de lealtad',
        descripcion: 'Activa o desactiva el programa de puntos y define cuánto vale cada punto.',
      },
    ],
  },
  {
    titulo: 'Catálogos',
    enlaces: [
      {
        ruta: 'regimenes-fiscales',
        icono: '🧾',
        color: 'slate',
        titulo: 'Regímenes fiscales',
        descripcion: 'Catálogo editable de regímenes fiscales del SAT, para el formulario de Clientes.',
      },
      {
        ruta: 'comisiones-vendedores',
        icono: '🤝',
        color: 'slate',
        titulo: 'Comisiones de vendedores',
        descripcion: 'Porcentaje o monto fijo de comisión por vendedor.',
      },
    ],
  },
];

@Component({
  selector: 'app-ventas-landing',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './ventas-landing.component.html',
  styleUrl: './ventas-landing.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VentasLandingComponent {
  protected readonly grupos = signal(GRUPOS);
}

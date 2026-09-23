import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Mismo criterio de color que Proyectos (proyectos-landing.component.ts):
 *  una de las clases .module-tile-* definidas en styles.scss, una por grupo. */
type ColorIcono = 'indigo' | 'slate' | 'teal';

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

// Agrupación y orden calcados del menú lateral (ver shell.component.html):
// "Movimientos" (el día a día), "Metas y límites" y "Reportes" — mismo
// patrón que la pantalla de Inicio de Gestión de Proyectos
// (proyectos-landing.component.ts), incluida la asignación de color por
// grupo (1º indigo, 2º slate, 3º teal).
const GRUPOS: GrupoModulo[] = [
  {
    titulo: 'Movimientos',
    enlaces: [
      {
        ruta: 'movimientos',
        icono: '💸',
        color: 'indigo',
        titulo: 'Movimientos',
        descripcion: 'Registro de ingresos, gastos y transferencias entre cuentas.',
      },
      {
        ruta: 'recurrentes',
        icono: '🔁',
        color: 'indigo',
        titulo: 'Fijos y Proyección',
        descripcion: 'Ingresos y gastos recurrentes: renta, nómina, suscripciones, etc.',
      },
      {
        ruta: 'deudas',
        icono: '🏦',
        color: 'indigo',
        titulo: 'Deudas',
        descripcion: 'Préstamos personales, de auto, etc. — con historial real de abonos.',
      },
    ],
  },
  {
    titulo: 'Metas y límites',
    enlaces: [
      {
        ruta: 'metas',
        icono: '🏆',
        color: 'slate',
        titulo: 'Metas de ahorro',
        descripcion: 'Objetivos de ahorro con seguimiento de tus aportes.',
      },
      {
        ruta: 'limites',
        icono: '🎯',
        color: 'slate',
        titulo: 'Límites de gasto',
        descripcion: 'Tope mensual de gasto por categoría o general.',
      },
    ],
  },
  {
    titulo: 'Reportes',
    enlaces: [
      {
        ruta: 'proyeccion',
        icono: '📈',
        color: 'teal',
        titulo: 'Proyección',
        descripcion: 'Flujo de efectivo a futuro por quincena, editable a mano.',
      },
      {
        ruta: 'reportes',
        icono: '📊',
        color: 'teal',
        titulo: 'Reportes',
        descripcion: 'Ingresos vs. gastos, gasto por categoría y patrimonio neto histórico.',
      },
      {
        ruta: 'calendario',
        icono: '📅',
        color: 'teal',
        titulo: 'Calendario de pagos',
        descripcion: 'Próximos fijos y próximo pago de cada tarjeta, a 60 días.',
      },
    ],
  },
];

@Component({
  selector: 'app-presupuesto-inicio',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './presupuesto-inicio.component.html',
  styleUrl: './presupuesto-inicio.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PresupuestoInicioComponent {
  protected readonly grupos = GRUPOS;
}

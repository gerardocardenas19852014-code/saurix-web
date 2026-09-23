import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Mismo criterio de color que el selector de módulos (modulos.component.ts):
 *  una de las clases .module-tile-* definidas en styles.scss. */
type ColorIcono = 'indigo' | 'slate' | 'teal';

interface EnlaceModulo {
  ruta: string;
  icono: string;
  color: ColorIcono;
  titulo: string;
  descripcion: string;
  grupo: string;
}

interface GrupoModulo {
  titulo: string;
  enlaces: EnlaceModulo[];
}

// Los catálogos propios de este módulo (Tipos de Ticket, Prioridades,
// Motivos de Solución) se administran desde Catálogos — mismo dato, una
// sola pantalla de administración, para no duplicar mantenimiento. El
// Gestor de Estados (columnas del tablero) sí vive aquí, en Proyectos.
//
// Agrupación y orden pedidos explícitamente por el usuario (mismo agrupado que
// el menú lateral, ver shell.component.html): "Procesos" (el día a día con
// tickets), "Configuración" (catálogos/ajustes del propio módulo) y "Reportes".
const GRUPOS: GrupoModulo[] = [
  {
    titulo: 'Procesos',
    enlaces: [
      {
        ruta: 'tablero',
        icono: '🗂️',
        color: 'indigo',
        titulo: 'Ticket',
        descripcion: 'Vista de tickets por estado, organizados en columnas.',
        grupo: 'Procesos',
      },
      {
        ruta: 'backlog',
        icono: '📋',
        color: 'indigo',
        titulo: 'Backlog',
        descripcion: 'Tickets sin sprint asignado y planeación de sprints por proyecto.',
        grupo: 'Procesos',
      },
    ],
  },
  {
    titulo: 'Configuración',
    enlaces: [
      {
        ruta: 'gestor-estados',
        icono: '🧭',
        color: 'slate',
        titulo: 'Gestor de Estados',
        descripcion: 'Columnas del tablero Kanban de cada proyecto, con permisos y campos configurables por columna.',
        grupo: 'Configuración',
      },
      {
        ruta: 'proyectos',
        icono: '📁',
        color: 'slate',
        titulo: 'Proyectos',
        descripcion: 'Alta y edición de los proyectos que tienen su propio tablero Kanban.',
        grupo: 'Configuración',
      },
    ],
  },
  {
    titulo: 'Reportes',
    enlaces: [
      {
        ruta: 'dashboard',
        icono: '📊',
        color: 'teal',
        titulo: 'Mi Dashboard',
        descripcion: 'Tus tickets asignados, avisos de vigencia (SLA) y horas registradas.',
        grupo: 'Reportes',
      },
      {
        ruta: 'reportes-horas',
        icono: '⏱️',
        color: 'teal',
        titulo: 'Reporte de Horas',
        descripcion: 'Horas registradas por usuario, por proyecto y por ticket.',
        grupo: 'Reportes',
      },
      {
        ruta: 'gantt',
        icono: '📅',
        color: 'teal',
        titulo: 'Gantt',
        descripcion: 'Línea de tiempo de los tickets de un proyecto.',
        grupo: 'Reportes',
      },
      {
        ruta: 'resumen-ejecutivo',
        icono: '📈',
        color: 'teal',
        titulo: 'Resumen ejecutivo',
        descripcion: 'Salud de cada proyecto, estimado vs. horas reales, carga del equipo y cuellos de botella.',
        grupo: 'Reportes',
      },
      {
        ruta: 'balanceo',
        icono: '⚖️',
        color: 'teal',
        titulo: 'Balanceo',
        descripcion: 'Carga de trabajo pendiente por persona y prioridad, para decidir a quién asignar y reasignar tickets entre proyectos.',
        grupo: 'Reportes',
      },
      {
        ruta: 'reportes-ejecutivos',
        icono: '📊',
        color: 'teal',
        titulo: 'Reportes ejecutivos',
        descripcion: 'Trabajo hecho, trabajo pendiente, reporte de sprint, velocidad, flujo acumulado y gráfica de control — para nivel directivo.',
        grupo: 'Reportes',
      },
    ],
  },
];

@Component({
  selector: 'app-proyectos-landing',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './proyectos-landing.component.html',
  styleUrl: './proyectos-landing.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProyectosLandingComponent {
  protected readonly grupos = GRUPOS;
}

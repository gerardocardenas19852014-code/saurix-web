import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

type ColorIcono = 'siif' | 'personal' | 'generic';

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
const GRUPOS: GrupoModulo[] = [
  {
    titulo: 'Proyectos',
    enlaces: [
      {
        ruta: 'tablero',
        icono: '🗂️',
        color: 'siif',
        titulo: 'Ticket',
        descripcion: 'Vista de tickets por estado, organizados en columnas.',
        grupo: 'Proyectos',
      },
      {
        ruta: 'proyectos',
        icono: '📁',
        color: 'siif',
        titulo: 'Proyectos',
        descripcion: 'Alta y edición de los proyectos que tienen su propio tablero Kanban.',
        grupo: 'Proyectos',
      },
      {
        ruta: 'backlog',
        icono: '📋',
        color: 'siif',
        titulo: 'Backlog',
        descripcion: 'Tickets sin sprint asignado y planeación de sprints por proyecto.',
        grupo: 'Proyectos',
      },
      {
        ruta: 'gestor-estados',
        icono: '🧭',
        color: 'siif',
        titulo: 'Gestor de Estados',
        descripcion: 'Columnas del tablero Kanban de cada proyecto, con permisos y campos configurables por columna.',
        grupo: 'Proyectos',
      },
    ],
  },
  {
    titulo: 'Reportes',
    enlaces: [
      {
        ruta: 'dashboard',
        icono: '📊',
        color: 'personal',
        titulo: 'Mi Dashboard',
        descripcion: 'Tus tickets asignados, avisos de vigencia (SLA) y horas registradas.',
        grupo: 'Reportes',
      },
      {
        ruta: 'reportes-horas',
        icono: '⏱️',
        color: 'personal',
        titulo: 'Reportes de horas',
        descripcion: 'Horas registradas por usuario, por proyecto y por ticket.',
        grupo: 'Reportes',
      },
      {
        ruta: 'gantt',
        icono: '📅',
        color: 'personal',
        titulo: 'Gantt',
        descripcion: 'Línea de tiempo de los tickets de un proyecto.',
        grupo: 'Reportes',
      },
      {
        ruta: 'resumen-ejecutivo',
        icono: '📈',
        color: 'personal',
        titulo: 'Resumen ejecutivo',
        descripcion: 'Salud de cada proyecto, estimado vs. horas reales, carga del equipo y cuellos de botella.',
        grupo: 'Reportes',
      },
      {
        ruta: 'balanceo',
        icono: '⚖️',
        color: 'personal',
        titulo: 'Balanceo',
        descripcion: 'Carga de trabajo pendiente por persona y prioridad, para decidir a quién asignar y reasignar tickets entre proyectos.',
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

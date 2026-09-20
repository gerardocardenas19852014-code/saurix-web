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

const GRUPOS: GrupoModulo[] = [
  {
    titulo: 'Proyectos',
    enlaces: [
      {
        ruta: 'tablero',
        icono: '🗂️',
        color: 'siif',
        titulo: 'Tablero Kanban',
        descripcion: 'Vista de tickets por estado, con arrastrar y soltar entre columnas.',
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
        ruta: 'tableros',
        icono: '🧭',
        color: 'siif',
        titulo: 'Gestor de Estados',
        descripcion: 'Columnas del tablero de cada proyecto, con permisos de pestañas por columna.',
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
    ],
  },
  {
    titulo: 'Catálogos',
    enlaces: [
      {
        ruta: 'tipos-ticket',
        icono: '🏷️',
        color: 'generic',
        titulo: 'Tipos de Ticket',
        descripcion: 'Catálogo compartido de tipos de ticket (bug, tarea, mejora, etc.).',
        grupo: 'Catálogos',
      },
      {
        ruta: 'prioridades',
        icono: '🚦',
        color: 'generic',
        titulo: 'Prioridades',
        descripcion: 'Prioridades de ticket, con su color, vigencia (SLA) y usuarios a avisar.',
        grupo: 'Catálogos',
      },
      {
        ruta: 'motivos-solucion',
        icono: '✅',
        color: 'generic',
        titulo: 'Motivos de Solución',
        descripcion: 'Catálogo compartido de motivos usados al resolver un ticket.',
        grupo: 'Catálogos',
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

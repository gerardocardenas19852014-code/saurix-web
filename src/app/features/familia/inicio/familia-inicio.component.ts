import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Mismo criterio de color que Presupuesto/Proyectos (ver presupuesto-inicio.component.ts):
 *  una de las clases .module-tile-* definidas en styles.scss, una por grupo. */
type ColorIcono = 'indigo' | 'amber';

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

const GRUPOS: GrupoModulo[] = [
  {
    titulo: 'Miembros',
    enlaces: [
      {
        ruta: 'miembros',
        icono: '👪',
        color: 'indigo',
        titulo: 'Miembros de familia',
        descripcion: 'Datos, RFC/CURP, documentos, salud, pólizas y tarjeta de emergencia de cada quien.',
      },
      {
        ruta: 'arbol',
        icono: '🌳',
        color: 'indigo',
        titulo: 'Árbol genealógico',
        descripcion: 'Visualiza cómo se relacionan los miembros de familia entre sí.',
      },
      {
        ruta: 'calendario',
        icono: '📅',
        color: 'indigo',
        titulo: 'Calendario familiar',
        descripcion: 'Cumpleaños, documentos y pólizas por vencer, citas médicas y eventos, por mes.',
      },
      {
        ruta: 'resumen',
        icono: '🔔',
        color: 'indigo',
        titulo: 'Resumen',
        descripcion: 'Lo más próximo de toda la familia en una sola lista, ordenado por cercanía.',
      },
    ],
  },
  {
    titulo: 'Hogar',
    enlaces: [
      {
        ruta: 'tramites',
        icono: '🗒️',
        color: 'indigo',
        titulo: 'Trámites familiares',
        descripcion: 'Checklist tipo tablero para pasaportes, inscripciones y trámites de gobierno.',
      },
      {
        ruta: 'tareas',
        icono: '🧹',
        color: 'indigo',
        titulo: 'Tareas del hogar',
        descripcion: 'Quehaceres con responsable y frecuencia.',
      },
    ],
  },
  {
    titulo: 'Catálogos',
    enlaces: [
      {
        ruta: 'parentesco',
        icono: '👤',
        color: 'amber',
        titulo: 'Parentesco',
        descripcion: 'Catálogo de parentescos disponibles para los miembros de familia.',
      },
      {
        ruta: 'tipo-documento',
        icono: '🗂️',
        color: 'amber',
        titulo: 'Tipo de documento',
        descripcion: 'Catálogo de tipos de documento (INE, pasaporte, póliza de seguro, etc.).',
      },
      {
        ruta: 'sexo',
        icono: '🚻',
        color: 'amber',
        titulo: 'Sexo',
        descripcion: 'Catálogo de sexo — mismas claves que usa el cálculo de RFC/CURP.',
      },
      {
        ruta: 'entidad-nacimiento',
        icono: '🗺️',
        color: 'amber',
        titulo: 'Entidad de nacimiento',
        descripcion: 'Catálogo de entidades federativas — mismas claves que usa el cálculo de RFC/CURP.',
      },
      {
        ruta: 'tipo-sangre',
        icono: '🩸',
        color: 'amber',
        titulo: 'Tipo de sangre',
        descripcion: 'Catálogo de tipos de sangre para la tarjeta de emergencia.',
      },
      {
        ruta: 'proveedor-salud',
        icono: '🏥',
        color: 'amber',
        titulo: 'Proveedores de salud',
        descripcion: 'Médicos, clínicas y hospitales que se pueden elegir al capturar una cita médica.',
      },
    ],
  },
];

@Component({
  selector: 'app-familia-inicio',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './familia-inicio.component.html',
  styleUrl: './familia-inicio.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FamiliaInicioComponent {
  protected readonly grupos = GRUPOS;
}

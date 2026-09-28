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
        descripcion: 'Datos, RFC/CURP, documentos y tarjeta de emergencia de cada quien.',
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

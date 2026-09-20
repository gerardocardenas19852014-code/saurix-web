import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

type ColorIcono = 'siif' | 'personal' | 'generic';

interface EnlaceSeguridad {
  ruta: string;
  icono: string;
  color: ColorIcono;
  titulo: string;
  descripcion: string;
}

const ENLACES: EnlaceSeguridad[] = [
  {
    ruta: 'usuarios',
    icono: '👤',
    color: 'personal',
    titulo: 'Usuarios',
    descripcion: 'Alta, edición y baja de usuarios del sistema.',
  },
];

/**
 * Landing de Seguridad: misma lista compacta que la landing de Catálogos
 * (.catalog-list / .catalog-list-item), para que ambos módulos luzcan
 * consistentes. No lleva buscador ni grupos porque, a diferencia de
 * Catálogos, Seguridad solo tiene una entrada (Usuarios) por ahora.
 */
@Component({
  selector: 'app-seguridad-landing',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './seguridad-landing.component.html',
  styleUrl: './seguridad-landing.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SeguridadLandingComponent {
  protected readonly enlaces = ENLACES;
}

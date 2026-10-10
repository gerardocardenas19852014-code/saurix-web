import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AuthService } from '../../../core/services/auth.service';
import { fuenteDatosActual } from '../../../core/services/fuente-datos';
import { RouterLink } from '@angular/router';

/** Mismo criterio de color que Presupuesto/Proyectos/Familia (ver
 *  presupuesto-inicio.component.ts): una de las clases .module-tile-*
 *  definidas en styles.scss, una por grupo. */
type ColorIcono = 'indigo';

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
 * Landing de Seguridad con el mismo esquema visual de tiles agrupados que
 * Presupuesto/Proyectos/Familia (tiles-grid + module-tile-*), en vez de la
 * lista compacta anterior (.catalog-list), a pedido del usuario. Por ahora
 * solo hay un grupo con una sola pantalla (Usuarios) — mismo caso que el
 * grupo "Miembros" de familia-inicio.component.ts, que también arranca con
 * una sola tile.
 */
const GRUPOS: GrupoModulo[] = [
  {
    titulo: 'Usuarios',
    enlaces: [
      {
        ruta: 'usuarios',
        icono: '👤',
        color: 'indigo',
        titulo: 'Usuarios',
        descripcion: 'Alta, edición y baja de usuarios del sistema.',
      },
    ],
  },
];

@Component({
  selector: 'app-seguridad-landing',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './seguridad-landing.component.html',
  styleUrl: './seguridad-landing.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SeguridadLandingComponent {
  private readonly auth = inject(AuthService);

  /** Empresas solo para el superadministrador y trabajando en la Nube. */
  protected readonly grupos: GrupoModulo[] =
    fuenteDatosActual() === 'supabase' && this.auth.usuarioActual()?.esSuperadmin
      ? [
          ...GRUPOS,
          {
            titulo: 'Empresas',
            enlaces: [
              {
                ruta: 'empresas',
                icono: '🏢',
                color: 'indigo',
                titulo: 'Empresas',
                descripcion: 'Clientes del sistema: alta, primer admin y entrar a trabajar dentro de una empresa.',
              },
            ],
          },
        ]
      : GRUPOS;
}

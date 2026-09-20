import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

interface ModuloTile {
  ruta: string;
  icono: string;
  etiqueta: string;
  clase: string;
}

const MODULOS: ModuloTile[] = [
  { ruta: '/wikidocs', icono: '📚', etiqueta: 'WikiDocs', clase: 'module-tile-green' },
  { ruta: '/seguridad', icono: '🔒', etiqueta: 'Seguridad', clase: 'module-tile-slate' },
  { ruta: '/catalogos', icono: '🏷️', etiqueta: 'Catálogos', clase: 'module-tile-amber' },
  { ruta: '/panel-control', icono: '⚙️', etiqueta: 'Panel de control', clase: 'module-tile-navy' },
  { ruta: '/presupuesto', icono: '💰', etiqueta: 'Presupuesto Personal', clase: 'module-tile-teal' },
  { ruta: '/proyectos', icono: '📋', etiqueta: 'Gestión de Proyectos', clase: 'module-tile-indigo' },
];

// Deshabilitado temporalmente mientras se termina de trabajar en los de arriba:
// { ruta: '/comercio', icono: '🛍️', etiqueta: 'Comercio', clase: 'module-tile-accent' },

@Component({
  selector: 'app-modulos',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './modulos.component.html',
  styleUrl: './modulos.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModulosComponent {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly modulos = MODULOS;

  salir(): void {
    this.auth.cerrarSesion();
    this.router.navigateByUrl('/login');
  }
}

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { LicenciaModulosService } from '../../../core/services/licencia-modulos.service';

interface ModuloTile {
  ruta: string;
  icono: string;
  etiqueta: string;
  clase: string;
  /** Clave de licencia (ver licencia-modulos.service.ts). Ausente = módulo
   *  base, no se gatea (Seguridad, Panel de control). */
  clave?: string;
}

const MODULOS: ModuloTile[] = [
  { ruta: '/wikidocs', icono: '📚', etiqueta: 'WikiDocs', clase: 'module-tile-green', clave: 'wikidocs' },
  { ruta: '/seguridad', icono: '🔒', etiqueta: 'Seguridad', clase: 'module-tile-slate' },
  { ruta: '/panel-control', icono: '⚙️', etiqueta: 'Panel de control', clase: 'module-tile-navy' },
  { ruta: '/presupuesto', icono: '💰', etiqueta: 'Presupuesto Personal', clase: 'module-tile-teal', clave: 'presupuesto' },
  { ruta: '/proyectos', icono: '📋', etiqueta: 'Gestión de Proyectos', clase: 'module-tile-indigo', clave: 'proyectos' },
  { ruta: '/familia', icono: '👪', etiqueta: 'Familia', clase: 'module-tile-amber', clave: 'familia' },
  { ruta: '/inventario', icono: '📦', etiqueta: 'Inventario', clase: 'module-tile-accent', clave: 'inventario' },
];

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
  private readonly licencia = inject(LicenciaModulosService);

  /** Solo los módulos que la empresa en sesión tiene contratados (los
   *  módulos base, sin "clave", siempre se muestran). */
  protected readonly modulos = computed(() =>
    MODULOS.filter((m) => !m.clave || this.licencia.habilitado(m.clave)),
  );

  salir(): void {
    this.auth.cerrarSesion();
    this.router.navigateByUrl('/login');
  }
}

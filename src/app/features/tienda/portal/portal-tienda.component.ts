import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TiendaPublicaService } from '../tienda-publica.service';
import { TiendaActiva } from '../tienda.model';

/**
 * /tienda — portal público (SIN login) que lista todas las empresas con
 * su catálogo activado (ver seguridad.tiendas_activas() y el toggle
 * "Activar catálogo público" en Seguridad → Empresas). Si alguien ya
 * conoce la clave de una empresa, puede ir directo a /tienda/:clave y se
 * saltan este portal por completo (ver portal-tienda vs catalogo-tienda
 * en tienda.routes.ts).
 */
@Component({
  selector: 'app-portal-tienda',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './portal-tienda.component.html',
  styleUrl: './portal-tienda.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalTiendaComponent implements OnInit {
  private readonly tiendaService = inject(TiendaPublicaService);

  protected readonly tiendas = signal<TiendaActiva[]>([]);
  protected readonly cargando = signal(true);
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.tiendaService
      .tiendasActivas()
      .then((tiendas) => this.tiendas.set(tiendas))
      .catch(() => this.error.set('No se pudo cargar el listado de tiendas. Intenta de nuevo en un momento.'))
      .finally(() => this.cargando.set(false));
  }
}

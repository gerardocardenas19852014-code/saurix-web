import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { ActualizacionService } from '../../../core/services/actualizacion.service';

/**
 * Aviso discreto de "hay una versión nueva" (auditoría nov-2026, ver
 * claude/saurix-cache-actualizacion-automatica-2026-11.md) — montado una
 * sola vez en App (app.ts), junto a app-indicador-ambiente, para que
 * aparezca en cualquier pantalla (incluida la Tienda pública, que puede
 * quedarse abierta horas en un dispositivo de mostrador). Nunca recarga
 * nada por sí solo: solo muestra el aviso; actualizar es siempre una
 * acción explícita del usuario (ver ActualizacionService.actualizarAhora()).
 */
@Component({
  selector: 'app-actualizacion-disponible',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (servicio.actualizacionDisponible()) {
      <div class="actualizacion-aviso" role="status">
        <span class="actualizacion-aviso-texto">🔄 Hay una nueva versión de Saurix disponible.</span>
        <div class="actualizacion-aviso-acciones">
          <button type="button" class="actualizacion-aviso-boton" (click)="servicio.actualizarAhora()">
            Actualizar ahora
          </button>
          <button
            type="button"
            class="actualizacion-aviso-cerrar"
            title="Cerrar aviso"
            aria-label="Cerrar aviso"
            (click)="servicio.descartarAviso()"
          >
            ✕
          </button>
        </div>
      </div>
    }
  `,
  styles: `
    :host { display: contents; }
    .actualizacion-aviso {
      position: fixed;
      z-index: 950; /* sobre los toasts (500); bajo la franja de ambiente (1000) */
      bottom: 20px;
      right: 20px;
      left: auto;
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      max-width: min(420px, calc(100vw - 32px));
      padding: 12px 16px;
      border-radius: 14px;
      background: var(--heading-navy, #0b1b2b);
      color: #fff;
      font-family: 'Montserrat', sans-serif;
      box-shadow: 0 12px 28px -10px rgba(0, 0, 0, .5);
    }
    .actualizacion-aviso-texto { font-size: 13px; font-weight: 600; flex: 1 1 auto; min-width: 180px; }
    .actualizacion-aviso-acciones { display: flex; align-items: center; gap: 6px; flex-shrink: 0; margin-left: auto; }
    .actualizacion-aviso-boton {
      border: none; border-radius: 999px; padding: 7px 16px;
      background: var(--accent, #2563eb); color: #fff;
      font: inherit; font-size: 13px; font-weight: 700; cursor: pointer;
      white-space: nowrap;
    }
    .actualizacion-aviso-boton:hover { filter: brightness(1.1); }
    .actualizacion-aviso-cerrar {
      background: none; border: none; color: rgba(255, 255, 255, .75);
      font-size: 15px; line-height: 1; cursor: pointer; padding: 4px;
    }
    .actualizacion-aviso-cerrar:hover { color: #fff; }

    /* Full-bleed y más arriba en móvil (despega la barra inferior de la
     * Tienda pública / nav de módulos cuando existe, en vez de competir con
     * ella) -- mismo criterio responsive que .sx-toast-contenedor. */
    @media (max-width: 640px) {
      .actualizacion-aviso {
        left: 12px;
        right: 12px;
        bottom: 84px;
        max-width: none;
      }
    }
  `,
})
export class ActualizacionDisponibleComponent implements OnInit {
  protected readonly servicio = inject(ActualizacionService);

  ngOnInit(): void {
    this.servicio.iniciar();
  }
}

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { TEMAS, Tema, ThemeService } from '../../../shared/services/theme.service';

const CLAVE_ASISTENTE_IA = 'saurix.asistenteIaActivo';

/**
 * Apariencia. El esquema real tiene PanelControl.ConfiguracionApariencia
 * 1-1 con Seguridad.Usuario, pero como todavía no hay autenticación real
 * (CreadoPor/usuario actual siempre es NULL en el backend, ver notas de
 * servicios-net-plataformasaurix.md), estas preferencias se guardan
 * localmente por ahora; cuando exista un usuario autenticado real, este
 * componente es el lugar natural para sincronizarlas contra ese endpoint.
 */
@Component({
  selector: 'app-apariencia',
  standalone: true,
  templateUrl: './apariencia.component.html',
  styleUrl: './apariencia.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AparienciaComponent {
  protected readonly themeService = inject(ThemeService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);
  protected readonly temas = TEMAS;

  protected readonly asistenteIaActivo = signal(this.leerBooleano(CLAVE_ASISTENTE_IA, true));

  cambiarTema(tema: Tema): void {
    this.themeService.cambiar(tema);
  }

  alternarAsistenteIa(activo: boolean): void {
    this.asistenteIaActivo.set(activo);
    try {
      localStorage.setItem(CLAVE_ASISTENTE_IA, String(activo));
    } catch {
      /* localStorage no disponible; se ignora */
    }
  }

  cambiarTamanoPagina(valorTexto: string): void {
    this.preferenciasGrid.cambiarTamanoPagina(Number(valorTexto) || 10);
  }

  private leerBooleano(clave: string, porDefecto: boolean): boolean {
    try {
      const valor = localStorage.getItem(clave);
      return valor === null ? porDefecto : valor === 'true';
    } catch {
      return porDefecto;
    }
  }
}

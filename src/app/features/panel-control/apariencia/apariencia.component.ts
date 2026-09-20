import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ConfiguracionAparienciaService } from '../../../shared/services/configuracion-apariencia.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { TEMAS, Tema, ThemeService } from '../../../shared/services/theme.service';

/**
 * Apariencia. Antes se guardaba solo en localStorage del navegador; ahora
 * ConfiguracionAparienciaService la sincroniza también contra la "base de
 * datos" de la app (IndexedDB hoy — mismo contrato que usará
 * PlataformaSaurix.ConfiguracionApariencia cuando se conecte el backend
 * real) por usuario, para que la preferencia viaje con la cuenta y no solo
 * con este navegador.
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
  private readonly configuracionApariencia = inject(ConfiguracionAparienciaService);
  protected readonly temas = TEMAS;

  protected readonly asistenteIaActivo = this.configuracionApariencia.asistenteIaActivo;
  protected readonly vistaProyectosPreferida = this.configuracionApariencia.vistaProyectosPreferida;

  cambiarTema(tema: Tema): void {
    this.configuracionApariencia.cambiarTema(tema);
  }

  alternarAsistenteIa(activo: boolean): void {
    this.configuracionApariencia.alternarAsistenteIa(activo);
  }

  cambiarTamanoPagina(valorTexto: string): void {
    this.configuracionApariencia.cambiarTamanoPagina(Number(valorTexto) || 10);
  }

  cambiarVistaProyectos(valorTexto: string): void {
    this.configuracionApariencia.cambiarVistaProyectos(valorTexto === 'lista' ? 'lista' : 'tablero');
  }
}

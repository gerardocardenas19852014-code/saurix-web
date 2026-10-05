import { ChangeDetectionStrategy, Component, inject, OnDestroy, OnInit } from '@angular/core';
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
export class AparienciaComponent implements OnInit, OnDestroy {
  // Pantallas de Panel de Control (menos "Inicio", que es la cuadrícula de
  // iconos): por defecto .content tiene max-width: 980px y queda centrada,
  // dejando franjas vacías grandes a los lados en pantallas anchas. Se pide
  // aquí el mismo ancho ampliado que ya usan Movimientos/Deudas/Proyección/
  // Familia (ver html[data-wide='grid'] en styles.scss) para que el
  // contenido aproveche ese espacio.
  ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid');
  }

  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

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

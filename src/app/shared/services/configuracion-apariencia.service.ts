import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { DataClientService } from '../../core/services/data-client.service';
import { PreferenciasGridService } from './preferencias-grid.service';
import { Tema, ThemeService } from './theme.service';

const ENTIDAD = 'ConfiguracionApariencia';
const CLAVE_ASISTENTE_IA_LOCAL = 'saurix.asistenteIaActivo';

/** Mismo contrato que usará PlataformaSaurix.ConfiguracionApariencia (1-1
 *  con Usuario: Tema, AsistenteIaActivo, TamanoPaginaGrid) cuando se
 *  conecte el backend real — ver servicios-net-plataformasaurix.md. */
export interface ConfiguracionApariencia {
  id: number;
  usuarioId: number;
  tema: Tema;
  asistenteIaActivo: boolean;
  tamanoPaginaGrid: number;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

/**
 * Apariencia (Panel de Control) ya no vive solo en localStorage: cada
 * usuario tiene su propio registro en la "base de datos" de la app
 * (IndexedDB hoy, sin backend — el día que se conecte PlataformaSaurix de
 * verdad, este mismo contrato ya encaja con ConfiguracionApariencia). Así,
 * cada vez que se entra a la app (login o sesión restaurada), se trae y
 * aplica la configuración del usuario en vez de depender solo de lo que
 * haya en localStorage de ESE navegador. localStorage se conserva como
 * caché instantánea (para pintar bien antes de que resuelva la lectura
 * async) y como respaldo si la lectura de datos fallara.
 */
@Injectable({ providedIn: 'root' })
export class ConfiguracionAparienciaService {
  private readonly data = inject(DataClientService);
  private readonly auth = inject(AuthService);
  private readonly theme = inject(ThemeService);
  private readonly preferenciasGrid = inject(PreferenciasGridService);

  readonly asistenteIaActivo = signal(this.leerAsistenteLocal());

  private registroActual: ConfiguracionApariencia | null = null;
  private usuarioIdCargado: number | null = null;

  /** Llamar al entrar al shell (login fresco o sesión restaurada). */
  async cargarParaUsuarioActual(): Promise<void> {
    const usuarioId = this.auth.usuarioActual()?.id;
    if (!usuarioId || this.usuarioIdCargado === usuarioId) return;
    this.usuarioIdCargado = usuarioId;

    try {
      const registros = await firstValueFrom(this.data.list<ConfiguracionApariencia>(ENTIDAD, { usuarioId }));
      const registro = registros[0] ?? null;
      this.registroActual = registro;
      if (!registro) return;

      this.theme.cambiar(registro.tema);
      this.preferenciasGrid.cambiarTamanoPagina(registro.tamanoPaginaGrid);
      this.asistenteIaActivo.set(registro.asistenteIaActivo);
    } catch {
      /* Sin datos disponibles todavía; se queda con lo que había localmente. */
    }
  }

  alternarAsistenteIa(activo: boolean): void {
    this.asistenteIaActivo.set(activo);
    try {
      localStorage.setItem(CLAVE_ASISTENTE_IA_LOCAL, String(activo));
    } catch {
      /* localStorage no disponible; se ignora */
    }
    this.guardar({ asistenteIaActivo: activo });
  }

  cambiarTema(tema: Tema): void {
    this.theme.cambiar(tema);
    this.guardar({ tema });
  }

  cambiarTamanoPagina(valor: number): void {
    this.preferenciasGrid.cambiarTamanoPagina(valor);
    this.guardar({ tamanoPaginaGrid: valor });
  }

  private guardar(cambios: Partial<Pick<ConfiguracionApariencia, 'tema' | 'asistenteIaActivo' | 'tamanoPaginaGrid'>>): void {
    const usuarioId = this.auth.usuarioActual()?.id;
    if (!usuarioId) return;

    const base: Omit<ConfiguracionApariencia, 'id'> = {
      usuarioId,
      tema: this.registroActual?.tema ?? this.theme.tema(),
      asistenteIaActivo: this.registroActual?.asistenteIaActivo ?? this.asistenteIaActivo(),
      tamanoPaginaGrid: this.registroActual?.tamanoPaginaGrid ?? this.preferenciasGrid.tamanoPagina(),
      ...cambios,
    };

    const peticion = this.registroActual
      ? this.data.modificacion<ConfiguracionApariencia>(ENTIDAD, { ...base, id: this.registroActual.id })
      : this.data.alta<ConfiguracionApariencia>(ENTIDAD, base);

    peticion.subscribe({ next: (registro) => (this.registroActual = registro) });
  }

  private leerAsistenteLocal(): boolean {
    try {
      const valor = localStorage.getItem(CLAVE_ASISTENTE_IA_LOCAL);
      return valor === null ? true : valor === 'true';
    } catch {
      return true;
    }
  }
}

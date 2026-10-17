import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../core/services/data-client.service';

const ENTIDAD = 'ConfiguracionVentas';

/**
 * Parámetros de Ventas que se controlan desde Panel de Control (excepción
 * explícita al criterio general de "la configuración de cada módulo vive
 * dentro de ese módulo" — ver panel-control-landing.component.ts — pedida
 * así por el usuario: "ese parametro se debe de control[ar] en panel de
 * control"). Fila única (singleton), compartida por toda la empresa — a
 * diferencia de ConfiguracionApariencia (1-1 por usuario), aquí no hay
 * usuarioId.
 */
export interface ConfiguracionVentas {
  id: number;
  /** Si está activo, Apertura y Cierre de caja piden el conteo de
   *  billetes/monedas por denominación en vez de un solo monto en texto
   *  (ver denominaciones-efectivo.util.ts). Apagado por default: es un
   *  paso extra opcional, no todas las empresas lo quieren. */
  conteoCajaPorDenominacion: boolean;
  fechaCreacion?: string;
  fechaModificacion?: string;
  activo: boolean;
}

@Injectable({ providedIn: 'root' })
export class ConfiguracionVentasService {
  private readonly data = inject(DataClientService);

  readonly conteoCajaPorDenominacion = signal(false);

  private registroActual: ConfiguracionVentas | null = null;
  private cargaEnCurso: Promise<void> | null = null;

  /** Idempotente: varias pantallas (Apertura/Corte/Cierre/Parámetros) la
   *  llaman en su ngOnInit sin preocuparse de pedirla dos veces. */
  async cargar(): Promise<void> {
    if (this.registroActual) return;
    if (this.cargaEnCurso) return this.cargaEnCurso;

    this.cargaEnCurso = (async () => {
      try {
        const registros = await firstValueFrom(this.data.list<ConfiguracionVentas>(ENTIDAD));
        const registro = registros[0] ?? null;
        this.registroActual = registro;
        this.conteoCajaPorDenominacion.set(registro?.conteoCajaPorDenominacion ?? false);
      } catch {
        /* Sin datos disponibles todavía (p.ej. entidad no migrada aún en modo
         *  Nube) — se queda con el default (apagado). */
      }
    })();
    return this.cargaEnCurso;
  }

  async alternarConteoPorDenominacion(activo: boolean): Promise<void> {
    await this.cargar();
    this.conteoCajaPorDenominacion.set(activo);

    if (this.registroActual) {
      this.registroActual = await firstValueFrom(
        this.data.modificacion<ConfiguracionVentas>(ENTIDAD, {
          ...this.registroActual,
          conteoCajaPorDenominacion: activo,
        }),
      );
    } else {
      this.registroActual = await firstValueFrom(
        this.data.alta<ConfiguracionVentas>(ENTIDAD, {
          conteoCajaPorDenominacion: activo,
          activo: true,
        }),
      );
    }
  }
}

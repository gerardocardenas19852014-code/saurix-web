import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { AuthService } from '../../../core/services/auth.service';
import { ConfiguracionVentasService } from '../../../shared/services/configuracion-ventas.service';
import { ToastService } from '../../../shared/services/toast.service';

/**
 * Parámetros generales de la empresa, controlados desde Panel de Control
 * (a diferencia de la configuración propia de cada módulo, que vive dentro
 * de ese módulo — ver el comentario en panel-control-landing.component.ts).
 * Hoy solo tiene un parámetro (conteo de caja por denominación, de
 * Ventas); está pensada para ir creciendo con más parámetros de este tipo
 * sin cambiar de pantalla.
 */
@Component({
  selector: 'app-parametros',
  standalone: true,
  templateUrl: './parametros.component.html',
  styleUrl: './parametros.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ParametrosComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  protected readonly configuracionVentas = inject(ConfiguracionVentasService);

  protected readonly esAdmin = this.auth.usuarioActual()?.role === 'admin';

  async ngOnInit(): Promise<void> {
    await this.configuracionVentas.cargar();
  }

  async alternarConteoPorDenominacion(activo: boolean): Promise<void> {
    if (!this.esAdmin) return;
    try {
      await this.configuracionVentas.alternarConteoPorDenominacion(activo);
      this.toast.exito(activo ? 'Conteo por denominación activado.' : 'Conteo por denominación desactivado.');
    } catch {
      this.toast.error('No se pudo guardar el parámetro.');
    }
  }

  async alternarAperturaCaja(activo: boolean): Promise<void> {
    if (!this.esAdmin) return;
    try {
      await this.configuracionVentas.alternarAperturaCaja(activo);
      this.toast.exito(activo ? 'Apertura de caja activada.' : 'Apertura de caja desactivada.');
    } catch {
      this.toast.error('No se pudo guardar el parámetro.');
    }
  }

  async alternarCorteCaja(activo: boolean): Promise<void> {
    if (!this.esAdmin) return;
    try {
      await this.configuracionVentas.alternarCorteCaja(activo);
      this.toast.exito(activo ? 'Corte de caja activado.' : 'Corte de caja desactivado.');
    } catch {
      this.toast.error('No se pudo guardar el parámetro.');
    }
  }

  async alternarCierreCaja(activo: boolean): Promise<void> {
    if (!this.esAdmin) return;
    try {
      await this.configuracionVentas.alternarCierreCaja(activo);
      this.toast.exito(activo ? 'Cierre de caja activado.' : 'Cierre de caja desactivado.');
    } catch {
      this.toast.error('No se pudo guardar el parámetro.');
    }
  }
}

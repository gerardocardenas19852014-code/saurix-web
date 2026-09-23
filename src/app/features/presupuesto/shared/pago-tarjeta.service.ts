import { Injectable, signal } from '@angular/core';
import { CuentaPresupuesto } from '../../catalogos/cuenta-presupuesto/cuenta-presupuesto.model';

export interface SolicitudPagoTarjeta {
  cuentaId: number;
  monto: number;
  descripcion: string;
}

/**
 * Puente simple entre el botón "Pagar tarjeta" (Dashboard) y Movimientos: el
 * dashboard deja aquí los datos del pago antes de navegar a /presupuesto/movimientos,
 * y MovimientosComponent los consume (y limpia) en su ngOnInit para abrir el modal
 * de transferencia ya prellenado — evita acoplar los dos componentes vía Router state.
 */
@Injectable({ providedIn: 'root' })
export class PagoTarjetaService {
  private readonly solicitud = signal<SolicitudPagoTarjeta | null>(null);

  /** Pre-llena el pago con el monto de la deuda actual, igual que el prototipo. */
  solicitar(cuenta: CuentaPresupuesto, deuda: number): void {
    this.solicitud.set({
      cuentaId: Number(cuenta.id),
      monto: Math.round(deuda * 100) / 100,
      descripcion: `Pago de tarjeta ${cuenta.nombre}`,
    });
  }

  /** Devuelve la solicitud pendiente (si hay) y la limpia — solo se consume una vez. */
  consumir(): SolicitudPagoTarjeta | null {
    const actual = this.solicitud();
    this.solicitud.set(null);
    return actual;
  }
}

import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { MetodoPagoCobrado, Venta } from '../venta/venta.model';
import { AbonoCuentaPorCobrar, CuentaPorCobrar } from './cuenta-por-cobrar.model';

/**
 * Único lugar que escribe CuentaPorCobrar/AbonoCuentaPorCobrar — mismo
 * criterio de "servicio único" que VentaService/DevolucionService. Se crea
 * UNA cuenta por cada VentaPago con metodoPago: 'Crédito' (normalmente solo
 * una por venta, pero no se asume: una venta podría en teoría tener parte
 * en Efectivo y parte a Crédito).
 */
@Injectable({ providedIn: 'root' })
export class CuentaPorCobrarService {
  private readonly data = inject(DataClientService);

  async crearDesdeVenta(venta: Venta, clienteId: number, montoCredito: number): Promise<CuentaPorCobrar> {
    return firstValueFrom(
      this.data.alta<CuentaPorCobrar>('CuentaPorCobrar', {
        ventaId: venta.id,
        clienteId,
        fecha: venta.fecha,
        montoOriginal: montoCredito,
        saldoPendiente: montoCredito,
        estado: 'Pendiente',
        activo: true,
      }),
    );
  }

  async porVenta(ventaId: number): Promise<CuentaPorCobrar[]> {
    return firstValueFrom(this.data.list<CuentaPorCobrar>('CuentaPorCobrar', { ventaId }));
  }

  async porCliente(clienteId: number): Promise<CuentaPorCobrar[]> {
    return firstValueFrom(this.data.list<CuentaPorCobrar>('CuentaPorCobrar', { clienteId }));
  }

  async todasPendientes(): Promise<CuentaPorCobrar[]> {
    const todas = await firstValueFrom(this.data.list<CuentaPorCobrar>('CuentaPorCobrar'));
    return todas.filter((c) => c.estado === 'Pendiente');
  }

  async abonos(cuentaPorCobrarId: number): Promise<AbonoCuentaPorCobrar[]> {
    return firstValueFrom(this.data.list<AbonoCuentaPorCobrar>('AbonoCuentaPorCobrar', { cuentaPorCobrarId }));
  }

  /** Abona contra una cuenta pendiente; el abono entra al arqueo del turno
   *  ABIERTO en este momento (turnoCajaId), no al turno de la venta
   *  original (ver comentario en el modelo). Marca la cuenta 'Pagada' en
   *  cuanto el saldo llega a 0 (o menos, por redondeo). */
  async registrarAbono(params: {
    cuenta: CuentaPorCobrar;
    monto: number;
    metodoPago: MetodoPagoCobrado;
    turnoCajaId: number;
    usuarioId: number;
    notas: string | null;
  }): Promise<CuentaPorCobrar> {
    const { cuenta, monto, metodoPago, turnoCajaId, usuarioId, notas } = params;
    if (cuenta.estado !== 'Pendiente') return cuenta;

    await firstValueFrom(
      this.data.alta<AbonoCuentaPorCobrar>('AbonoCuentaPorCobrar', {
        cuentaPorCobrarId: cuenta.id,
        fecha: new Date().toISOString(),
        monto,
        metodoPago,
        turnoCajaId,
        usuarioId,
        notas,
        activo: true,
      }),
    );

    const nuevoSaldo = Math.max(0, Math.round((cuenta.saldoPendiente - monto) * 100) / 100);
    return firstValueFrom(
      this.data.modificacion<CuentaPorCobrar>('CuentaPorCobrar', {
        ...cuenta,
        saldoPendiente: nuevoSaldo,
        estado: nuevoSaldo <= 0.01 ? 'Pagada' : 'Pendiente',
      }),
    );
  }

  /** Cancela la(s) cuenta(s) de una venta cancelada — solo tiene sentido
   *  llamarla cuando VentaService.cancelar() ya validó que ninguna tiene
   *  abonos todavía. */
  async cancelarPorVenta(ventaId: number): Promise<void> {
    const cuentas = await this.porVenta(ventaId);
    for (const cuenta of cuentas) {
      if (cuenta.estado !== 'Pendiente') continue;
      await firstValueFrom(
        this.data.modificacion<CuentaPorCobrar>('CuentaPorCobrar', {
          ...cuenta,
          saldoPendiente: 0,
          estado: 'Cancelada',
        }),
      );
    }
  }
}

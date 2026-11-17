import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { TurnoCaja } from './turno-caja.model';

/**
 * Mandato 86 (Fase A, nov-2026): el sistema de caja (Apertura/Corte/Cierre
 * de turno, conteo por denominación) se eliminó por completo del producto
 * -- ya no hay pantallas, menú ni parámetro que lo controlen. Este servicio
 * queda reducido a un mecanismo interno e invisible: abre un turno en
 * silencio ($0, sin notas) la primera vez que hace falta, porque
 * `Venta.turnoCajaId` todavía es una columna NOT NULL en producción (y hay
 * ventas históricas reales ligadas a turnos históricos reales que no deben
 * tocarse). Cobro, Cotizaciones y Cuentas por cobrar lo siguen llamando
 * para obtener ese id, pero ningún usuario ve ni puede ver un turno.
 *
 * La Fase B (propuesta separada, pendiente de autorización) plantea volver
 * nullable `venta.turno_caja_id` y adaptar `fn_venta_registrar`/
 * `fn_pedido_tienda_cargar_a_venta` para aceptar un turno opcional -- el día
 * que eso se apruebe y despliegue, este servicio (y el concepto de
 * TurnoCaja) se podrán retirar del todo.
 */
@Injectable({ providedIn: 'root' })
export class TurnoCajaService {
  private readonly data = inject(DataClientService);

  private async turnoAbierto(usuarioId: number): Promise<TurnoCaja | null> {
    const turnos = await firstValueFrom(this.data.list<TurnoCaja>('TurnoCaja', { usuarioId, estado: 'Abierto' }));
    return turnos.find((t) => t.estado === 'Abierto') ?? null;
  }

  /** Siempre regresa un turno abierto para este usuario: si ya tiene uno lo
   *  reutiliza, si no, abre uno nuevo en silencio. Nunca regresa null --
   *  Cobro/Cotizaciones/CuentasPorCobrar ya no necesitan manejar ese caso. */
  async turnoAbiertoOCrear(usuarioId: number): Promise<TurnoCaja> {
    const existente = await this.turnoAbierto(usuarioId);
    if (existente) return existente;
    return this.abrir(usuarioId);
  }

  private async abrir(usuarioId: number): Promise<TurnoCaja> {
    const existente = await this.turnoAbierto(usuarioId);
    if (existente) return existente; // ya tenía uno abierto: no se duplica

    return firstValueFrom(
      this.data.alta<TurnoCaja>('TurnoCaja', {
        usuarioId,
        fechaApertura: new Date().toISOString(),
        montoApertura: 0,
        notasApertura: null,
        fechaCierre: null,
        montoCierreContado: null,
        montoCierreEsperado: null,
        diferenciaCierre: null,
        notasCierre: null,
        estado: 'Abierto',
        activo: true,
      }),
    );
  }
}

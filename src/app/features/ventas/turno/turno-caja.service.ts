import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { Venta } from '../venta/venta.model';
import { VentaPago } from '../venta/venta.model';
import { DenominacionCantidad } from '../../../shared/components/conteo-denominaciones/conteo-denominaciones.model';
import { AbonoCuentaPorCobrar } from '../cuenta-por-cobrar/cuenta-por-cobrar.model';
import { METODOS_PAGO } from '../venta/venta.model';
import { MomentoConteoCaja, ResumenTurno, TurnoCaja, TurnoCajaDenominacion } from './turno-caja.model';

/**
 * Abrir/cerrar turno de caja y resumir sus ventas — único lugar que calcula
 * "cuánto efectivo debería haber en el cajón" (mismo criterio de servicio
 * único que MovimientoInventarioService/VentaService: una sola fuente de
 * verdad para esta cuenta, para que Cobro, Corte y Cierre siempre coincidan).
 */
@Injectable({ providedIn: 'root' })
export class TurnoCajaService {
  private readonly data = inject(DataClientService);

  /** El turno Abierto de este usuario, si tiene uno — null si no. Cobro
   *  redirige a Apertura de turno cuando esto da null. */
  async turnoAbierto(usuarioId: number): Promise<TurnoCaja | null> {
    const turnos = await firstValueFrom(this.data.list<TurnoCaja>('TurnoCaja', { usuarioId, estado: 'Abierto' }));
    return turnos.find((t) => t.estado === 'Abierto') ?? null;
  }

  async abrir(usuarioId: number, montoApertura: number, notas: string | null): Promise<TurnoCaja> {
    const existente = await this.turnoAbierto(usuarioId);
    if (existente) return existente; // ya tenía uno abierto: no se duplica

    return firstValueFrom(
      this.data.alta<TurnoCaja>('TurnoCaja', {
        usuarioId,
        fechaApertura: new Date().toISOString(),
        montoApertura,
        notasApertura: notas,
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

  /** Fotografía de cómo va el turno — usada por Cobro (encabezado), Corte
   *  (reporte a medio turno) y Cierre (antes de pedir el conteo físico). */
  async resumen(turno: TurnoCaja): Promise<ResumenTurno> {
    const ventas = (await firstValueFrom(this.data.list<Venta>('Venta', { turnoCajaId: turno.id }))).filter(
      (v) => v.estado === 'Completada',
    );
    const totalVentas = ventas.reduce((acc, v) => acc + v.total, 0);

    const pagosPorVenta = await Promise.all(
      ventas.map((v) => firstValueFrom(this.data.list<VentaPago>('VentaPago', { ventaId: v.id }))),
    );
    const pagos = pagosPorVenta.flat();

    // Abonos a cuentas por cobrar cobrados DURANTE este turno (de ventas de
    // cualquier turno, incluso anteriores — ver AbonoCuentaPorCobrar.model.ts):
    // ese dinero sí entra al cajón de este turno, aunque la venta original
    // no sea de hoy.
    const abonos = (
      await firstValueFrom(this.data.list<AbonoCuentaPorCobrar>('AbonoCuentaPorCobrar', { turnoCajaId: turno.id }))
    ).filter((a) => a.activo !== false);

    const totalPorMetodo = METODOS_PAGO.map((metodoPago) => ({
      metodoPago,
      total:
        pagos.filter((p) => p.metodoPago === metodoPago).reduce((acc, p) => acc + p.monto, 0) +
        abonos.filter((a) => a.metodoPago === metodoPago).reduce((acc, a) => acc + a.monto, 0),
    }));

    const efectivo = totalPorMetodo.find((m) => m.metodoPago === 'Efectivo')?.total ?? 0;
    const efectivoEsperado = turno.montoApertura + efectivo;

    return { turno, totalVentas, numeroVentas: ventas.length, totalPorMetodo, efectivoEsperado };
  }

  async cerrar(turno: TurnoCaja, montoContado: number, notas: string | null): Promise<TurnoCaja> {
    const { efectivoEsperado } = await this.resumen(turno);
    const diferencia = montoContado - efectivoEsperado;

    return firstValueFrom(
      this.data.modificacion<TurnoCaja>('TurnoCaja', {
        ...turno,
        fechaCierre: new Date().toISOString(),
        montoCierreContado: montoContado,
        montoCierreEsperado: efectivoEsperado,
        diferenciaCierre: diferencia,
        notasCierre: notas,
        estado: 'Cerrado',
      }),
    );
  }

  /** Guarda el desglose de billetes/monedas de Apertura o Cierre — solo se
   *  llama cuando el parámetro de conteo por denominación está activo (ver
   *  ConfiguracionVentasService). No reemplaza montoApertura/
   *  montoCierreContado (que siguen siendo la fuente de verdad del total);
   *  es solo el detalle de cómo se llegó a ese total. */
  async guardarDenominaciones(
    turnoCajaId: number,
    momento: MomentoConteoCaja,
    desglose: DenominacionCantidad[],
  ): Promise<void> {
    for (const linea of desglose) {
      await firstValueFrom(
        this.data.alta<TurnoCajaDenominacion>('TurnoCajaDenominacion', {
          turnoCajaId,
          momento,
          valor: linea.valor,
          cantidad: linea.cantidad,
          activo: true,
        }),
      );
    }
  }

  async obtenerDenominaciones(turnoCajaId: number, momento: MomentoConteoCaja): Promise<TurnoCajaDenominacion[]> {
    const filas = await firstValueFrom(
      this.data.list<TurnoCajaDenominacion>('TurnoCajaDenominacion', { turnoCajaId }),
    );
    return filas.filter((f) => f.momento === momento);
  }
}

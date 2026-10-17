import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { Cliente } from '../clientes/cliente.model';
import { ConfiguracionLealtad, MovimientoPuntosCliente } from './lealtad.model';

const ENTIDAD_CONFIG = 'ConfiguracionLealtad';

/**
 * Programa de lealtad/puntos — único lugar que mueve
 * MovimientoPuntosCliente y Cliente.puntosAcumulados (mismo criterio de
 * "servicio único que escribe" que VentaService/DevolucionService/
 * CuentaPorCobrarService). Ganar puntos y canjearlos pasan por aquí desde
 * VentaService.registrar(); reversarPorVenta() desde VentaService.cancelar().
 */
@Injectable({ providedIn: 'root' })
export class ProgramaLealtadService {
  private readonly data = inject(DataClientService);

  readonly programaActivo = signal(false);
  readonly pesosPorPunto = signal(10);
  readonly pesosDescuentoPorPunto = signal(1);

  private registroActual: ConfiguracionLealtad | null = null;
  private cargaEnCurso: Promise<void> | null = null;

  async cargar(): Promise<void> {
    if (this.registroActual) return;
    if (this.cargaEnCurso) return this.cargaEnCurso;

    this.cargaEnCurso = (async () => {
      try {
        const registros = await firstValueFrom(this.data.list<ConfiguracionLealtad>(ENTIDAD_CONFIG));
        const registro = registros[0] ?? null;
        this.registroActual = registro;
        this.programaActivo.set(registro?.programaActivo ?? false);
        this.pesosPorPunto.set(registro?.pesosPorPunto ?? 10);
        this.pesosDescuentoPorPunto.set(registro?.pesosDescuentoPorPunto ?? 1);
      } catch {
        /* Sin datos disponibles todavía — se queda apagado por default. */
      }
    })();
    return this.cargaEnCurso;
  }

  async guardarConfiguracion(params: {
    programaActivo: boolean;
    pesosPorPunto: number;
    pesosDescuentoPorPunto: number;
  }): Promise<void> {
    await this.cargar();
    this.programaActivo.set(params.programaActivo);
    this.pesosPorPunto.set(params.pesosPorPunto);
    this.pesosDescuentoPorPunto.set(params.pesosDescuentoPorPunto);

    this.registroActual = this.registroActual
      ? await firstValueFrom(
          this.data.modificacion<ConfiguracionLealtad>(ENTIDAD_CONFIG, { ...this.registroActual, ...params }),
        )
      : await firstValueFrom(this.data.alta<ConfiguracionLealtad>(ENTIDAD_CONFIG, { ...params, activo: true }));
  }

  /** Puntos que ganaría una venta de este monto, con la tasa actual — 0 si
   *  el programa está apagado. Redondeado hacia abajo (no se dan puntos de
   *  más por una fracción). */
  puntosGanadosPor(montoVenta: number): number {
    if (!this.programaActivo() || this.pesosPorPunto() <= 0) return 0;
    return Math.floor(montoVenta / this.pesosPorPunto());
  }

  /** Descuento en pesos que vale canjear esta cantidad de puntos. */
  descuentoPorPuntos(puntos: number): number {
    return Math.round(puntos * this.pesosDescuentoPorPunto() * 100) / 100;
  }

  puntosDeCliente(cliente: Pick<Cliente, 'puntosAcumulados'>): number {
    return cliente.puntosAcumulados ?? 0;
  }

  /** Suma puntos ganados por una venta — no hace nada si el programa está
   *  apagado o si no se piden puntos (montoVenta <= 0, o el cliente es el
   *  genérico "Público en General", decidido por el llamador). */
  async registrarGanados(cliente: Cliente, montoVenta: number, ventaId: number): Promise<void> {
    const puntos = this.puntosGanadosPor(montoVenta);
    if (puntos <= 0) return;
    await this.aplicarMovimiento(cliente, puntos, 'Ganado', ventaId);
  }

  /** Resta puntos canjeados — el llamador (CobroComponent) ya validó que el
   *  cliente tiene saldo suficiente antes de llegar aquí. */
  async registrarCanje(cliente: Cliente, puntos: number, ventaId: number): Promise<void> {
    if (puntos <= 0) return;
    await this.aplicarMovimiento(cliente, -puntos, 'Canjeado', ventaId);
  }

  /** Revierte TODOS los movimientos de puntos de una venta cancelada —
   *  tanto lo ganado (se quita) como lo canjeado (se regresa), con un
   *  movimiento 'Reversado' por cada uno (nunca se borran los originales,
   *  para que la bitácora quede completa). */
  async reversarPorVenta(ventaId: number): Promise<void> {
    const movimientos = await firstValueFrom(
      this.data.list<MovimientoPuntosCliente>('MovimientoPuntosCliente', { ventaId }),
    );
    for (const mov of movimientos.filter((m) => m.activo !== false)) {
      const cliente = await firstValueFrom(this.data.getById<Cliente>('Cliente', mov.clienteId));
      if (!cliente) continue;
      await this.aplicarMovimiento(cliente, -mov.puntos, 'Reversado', ventaId);
    }
  }

  private async aplicarMovimiento(
    cliente: Cliente,
    puntosDelta: number,
    tipo: MovimientoPuntosCliente['tipo'],
    ventaId: number,
  ): Promise<void> {
    await firstValueFrom(
      this.data.alta<MovimientoPuntosCliente>('MovimientoPuntosCliente', {
        clienteId: cliente.id,
        fecha: new Date().toISOString(),
        puntos: puntosDelta,
        tipo,
        ventaId,
        activo: true,
      }),
    );
    const nuevoSaldo = Math.max(0, (cliente.puntosAcumulados ?? 0) + puntosDelta);
    await firstValueFrom(this.data.modificacion<Cliente>('Cliente', { ...cliente, puntosAcumulados: nuevoSaldo }));
  }
}

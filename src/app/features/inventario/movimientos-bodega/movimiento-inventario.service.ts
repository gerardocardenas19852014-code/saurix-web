import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { ExistenciaBodega } from './existencia-bodega.model';
import { MovimientoInventario } from './movimiento-inventario.model';

export interface RegistroMovimiento {
  productoId: number;
  /** null = sin origen (Entrada). */
  bodegaOrigenId: number | null;
  /** null = sin destino (Salida/Ajuste). */
  bodegaDestinoId: number | null;
  cantidad: number;
  nota: string | null;
}

/**
 * Único lugar que de verdad escribe en ExistenciaBodega + deja rastro en
 * MovimientoInventario — extraído de MovimientosBodegaComponent.registrarMovimiento()
 * para que Conteo físico (ver conteo-fisico.component.ts) pueda generar sus
 * ajustes con la MISMA lógica de resta/suma, en vez de reimplementarla ahí
 * y arriesgar que un día se desincronicen (mismo criterio de integridad que
 * existenciaTotal() en producto.util.ts: una sola fuente de verdad).
 *
 * Carga su propia copia fresca de ExistenciaBodega en cada llamada — como
 * esta es una app de un solo usuario local (IndexedDB, sin backend
 * concurrente), es más simple y más seguro que pedirle al que llama que
 * cargue y mantenga sincronizado ese arreglo él mismo.
 */
@Injectable({ providedIn: 'root' })
export class MovimientoInventarioService {
  private readonly data = inject(DataClientService);

  /** Existencia actual de un producto en una bodega — 0 si no hay registro. */
  async existenciaEnBodega(productoId: number, bodegaId: number): Promise<number> {
    const existencias = await firstValueFrom(this.data.list<ExistenciaBodega>('ExistenciaBodega', { productoId, bodegaId }));
    return existencias[0]?.existencia ?? 0;
  }

  async registrar(registro: RegistroMovimiento): Promise<void> {
    const existenciasBodega = await firstValueFrom(this.data.list<ExistenciaBodega>('ExistenciaBodega'));
    const { productoId, bodegaOrigenId, bodegaDestinoId, cantidad, nota } = registro;

    // 1. Restar del origen, si aplica (Traspaso o Salida/Ajuste).
    if (bodegaOrigenId !== null) {
      const filaOrigen = existenciasBodega.find((e) => e.productoId === productoId && e.bodegaId === bodegaOrigenId);
      if (filaOrigen) {
        await firstValueFrom(
          this.data.modificacion<ExistenciaBodega>('ExistenciaBodega', { ...filaOrigen, existencia: filaOrigen.existencia - cantidad }),
        );
      }
    }

    // 2. Sumar al destino, si aplica (Entrada o Traspaso) — crea el registro
    //    si todavía no existe ahí. Salida/Ajuste no tiene destino.
    if (bodegaDestinoId !== null) {
      const filaDestino = existenciasBodega.find((e) => e.productoId === productoId && e.bodegaId === bodegaDestinoId);
      if (filaDestino) {
        await firstValueFrom(
          this.data.modificacion<ExistenciaBodega>('ExistenciaBodega', { ...filaDestino, existencia: filaDestino.existencia + cantidad }),
        );
      } else {
        await firstValueFrom(this.data.alta<ExistenciaBodega>('ExistenciaBodega', { productoId, bodegaId: bodegaDestinoId, existencia: cantidad }));
      }
    }

    // 3. Dejar rastro en el historial.
    await firstValueFrom(
      this.data.alta<MovimientoInventario>('MovimientoInventario', {
        productoId,
        bodegaOrigenId,
        bodegaDestinoId,
        cantidad,
        fecha: new Date().toISOString(),
        nota,
      }),
    );
  }
}

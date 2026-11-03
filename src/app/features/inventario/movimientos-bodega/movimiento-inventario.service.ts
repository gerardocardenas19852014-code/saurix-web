import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { ExistenciaBodega } from './existencia-bodega.model';

export interface RegistroMovimiento {
  productoId: number;
  /** null = sin origen (Entrada). */
  bodegaOrigenId: number | null;
  /** null = sin destino (Salida/Ajuste). */
  bodegaDestinoId: number | null;
  cantidad: number;
  nota: string | null;
  /** Ver MovimientoInventario.ordenCompraId/costoUnitario — opcionales,
   *  solo los manda orden-compra.service.ts al recibir una orden. */
  ordenCompraId?: number | null;
  costoUnitario?: number | null;
}

/**
 * Único lugar que de verdad escribe en ExistenciaBodega + deja rastro en
 * MovimientoInventario — extraído de MovimientosBodegaComponent.registrarMovimiento()
 * para que Conteo físico (ver conteo-fisico.component.ts) pueda generar sus
 * ajustes con la MISMA lógica de resta/suma, en vez de reimplementarla ahí
 * y arriesgar que un día se desincronicen (mismo criterio de integridad que
 * existenciaTotal() en producto.util.ts: una sola fuente de verdad).
 *
 * Con varios usuarios reales escribiendo a la vez (BLOQUE C.5, auditoría del
 * sistema de notificaciones), un patrón de leer-calcular-escribir en el
 * cliente sería una condición de carrera: dos escrituras concurrentes
 * podrían pisarse y perder un movimiento. Por eso aquí se usa una función
 * RPC (inventario.fn_registrar_movimiento_inventario / fn_enviar_en_transito
 * / fn_confirmar_recepcion_transito) que hace todo el movimiento en una
 * sola transacción atómica de Postgres — probado en vivo con dos sesiones
 * concurrentes reales sin pérdida de actualizaciones.
 */
@Injectable({ providedIn: 'root' })
export class MovimientoInventarioService {
  private readonly data = inject(DataClientService);
  private readonly sb = inject(SupabaseService).cliente;

  /** Existencia actual de un producto en una bodega — 0 si no hay registro. */
  async existenciaEnBodega(productoId: number, bodegaId: number): Promise<number> {
    const existencias = await firstValueFrom(this.data.list<ExistenciaBodega>('ExistenciaBodega', { productoId, bodegaId }));
    return existencias[0]?.existencia ?? 0;
  }

  async registrar(registro: RegistroMovimiento): Promise<void> {
    const { productoId, bodegaOrigenId, bodegaDestinoId, cantidad, nota, ordenCompraId, costoUnitario } = registro;
    const { error } = await this.sb.schema('inventario').rpc('fn_registrar_movimiento_inventario', {
      p_producto_id: productoId,
      p_bodega_origen_id: bodegaOrigenId,
      p_bodega_destino_id: bodegaDestinoId,
      p_cantidad: cantidad,
      p_nota: nota,
      p_orden_compra_id: ordenCompraId ?? null,
      p_costo_unitario: costoUnitario ?? null,
    });
    if (error) throw error;
  }

  /**
   * Primera mitad de un Traspaso "en tránsito" (ver
   * MovimientoInventario.enTransito): resta de bodegaOrigenId igual que
   * registrar(), pero NO suma a bodegaDestinoId todavía — eso se hace
   * aparte en confirmarRecepcionTransito(), cuando de verdad llega la
   * mercancía. Se agrega como método NUEVO (no se tocó registrar()) para
   * no arriesgar el flujo normal de Traspaso/Entrada/Salida que ya
   * funciona en todas las pantallas que lo usan.
   */
  async enviarEnTransito(registro: RegistroMovimiento): Promise<void> {
    const { productoId, bodegaOrigenId, bodegaDestinoId, cantidad, nota } = registro;
    const { error } = await this.sb.schema('inventario').rpc('fn_enviar_en_transito', {
      p_producto_id: productoId,
      p_bodega_origen_id: bodegaOrigenId,
      p_bodega_destino_id: bodegaDestinoId,
      p_cantidad: cantidad,
      p_nota: nota,
    });
    if (error) throw error;
  }

  /**
   * Segunda mitad de un Traspaso "en tránsito" (ver enviarEnTransito()):
   * suma a bodegaDestinoId lo que ya se había restado de origen, y marca
   * el movimiento como recibido. No vuelve a tocar bodegaOrigenId — ya se
   * restó cuando se envió.
   */
  async confirmarRecepcionTransito(movimientoId: number): Promise<void> {
    const { error } = await this.sb.schema('inventario').rpc('fn_confirmar_recepcion_transito', {
      p_movimiento_id: movimientoId,
    });
    if (error) throw error;
  }
}

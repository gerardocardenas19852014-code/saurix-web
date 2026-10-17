import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { ComisionVendedor } from './comision-vendedor.model';

@Injectable({ providedIn: 'root' })
export class ComisionVendedorService {
  private readonly data = inject(DataClientService);

  async listar(): Promise<ComisionVendedor[]> {
    return firstValueFrom(this.data.list<ComisionVendedor>('ComisionVendedor'));
  }

  async obtenerPorUsuario(usuarioId: number): Promise<ComisionVendedor | null> {
    const filas = await firstValueFrom(this.data.list<ComisionVendedor>('ComisionVendedor', { usuarioId }));
    return filas[0] ?? null;
  }

  /** Crea o actualiza la comisión de un vendedor (get-or-create por
   *  usuarioId, mismo criterio que ConfiguracionVentasService). */
  async guardar(usuarioId: number, tipo: ComisionVendedor['tipo'], valor: number): Promise<ComisionVendedor> {
    const existente = await this.obtenerPorUsuario(usuarioId);
    if (existente) {
      return firstValueFrom(this.data.modificacion<ComisionVendedor>('ComisionVendedor', { ...existente, tipo, valor }));
    }
    return firstValueFrom(this.data.alta<ComisionVendedor>('ComisionVendedor', { usuarioId, tipo, valor, activo: true }));
  }
}

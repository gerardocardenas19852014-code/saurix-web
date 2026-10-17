import { Injectable, signal } from '@angular/core';

export interface LineaBorrador {
  productoId: number;
  cantidad: number;
  costoUnitario: number;
}

export interface OrdenCompraBorrador {
  proveedorId: number;
  /** Bodega destino sugerida — se precarga en la ficha si viene definida
   *  (ver sugerencia-reposicion.component.ts → generarOrdenCompra(): solo
   *  se llena cuando TODAS las líneas sugeridas son de la misma bodega).
   *  null = se deja que el usuario la elija él mismo, igual que antes. */
  bodegaId: number | null;
  lineas: LineaBorrador[];
}

/**
 * Traspaso de un borrador de Orden de compra entre pantallas — usado por
 * "Generar orden de compra" en Sugerencia de reposición (ver
 * sugerencia-reposicion.component.ts) para pre-llenar la ficha de
 * OrdenesCompraComponent sin guardar nada todavía (el usuario revisa,
 * ajusta y es quien hace clic en "Guardar"). Un signal simple en un
 * servicio `providedIn: 'root'` en vez de pasar datos por la ruta: no hay
 * nada que serializar en la URL y se consume una sola vez (ver
 * tomarBorrador(), que lo limpia al leerlo, para que no reaparezca si el
 * usuario vuelve a entrar a Órdenes de compra después sin pasar por aquí).
 */
@Injectable({ providedIn: 'root' })
export class OrdenCompraBorradorService {
  private readonly _borrador = signal<OrdenCompraBorrador | null>(null);

  establecer(borrador: OrdenCompraBorrador): void {
    this._borrador.set(borrador);
  }

  /** Lee el borrador pendiente y lo limpia de inmediato (consumo único). */
  tomarBorrador(): OrdenCompraBorrador | null {
    const actual = this._borrador();
    this._borrador.set(null);
    return actual;
  }
}

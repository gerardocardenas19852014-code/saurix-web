import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { Cliente, NOMBRE_CLIENTE_GENERICO, RFC_GENERICO } from './cliente.model';

/**
 * Siembra/obtiene el contacto fijo "Público en General" (RFC genérico) que
 * usan las ventas simples/sin cliente real — ver apartado "contacto
 * genérico" pedido junto con el módulo de Ventas. Se busca por
 * `esGenerico: true` en vez de por nombre/RFC para no depender de que el
 * texto nunca cambie; solo debe existir UN registro con esa bandera.
 */
@Injectable({ providedIn: 'root' })
export class ClienteService {
  private readonly data = inject(DataClientService);

  async obtenerOCrearGenerico(): Promise<Cliente> {
    // Filtrado server-side por esGenerico (en vez de traer TODO Cliente
    // para buscar uno solo en memoria, ver Bloque "eliminar 8 cargas" de
    // Cobro, 2026-11) — a lo sumo debería existir un único registro con
    // esta bandera, pero find() se queda con el primero igual si por algún
    // motivo hubiera más de uno.
    const clientes = await firstValueFrom(this.data.list<Cliente>('Cliente', { esGenerico: true }));
    const existente = clientes.find((c) => c.esGenerico);
    if (existente) return existente;

    return firstValueFrom(
      this.data.alta<Cliente>('Cliente', {
        nombre: NOMBRE_CLIENTE_GENERICO,
        rfc: RFC_GENERICO,
        esExtranjero: false,
        regimenFiscalClave: '616',
        pais: 'México',
        codigoPostal: null,
        colonia: null,
        calle: null,
        numeroExterior: null,
        numeroInterior: null,
        estado: null,
        municipio: null,
        localidad: null,
        correo: null,
        telefono: null,
        listaPrecioPredeterminadaId: null,
        esGenerico: true,
        activo: true,
      }),
    );
  }
}

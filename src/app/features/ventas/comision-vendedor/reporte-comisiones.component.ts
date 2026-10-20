import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DataClientService, FiltroRango } from '../../../core/services/data-client.service';
import { Usuario, nombreCompletoUsuario } from '../../seguridad/usuarios/usuario.model';
import { Devolucion, DevolucionItem } from '../devolucion/devolucion.model';
import { Venta } from '../venta/venta.model';
import { formatMoneda, redondear } from '../ventas.util';
import { ComisionVendedor } from './comision-vendedor.model';

interface FilaReporteComision {
  usuario: Usuario;
  numeroVentas: number;
  totalVentas: number;
  totalDevuelto: number;
  ventasNetas: number;
  comision: ComisionVendedor | null;
  montoComision: number;
}

/**
 * Comisión a pagar por vendedor en un periodo — usa la comisión
 * configurada en ComisionesVendedoresComponent. "Ventas netas" resta lo
 * devuelto (ver Devolucion/DevolucionItem) de cada venta Completada del
 * periodo, para no pagar comisión sobre algo que el cliente regresó. La
 * comisión se calcula sobre lo VENDIDO, no sobre lo ya cobrado — una venta
 * a Crédito sin abonar todavía también genera comisión (decisión de
 * alcance, documentada aquí; se puede revisar si el negocio prefiere
 * pagar comisión solo al cobrar).
 */
@Component({
  selector: 'app-reporte-comisiones',
  standalone: true,
  imports: [],
  templateUrl: './reporte-comisiones.component.html',
  styleUrl: './reporte-comisiones.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReporteComisionesComponent implements OnInit, OnDestroy {
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  private readonly data = inject(DataClientService);
  protected readonly formatMoneda = formatMoneda;

  protected readonly cargando = signal(true);
  protected readonly fechaDesde = signal(this.primerDiaMesISO());
  protected readonly fechaHasta = signal(this.hoyISO());

  private readonly usuarios = signal<Usuario[]>([]);
  private readonly ventas = signal<Venta[]>([]);
  private readonly devolucionItemsPorVenta = signal<Map<number, number>>(new Map());
  private readonly comisiones = signal<ComisionVendedor[]>([]);

  protected readonly filas = computed<FilaReporteComision[]>(() => {
    // this.ventas() ya viene acotada por fechaDesde/fechaHasta desde el
    // servidor (ver cargar()) — aquí solo falta descartar las que no están
    // Completadas.
    const devueltoPorVenta = this.devolucionItemsPorVenta();
    const ventasPeriodo = this.ventas().filter((v) => v.estado === 'Completada');

    return this.usuarios()
      .filter((u) => u.activo !== false)
      .map((usuario) => {
        const ventasVendedor = ventasPeriodo.filter((v) => v.vendedorUsuarioId === usuario.id);
        const totalVentas = redondear(ventasVendedor.reduce((acc, v) => acc + v.total, 0));
        const totalDevuelto = redondear(
          ventasVendedor.reduce((acc, v) => acc + (devueltoPorVenta.get(v.id) ?? 0), 0),
        );
        const ventasNetas = redondear(totalVentas - totalDevuelto);
        const comision = this.comisiones().find((c) => c.usuarioId === usuario.id) ?? null;
        const montoComision = redondear(
          !comision
            ? 0
            : comision.tipo === 'Porcentaje'
              ? ventasNetas * (comision.valor / 100)
              : ventasVendedor.length * comision.valor,
        );
        return {
          usuario,
          numeroVentas: ventasVendedor.length,
          totalVentas,
          totalDevuelto,
          ventasNetas,
          comision,
          montoComision,
        };
      })
      .filter((f) => f.numeroVentas > 0)
      .sort((a, b) => b.montoComision - a.montoComision);
  });

  protected readonly totalComisiones = computed(() => redondear(this.filas().reduce((acc, f) => acc + f.montoComision, 0)));

  private hoyISO(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private primerDiaMesISO(): string {
    const hoy = new Date();
    return new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10);
  }

  async ngOnInit(): Promise<void> {
    document.documentElement.setAttribute('data-wide', 'grid');
    const [usuarios, comisiones] = await Promise.all([
      firstValueFrom(this.data.list<Usuario>('Usuario')),
      firstValueFrom(this.data.list<ComisionVendedor>('ComisionVendedor')),
    ]);
    this.usuarios.set(usuarios);
    this.comisiones.set(comisiones);
    await this.cargar();
  }

  /** Vuelve a pedir Venta/Devolucion/DevolucionItem al servidor, acotadas al
   *  periodo Desde–Hasta vigente — Venta y sus devoluciones son tablas que
   *  crecen sin límite con el tiempo, así que NUNCA se traen completas:
   *  mismo riesgo de 504 Gateway Timeout que ya se corrigió en el dashboard
   *  de ventas. También reemplaza el N+1 anterior (una consulta de
   *  DevolucionItem POR CADA devolución que haya existido alguna vez) por
   *  un solo .in() sobre los ids de devolución de SOLO las ventas del
   *  periodo. */
  protected async cargar(): Promise<void> {
    this.cargando.set(true);
    const desde = this.fechaDesde();
    const hasta = this.fechaHasta();
    const rangoFecha: FiltroRango = {};
    if (desde) rangoFecha.gte = `${desde}T00:00:00`;
    if (hasta) rangoFecha.lte = `${hasta}T23:59:59`;
    const filtroFecha = rangoFecha.gte !== undefined || rangoFecha.lte !== undefined ? { fecha: rangoFecha } : {};

    const ventas = await firstValueFrom(this.data.list<Venta>('Venta', filtroFecha));
    this.ventas.set(ventas);

    // Una devolución cuenta para "ventas netas" del periodo de la VENTA, sin
    // importar cuándo se procesó el regreso — así que se acota por los ids
    // de venta del periodo, no por la fecha de la propia devolución (eso
    // cambiaría el resultado: una devolución tardía dejaría de descontarse).
    const idsVentas = ventas.map((v) => v.id);
    if (idsVentas.length === 0) {
      this.devolucionItemsPorVenta.set(new Map());
      this.cargando.set(false);
      return;
    }
    const devoluciones = await firstValueFrom(this.data.list<Devolucion>('Devolucion', { ventaId: idsVentas }));
    const idsDevoluciones = devoluciones.map((d) => d.id);
    const items =
      idsDevoluciones.length > 0
        ? await firstValueFrom(this.data.list<DevolucionItem>('DevolucionItem', { devolucionId: idsDevoluciones }))
        : [];

    const itemsPorDevolucion = new Map<number, DevolucionItem[]>();
    for (const item of items) {
      const arr = itemsPorDevolucion.get(item.devolucionId) ?? [];
      arr.push(item);
      itemsPorDevolucion.set(item.devolucionId, arr);
    }
    const mapa = new Map<number, number>();
    for (const devolucion of devoluciones) {
      const totalItems = (itemsPorDevolucion.get(devolucion.id) ?? []).reduce((acc, item) => acc + item.subtotal, 0);
      mapa.set(devolucion.ventaId, (mapa.get(devolucion.ventaId) ?? 0) + totalItems);
    }
    this.devolucionItemsPorVenta.set(mapa);

    this.cargando.set(false);
  }

  protected cambiarFechaDesde(valor: string): void {
    this.fechaDesde.set(valor);
    void this.cargar();
  }

  protected cambiarFechaHasta(valor: string): void {
    this.fechaHasta.set(valor);
    void this.cargar();
  }
}

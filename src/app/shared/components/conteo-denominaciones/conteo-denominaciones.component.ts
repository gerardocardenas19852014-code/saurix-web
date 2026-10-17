import { ChangeDetectionStrategy, Component, EventEmitter, Output, computed, signal } from '@angular/core';
import { ConteoEfectivoResultado, DENOMINACIONES_MXN } from './conteo-denominaciones.model';

/**
 * Captura de efectivo por denominación (billetes/monedas), reutilizable en
 * Apertura y Cierre de caja cuando el parámetro "Conteo de caja por
 * denominación" está activo (ver ConfiguracionVentasService, Panel de
 * Control → Parámetros del sistema). Emite el total calculado y el
 * desglose cada vez que cambia una cantidad — la pantalla que lo usa no
 * necesita saber las denominaciones, solo reacciona al total.
 */
@Component({
  selector: 'app-conteo-denominaciones',
  standalone: true,
  imports: [],
  templateUrl: './conteo-denominaciones.component.html',
  styleUrl: './conteo-denominaciones.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConteoDenominacionesComponent {
  @Output() readonly cambio = new EventEmitter<ConteoEfectivoResultado>();

  protected readonly denominaciones = DENOMINACIONES_MXN;
  private readonly cantidades = signal<Record<number, number>>({});

  protected readonly total = computed(() => {
    const cantidades = this.cantidades();
    return this.denominaciones.reduce((acc, d) => acc + d.valor * (cantidades[d.valor] ?? 0), 0);
  });

  cantidadDe(valor: number): number {
    return this.cantidades()[valor] ?? 0;
  }

  actualizarCantidad(valor: number, cantidadTexto: string): void {
    const cantidad = Math.max(0, Math.floor(Number(cantidadTexto) || 0));
    this.cantidades.update((actual) => ({ ...actual, [valor]: cantidad }));
    this.emitir();
  }

  private emitir(): void {
    const cantidades = this.cantidades();
    const desglose = this.denominaciones
      .map((d) => ({ valor: d.valor, cantidad: cantidades[d.valor] ?? 0 }))
      .filter((d) => d.cantidad > 0);
    this.cambio.emit({ total: this.total(), desglose });
  }
}

import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { RouterLink, Router } from '@angular/router';
import { DatePipe, DecimalPipe } from '@angular/common';
import { AuthService } from '../../../core/services/auth.service';
import { ConteoDenominacionesComponent } from '../../../shared/components/conteo-denominaciones/conteo-denominaciones.component';
import { ConteoEfectivoResultado } from '../../../shared/components/conteo-denominaciones/conteo-denominaciones.model';
import { ConfiguracionVentasService } from '../../../shared/services/configuracion-ventas.service';
import { ToastService } from '../../../shared/services/toast.service';
import { formatMoneda } from '../ventas.util';
import { ResumenTurno, TurnoCaja } from './turno-caja.model';
import { TurnoCajaService } from './turno-caja.service';

/** Cierre de caja — termina el turno: pide contar el efectivo físico y lo
 *  compara contra lo que el sistema esperaba (ver TurnoCajaService.cerrar()),
 *  mostrando sobrante/faltante. A diferencia de Corte, aquí sí cambia el
 *  estado del turno a Cerrado y ya no se puede seguir vendiendo con él. */
@Component({
  selector: 'app-cierre-turno',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, DatePipe, DecimalPipe, ConteoDenominacionesComponent],
  templateUrl: './cierre-turno.component.html',
  styleUrl: './cierre-turno.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CierreTurnoComponent implements OnInit {
  protected readonly formatMoneda = formatMoneda;

  private readonly auth = inject(AuthService);
  private readonly turnoCajaService = inject(TurnoCajaService);
  protected readonly configuracionVentas = inject(ConfiguracionVentasService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  private conteoActual: ConteoEfectivoResultado | null = null;
  protected readonly cargando = signal(true);
  protected readonly turno = signal<TurnoCaja | null>(null);
  protected readonly resumen = signal<ResumenTurno | null>(null);
  protected readonly turnoCerrado = signal<TurnoCaja | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    montoContado: [0, [Validators.required, Validators.min(0)]],
    notas: [''],
  });

  async ngOnInit(): Promise<void> {
    await this.configuracionVentas.cargar();
    const usuario = this.auth.usuarioActual();
    if (!usuario) return;

    const turno = await this.turnoCajaService.turnoAbierto(usuario.id);
    this.turno.set(turno);
    if (turno) {
      this.resumen.set(await this.turnoCajaService.resumen(turno));
    }
    this.cargando.set(false);
  }

  actualizarConteo(resultado: ConteoEfectivoResultado): void {
    this.conteoActual = resultado;
    this.form.controls.montoContado.setValue(resultado.total);
  }

  async cerrar(): Promise<void> {
    const turno = this.turno();
    if (!turno || this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const valor = this.form.getRawValue();
    const cerrado = await this.turnoCajaService.cerrar(turno, valor.montoContado, valor.notas || null);
    if (this.configuracionVentas.conteoCajaPorDenominacion() && this.conteoActual?.desglose.length) {
      await this.turnoCajaService.guardarDenominaciones(cerrado.id, 'Cierre', this.conteoActual.desglose);
    }
    this.toast.exito('Turno de caja cerrado.');
    this.turnoCerrado.set(cerrado);
  }

  irAModulos(): void {
    this.router.navigateByUrl('/modulos');
  }
}

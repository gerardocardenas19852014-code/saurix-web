import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { ConteoDenominacionesComponent } from '../../../shared/components/conteo-denominaciones/conteo-denominaciones.component';
import { ConteoEfectivoResultado } from '../../../shared/components/conteo-denominaciones/conteo-denominaciones.model';
import { ConfiguracionVentasService } from '../../../shared/services/configuracion-ventas.service';
import { ToastService } from '../../../shared/services/toast.service';
import { TurnoCajaService } from './turno-caja.service';

/**
 * Apertura de turno de caja — primer paso del flujo de Ventas: sin un turno
 * Abierto no se puede entrar a Cobro (ver cobro.component.ts → ngOnInit,
 * que redirige aquí si turnoAbierto() da null). Si el usuario ya tenía un
 * turno abierto (p.ej. recargó la página), se le manda derecho a Cobro en
 * vez de dejarlo abrir uno nuevo encima.
 */
@Component({
  selector: 'app-apertura-turno',
  standalone: true,
  imports: [ReactiveFormsModule, ConteoDenominacionesComponent, DecimalPipe],
  templateUrl: './apertura-turno.component.html',
  styleUrl: './apertura-turno.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AperturaTurnoComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly turnoCajaService = inject(TurnoCajaService);
  protected readonly configuracionVentas = inject(ConfiguracionVentasService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  protected readonly guardando = signal(false);
  private conteoActual: ConteoEfectivoResultado | null = null;

  protected readonly form = this.fb.nonNullable.group({
    montoApertura: [0, [Validators.required, Validators.min(0)]],
    notas: [''],
  });

  async ngOnInit(): Promise<void> {
    await this.configuracionVentas.cargar();
    const usuario = this.auth.usuarioActual();
    if (!usuario) return;
    const existente = await this.turnoCajaService.turnoAbierto(usuario.id);
    if (existente) {
      this.router.navigateByUrl('/ventas/cobro');
    }
  }

  actualizarConteo(resultado: ConteoEfectivoResultado): void {
    this.conteoActual = resultado;
    this.form.controls.montoApertura.setValue(resultado.total);
  }

  async abrir(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const usuario = this.auth.usuarioActual();
    if (!usuario) return;

    this.guardando.set(true);
    const valor = this.form.getRawValue();
    const turno = await this.turnoCajaService.abrir(usuario.id, valor.montoApertura, valor.notas || null);
    if (this.configuracionVentas.conteoCajaPorDenominacion() && this.conteoActual?.desglose.length) {
      await this.turnoCajaService.guardarDenominaciones(turno.id, 'Apertura', this.conteoActual.desglose);
    }
    this.toast.exito('Turno de caja abierto.');
    this.router.navigateByUrl('/ventas/cobro');
  }
}

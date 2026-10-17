import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../shared/services/toast.service';
import { ProgramaLealtadService } from './lealtad.service';

/**
 * Configuración del programa de lealtad/puntos — fila única (ver
 * lealtad.service.ts). Vive en Ventas → Catálogos porque es propia de
 * Ventas (no se pidió controlarla desde Panel de Control, a diferencia
 * del conteo de caja por denominación — ver parametros.component.ts).
 */
@Component({
  selector: 'app-configuracion-lealtad',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './configuracion-lealtad.component.html',
  styleUrl: './configuracion-lealtad.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfiguracionLealtadComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  protected readonly lealtadService = inject(ProgramaLealtadService);

  protected readonly esAdmin = this.auth.usuarioActual()?.role === 'admin';

  protected readonly form = this.fb.nonNullable.group({
    programaActivo: [false],
    pesosPorPunto: [10, [Validators.required, Validators.min(0.01)]],
    pesosDescuentoPorPunto: [1, [Validators.required, Validators.min(0.01)]],
  });

  async ngOnInit(): Promise<void> {
    await this.lealtadService.cargar();
    this.form.reset({
      programaActivo: this.lealtadService.programaActivo(),
      pesosPorPunto: this.lealtadService.pesosPorPunto(),
      pesosDescuentoPorPunto: this.lealtadService.pesosDescuentoPorPunto(),
    });
    if (!this.esAdmin) this.form.disable();
  }

  async guardar(): Promise<void> {
    if (!this.esAdmin || this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const valor = this.form.getRawValue();
    try {
      await this.lealtadService.guardarConfiguracion(valor);
      this.toast.exito('Configuración del programa de lealtad guardada.');
    } catch {
      this.toast.error('No se pudo guardar la configuración.');
    }
  }
}

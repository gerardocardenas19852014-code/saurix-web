import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ToastService } from '../../../shared/services/toast.service';
import { calcularRfcYCurp, OPCIONES_ENTIDAD, OPCIONES_SEXO, ResultadoRfcCurp } from './rfc-curp.util';

/**
 * Calculadora de RFC (con homoclave) y CURP para personas físicas, a partir
 * de nombre(s), apellidos, fecha de nacimiento, sexo y entidad de
 * nacimiento. Ver rfc-curp.util.ts para el detalle de los algoritmos y su
 * alcance (por qué es una "pre-validación" y no el documento oficial).
 *
 * Es solo una calculadora puntual: no guarda nada en la base de datos local,
 * cada cálculo se muestra en pantalla y se descarta al cerrar/limpiar.
 */
@Component({
  selector: 'app-rfc-curp',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './rfc-curp.component.html',
  styleUrl: './rfc-curp.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RfcCurpComponent {
  private readonly fb = inject(FormBuilder);
  protected readonly toast = inject(ToastService);

  protected readonly opcionesEntidad = OPCIONES_ENTIDAD;
  protected readonly opcionesSexo = OPCIONES_SEXO;

  protected readonly resultado = signal<ResultadoRfcCurp | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    nombre: ['', Validators.required],
    apellidoPaterno: ['', Validators.required],
    apellidoMaterno: [''],
    fechaNacimiento: ['', Validators.required],
    sexo: ['', Validators.required],
    entidadNacimiento: ['', Validators.required],
  });

  calcular(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toast.advertencia('Completa nombre, apellido paterno, fecha de nacimiento, sexo y entidad de nacimiento.');
      return;
    }

    const valores = this.form.getRawValue();
    try {
      const resultado = calcularRfcYCurp({
        nombre: valores.nombre.trim(),
        apellidoPaterno: valores.apellidoPaterno.trim(),
        apellidoMaterno: valores.apellidoMaterno.trim(),
        fechaNacimiento: valores.fechaNacimiento,
        sexo: valores.sexo,
        entidadNacimiento: valores.entidadNacimiento,
      });
      this.resultado.set(resultado);
    } catch {
      this.resultado.set(null);
      this.toast.error('No se pudo calcular el RFC/CURP. Revisa que los datos capturados sean válidos.');
    }
  }

  limpiar(): void {
    this.form.reset({
      nombre: '',
      apellidoPaterno: '',
      apellidoMaterno: '',
      fechaNacimiento: '',
      sexo: '',
      entidadNacimiento: '',
    });
    this.resultado.set(null);
  }

  copiar(valor: string, etiqueta: string): void {
    try {
      void navigator.clipboard?.writeText(valor);
      this.toast.exito(`${etiqueta} copiado al portapapeles.`);
    } catch {
      this.toast.advertencia('No se pudo copiar automáticamente; selecciona y copia el valor manualmente.');
    }
  }
}

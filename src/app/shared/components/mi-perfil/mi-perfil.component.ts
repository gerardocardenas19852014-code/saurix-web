import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { DataClientService } from '../../../core/services/data-client.service';
import { Usuario } from '../../../features/seguridad/usuarios/usuario.model';
import { BitacoraService } from '../../services/bitacora.service';
import { ToastService } from '../../services/toast.service';
import { evaluarFortaleza, hashPassword } from '../../utils/password.util';

/** Mínimo 8 caracteres, con al menos una mayúscula y un número — misma
 *  política que el formulario de Usuarios (ver usuarios-list.component.ts). */
function passwordSeguraValidator(control: AbstractControl): ValidationErrors | null {
  const valor: string = control.value ?? '';
  if (!valor) return null;
  const cumple = valor.length >= 8 && /[A-Z]/.test(valor) && /[0-9]/.test(valor);
  return cumple ? null : { passwordDebil: true };
}

function passwordsCoincidenValidator(grupo: AbstractControl): ValidationErrors | null {
  const nueva = grupo.get('passwordNueva')?.value ?? '';
  const confirmacion = grupo.get('confirmacionPassword')?.value ?? '';
  if (!nueva) return null;
  return nueva === confirmacion ? null : { passwordsNoCoinciden: true };
}

/**
 * Autoservicio de contraseña para el usuario en sesión — cualquiera puede
 * cambiar la suya propia sin pasar por el módulo de Usuarios (que requiere
 * editar a alguien más). Vive en el shell (barra superior) porque aplica a
 * cualquier módulo, no solo a Seguridad.
 *
 * También es el punto donde se OBLIGA el cambio de contraseña cuando un
 * admin usó el botón "Resetear contraseña" (Usuario.debeCambiarPassword):
 * mientras esa bandera siga en true, este modal se abre solo y no se puede
 * cerrar hasta que la contraseña se cambie de verdad.
 */
@Component({
  selector: 'app-mi-perfil',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './mi-perfil.component.html',
  styleUrl: './mi-perfil.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MiPerfilComponent {
  private readonly auth = inject(AuthService);
  private readonly data = inject(DataClientService);
  private readonly bitacora = inject(BitacoraService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly abierta = signal(false);
  protected readonly guardando = signal(false);
  protected readonly mostrarPassword = signal(false);

  protected readonly usuarioActual = this.auth.usuarioActual;

  /** true si toca cambiar la contraseña sí o sí (reseteo del admin) — mientras
   *  sea así, el modal no se puede cerrar (ver cerrar()). */
  protected readonly forzado = computed(() => this.usuarioActual()?.debeCambiarPassword === true);

  protected readonly form = this.fb.nonNullable.group(
    {
      passwordActual: ['', Validators.required],
      passwordNueva: ['', [Validators.required, passwordSeguraValidator]],
      confirmacionPassword: ['', Validators.required],
    },
    { validators: [passwordsCoincidenValidator] },
  );

  private readonly passwordEnVivo = toSignal(this.form.controls.passwordNueva.valueChanges, { initialValue: '' });
  protected readonly fortalezaPassword = computed(() => evaluarFortaleza(this.passwordEnVivo() ?? ''));

  constructor() {
    // Si el usuario en sesión trae debeCambiarPassword, se fuerza el modal
    // abierto de inmediato (al iniciar sesión, o si ya estaba adentro y un
    // admin le resetea la contraseña en otra pestaña).
    effect(() => {
      if (this.forzado()) this.abierta.set(true);
    });
  }

  abrir(): void {
    this.form.reset({ passwordActual: '', passwordNueva: '', confirmacionPassword: '' });
    this.mostrarPassword.set(false);
    this.abierta.set(true);
  }

  cerrar(): void {
    if (this.forzado()) return;
    this.abierta.set(false);
    this.toast.info('Cambios descartados.');
  }

  alternarMostrarPassword(): void {
    this.mostrarPassword.update((v) => !v);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.mostrarErroresValidacion();
      return;
    }

    const usuario = this.usuarioActual();
    if (!usuario) return;

    const { passwordActual, passwordNueva } = this.form.getRawValue();
    this.guardando.set(true);

    hashPassword(passwordActual).then((hashActual) => {
      if (usuario.password && usuario.password !== hashActual) {
        this.guardando.set(false);
        this.toast.error('Tu contraseña actual no es correcta.');
        return;
      }

      hashPassword(passwordNueva).then((hashNueva) => {
        if (hashNueva === usuario.password) {
          this.guardando.set(false);
          this.toast.advertencia('La nueva contraseña debe ser diferente a la actual.');
          return;
        }

        this.data
          .modificacion<Usuario>('Usuario', {
            ...usuario,
            password: hashNueva,
            debeCambiarPassword: false,
            intentosFallidos: 0,
            bloqueadoHasta: null,
          })
          .subscribe({
            next: (actualizado) => {
              this.auth.actualizarSesion(actualizado);
              this.bitacora
                .registrar({
                  modulo: 'Seguridad / Usuarios',
                  entidad: 'Usuario',
                  accion: 'Cambio de contraseña (Mi Perfil)',
                  usuario: actualizado.nombreUsuario,
                  registroId: actualizado.id,
                })
                .subscribe();
              this.guardando.set(false);
              this.abierta.set(false);
              this.toast.exito('Tu contraseña se actualizó correctamente.');
            },
            error: () => {
              this.guardando.set(false);
              this.toast.error('No fue posible actualizar tu contraseña.');
            },
          });
      });
    });
  }

  private mostrarErroresValidacion(): void {
    const c = this.form.controls;
    if (c.passwordActual.errors?.['required']) this.toast.error('Captura tu contraseña actual.');
    if (c.passwordNueva.errors?.['required']) this.toast.error('Captura la nueva contraseña.');
    else if (c.passwordNueva.errors?.['passwordDebil']) {
      this.toast.error('La nueva contraseña debe tener al menos 8 caracteres, con una mayúscula y un número.');
    }
    if (this.form.errors?.['passwordsNoCoinciden']) this.toast.error('Las contraseñas no coinciden.');
  }
}

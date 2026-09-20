import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../shared/services/toast.service';

const USUARIO_RECORDADO_KEY = 'saurix.usuarioRecordado';

function leerUsuarioRecordado(): string {
  try {
    return localStorage.getItem(USUARIO_RECORDADO_KEY) ?? '';
  } catch {
    return '';
  }
}

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly toast = inject(ToastService);

  protected readonly enviando = signal(false);
  protected readonly mensajeError = signal('');

  protected readonly form = this.fb.nonNullable.group({
    usuario: [leerUsuarioRecordado(), Validators.required],
    password: ['', Validators.required],
    recordarUsuario: [leerUsuarioRecordado() !== ''],
  });

  entrar(): void {
    this.mensajeError.set('');
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.mensajeError.set('Captura el usuario y la contraseña para continuar.');
      return;
    }
    const { usuario, password, recordarUsuario } = this.form.getRawValue();
    this.enviando.set(true);
    this.auth.iniciarSesion(usuario, password).subscribe({
      next: () => {
        try {
          if (recordarUsuario) localStorage.setItem(USUARIO_RECORDADO_KEY, usuario.trim());
          else localStorage.removeItem(USUARIO_RECORDADO_KEY);
        } catch {
          /* localStorage no disponible; se ignora */
        }
        this.router.navigateByUrl('/modulos');
      },
      error: (error: Error) => {
        this.enviando.set(false);
        const mensaje = error.message || 'No fue posible iniciar sesión.';
        this.mensajeError.set(mensaje);
        this.toast.error(mensaje);
      },
    });
  }
}

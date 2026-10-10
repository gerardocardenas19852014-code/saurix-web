import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { fuenteDatosActual } from '../../../core/services/fuente-datos';
import { SupabaseService } from '../../../core/services/supabase.service';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../shared/services/toast.service';
import { hashPassword, passwordCumpleMinimo } from '../../../shared/utils/password.util';

/**
 * /restablecer — a donde llega el enlace del correo "¿Olvidaste tu
 * contraseña?" (solo Nube). Supabase abre una sesión temporal de
 * recuperación al cargar la página; aquí se elige la contraseña nueva, se
 * guarda (como hash SHA-256, igual que el resto de la app) y se cierra la
 * sesión para entrar de nuevo con ella.
 */
@Component({
  selector: 'app-restablecer',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './restablecer.component.html',
  styleUrl: '../login/login.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RestablecerComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  protected readonly enNube = fuenteDatosActual() === 'supabase';
  private readonly sb = this.enNube ? inject(SupabaseService).cliente : null;

  protected readonly listo = signal(false);
  protected readonly sesionValida = signal(false);
  protected readonly guardando = signal(false);
  protected readonly verPassword = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    password: ['', Validators.required],
    confirmacion: ['', Validators.required],
  });

  async ngOnInit(): Promise<void> {
    if (!this.sb) {
      this.listo.set(true);
      return;
    }
    // El cliente procesa el enlace del correo al cargar; se da un momento.
    for (let i = 0; i < 10; i++) {
      const { data } = await this.sb.auth.getSession();
      if (data.session) {
        this.sesionValida.set(true);
        break;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    this.listo.set(true);
  }

  async guardar(): Promise<void> {
    const { password, confirmacion } = this.form.getRawValue();
    if (!passwordCumpleMinimo(password)) {
      this.toast.error('La contraseña debe tener al menos 8 caracteres, una mayúscula y un número.');
      return;
    }
    if (password !== confirmacion) {
      this.toast.error('Las contraseñas no coinciden.');
      return;
    }
    if (!this.sb) return;
    this.guardando.set(true);
    const { error } = await this.sb.auth.updateUser({ password: await hashPassword(password) });
    this.guardando.set(false);
    if (error) {
      // Supabase rechaza con 422/"same_password" si la nueva contraseña es
      // igual a la que ya tiene la cuenta: el mensaje genérico de "pide un
      // enlace nuevo" confundía (el enlace seguía siendo válido, solo había
      // que escribir una contraseña distinta a la actual).
      if (error.code === 'same_password') {
        this.toast.error('La nueva contraseña debe ser distinta a la actual. Escribe una diferente.');
      } else {
        this.toast.error('No se pudo guardar la contraseña. Pide un enlace nuevo e inténtalo otra vez.');
      }
      return;
    }
    this.auth.cerrarSesion();
    this.toast.exito('Contraseña actualizada. Ya puedes iniciar sesión con ella.');
    this.router.navigateByUrl('/login');
  }

  irALogin(): void {
    this.router.navigateByUrl('/login');
  }
}

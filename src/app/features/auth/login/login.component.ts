import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../shared/services/toast.service';
import { CONEXIONES, conexionActual, guardarConexion } from '../../../core/services/conexion';
import { SupabaseService } from '../../../core/services/supabase.service';
import { VERSION_APP } from '../../../core/version';

const USUARIO_RECORDADO_KEY = 'saurix.usuarioRecordado';

function leerUsuarioRecordado(): string {
  try {
    return localStorage.getItem(USUARIO_RECORDADO_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Módulos que se muestran en el panel de bienvenida del login. */
const MODULOS = [
  { icono: '📚', nombre: 'WikiDocs' },
  { icono: '🔒', nombre: 'Seguridad' },
  { icono: '⚙️', nombre: 'Panel de control' },
  { icono: '💰', nombre: 'Presupuesto' },
  { icono: '📋', nombre: 'Proyectos' },
  { icono: '👨‍👩‍👧', nombre: 'Familia' },
];

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

  private readonly sb = inject(SupabaseService).cliente;
  protected readonly conexiones = CONEXIONES;
  protected readonly conexion = conexionActual();
  protected readonly version = VERSION_APP;
  protected readonly modulos = MODULOS;

  protected readonly enviando = signal(false);
  protected readonly mensajeError = signal('');
  protected readonly verPassword = signal(false);
  protected readonly bloqMayus = signal(false);

  // ¿Olvidaste tu contraseña? (solo Nube)
  protected readonly modoRecuperar = signal(false);
  protected readonly enviandoRecuperacion = signal(false);
  protected readonly recuperacionEnviada = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    usuario: [leerUsuarioRecordado(), Validators.required],
    password: ['', Validators.required],
    recordarUsuario: [leerUsuarioRecordado() !== ''],
  });

  /** Cambia de proyecto de Supabase (solo aparece si hay más de uno). */
  cambiarConexion(clave: string): void {
    if (clave === this.conexion.clave) return;
    this.auth.cerrarSesion();
    guardarConexion(clave);
    window.location.reload();
  }

  /** Detecta Bloq Mayús mientras se escribe la contraseña. */
  revisarMayusculas(evento: KeyboardEvent): void {
    if (typeof evento.getModifierState === 'function') {
      this.bloqMayus.set(evento.getModifierState('CapsLock'));
    }
  }

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

  // ── ¿Olvidaste tu contraseña? ─────────────────────────────────────
  abrirRecuperar(): void {
    this.mensajeError.set('');
    this.recuperacionEnviada.set(false);
    this.modoRecuperar.set(true);
  }

  cerrarRecuperar(): void {
    this.modoRecuperar.set(false);
  }

  /**
   * Manda el correo de Supabase con el enlace para elegir una contraseña
   * nueva (pantalla /restablecer). Siempre responde lo mismo, exista o no el
   * usuario, para no revelar qué cuentas hay.
   */
  async enviarRecuperacion(): Promise<void> {
    const usuario = this.form.controls.usuario.value.trim();
    if (!usuario) {
      this.toast.error('Escribe tu usuario o correo.');
      return;
    }
    if (!this.sb) return;
    this.enviandoRecuperacion.set(true);
    try {
      const { data: email } = await this.sb.schema('seguridad').rpc('email_para_login', { p_usuario: usuario });
      if (email) {
        const destino = new URL('restablecer', document.baseURI).href;
        await this.sb.auth.resetPasswordForEmail(email as string, { redirectTo: destino });
      }
      this.recuperacionEnviada.set(true);
    } catch {
      this.toast.error('No se pudo enviar el correo. Intenta más tarde.');
    } finally {
      this.enviandoRecuperacion.set(false);
    }
  }
}

import { Injectable, inject } from '@angular/core';
import { AuthService } from './auth.service';

/**
 * Al arrancar la app (ver `provideAppInitializer` en app.config.ts): valida
 * que la sesión guardada de Supabase Auth siga viva y recarga el perfil del
 * usuario (rol, activo, vigencia pueden haber cambiado desde el último
 * login). Si no hay sesión válida, la app arranca sin usuario (va a login).
 */
@Injectable({ providedIn: 'root' })
export class SeedService {
  private readonly auth = inject(AuthService);

  async ejecutar(): Promise<void> {
    await this.auth.restaurarSesion();
  }
}

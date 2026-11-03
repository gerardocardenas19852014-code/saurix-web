import { Injectable, inject, signal } from '@angular/core';
import { Observable, firstValueFrom, from } from 'rxjs';
import { DataClientService } from './data-client.service';
import { Usuario } from '../../features/seguridad/usuarios/usuario.model';
import { BitacoraService } from '../../shared/services/bitacora.service';
import { hashPassword } from '../../shared/utils/password.util';
import { SupabaseService } from './supabase.service';
import { filaACamel } from './supabase-data-client.service';
import { LicenciaModulosService } from './licencia-modulos.service';

const STORAGE_KEY = 'saurix.sesion';
const MODULO_BITACORA = 'Seguridad / Usuarios';

/**
 * Sesión de la app contra Supabase Auth, con reglas reales de acceso:
 *  - la contraseña SÍ se valida (hash SHA-256 vía password.util);
 *  - un usuario marcado "Activo: No" no puede iniciar sesión;
 *  - un usuario fuera de su rango de vigencia tampoco puede iniciar sesión.
 * Cualquier usuario se da de alta desde el módulo de Usuarios o desde
 * Empresas (primer admin), nunca desde la pantalla de login.
 *
 * La sesión se guarda en localStorage (clave `saurix.sesion`) para que
 * sobreviva a un refresh, pero es solo un espejo del registro real en
 * Supabase (tabla seguridad.usuario) — nunca la fuente de verdad.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly data = inject(DataClientService);
  // BitacoraService NO depende de AuthService (a propósito, ver bitacora.service.ts),
  // así que esta inyección es de un solo sentido y no forma un ciclo.
  private readonly bitacora = inject(BitacoraService);
  private readonly licencia = inject(LicenciaModulosService);

  readonly usuarioActual = signal<Usuario | null>(this.leerSesionGuardada());

  private readonly sb = inject(SupabaseService).cliente;

  constructor() {
    // Si Supabase cierra la sesión por su cuenta (token vencido, cierre en
    // otra pestaña), la app también la cierra.
    this.sb.auth.onAuthStateChange((evento) => {
      if (evento === 'SIGNED_OUT') this.limpiarSesionLocal();
    });
  }

  iniciarSesion(nombreUsuario: string, password: string): Observable<Usuario> {
    return from(this.iniciarSesionSupabase(nombreUsuario, password));
  }

  /**
   * Al arrancar la app: confirma que la sesión de Auth guardada sigue viva
   * y recarga el perfil (rol, activo, vigencia pueden haber cambiado). Si
   * no hay sesión válida, deja la app sin usuario.
   */
  async restaurarSesion(): Promise<void> {
    const { data } = await this.sb.auth.getSession();
    if (!data.session) {
      this.limpiarSesionLocal();
      return;
    }
    try {
      const perfil = await this.cargarPerfilSupabase(data.session.user.id);
      this.validarAcceso(perfil);
      this.establecerSesion(perfil);
      await this.licencia.cargar();
    } catch {
      await this.sb.auth.signOut();
      this.limpiarSesionLocal();
    }
  }

  /**
   * Refresca la sesión guardada con un registro de Usuario ya actualizado
   * (p.ej. después de que el propio usuario cambia su contraseña en "Mi
   * Perfil") — sin esto, `usuarioActual()` se quedaría con los datos viejos
   * hasta el próximo login.
   */
  actualizarSesion(usuario: Usuario): void {
    this.establecerSesion(usuario);
  }

  cerrarSesion(): void {
    this.limpiarSesionLocal();
    this.licencia.limpiar();
    void this.sb.auth.signOut();
  }

  private limpiarSesionLocal(): void {
    this.usuarioActual.set(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* localStorage no disponible; se ignora */
    }
  }

  // ── Modo Supabase ─────────────────────────────────────────────────────
  // La contraseña la valida Supabase Auth (con su propio límite de
  // intentos). La app guarda en Auth el hash SHA-256 de la contraseña —el
  // mismo que ya producen Usuarios y Mi Perfil—, así que aquí también se
  // envía el hash. Si la cuenta se creó desde el panel de Supabase con la
  // contraseña en claro, se acepta una vez y se migra al formato de la app.
  private async iniciarSesionSupabase(nombreUsuario: string, password: string): Promise<Usuario> {
    const sb = this.sb;
    const generico = 'Usuario o contraseña incorrectos.';
    const { data: email, error: errEmail } = await sb
      .schema('seguridad')
      .rpc('email_para_login', { p_usuario: nombreUsuario.trim() });
    if (errEmail) throw new Error('No se pudo conectar con el servidor. Revisa tu conexión.');
    if (!email) throw new Error(generico);

    const hash = await hashPassword(password);
    let intento = await sb.auth.signInWithPassword({ email: email as string, password: hash });
    if (intento.error) {
      const enClaro = await sb.auth.signInWithPassword({ email: email as string, password });
      if (enClaro.error) {
        if (intento.error.status === 429 || enClaro.error.status === 429) {
          throw new Error('Demasiados intentos. Espera unos minutos e inténtalo de nuevo.');
        }
        throw new Error(generico);
      }
      intento = enClaro;
      await sb.auth.updateUser({ password: hash });
    }

    let perfil: Usuario;
    try {
      perfil = await this.cargarPerfilSupabase(intento.data.user!.id);
      this.validarAcceso(perfil);
    } catch (error) {
      await sb.auth.signOut();
      throw error;
    }

    const actualizado = await firstValueFrom(
      this.data.modificacion<Usuario>('Usuario', { id: perfil.id, ultimoAcceso: new Date().toISOString() }),
    );
    this.bitacora
      .registrar({
        modulo: MODULO_BITACORA,
        entidad: 'Usuario',
        accion: 'Inicio de sesión',
        registroId: actualizado.id,
        usuario: actualizado.nombreUsuario,
      })
      .subscribe({ error: () => undefined });
    this.establecerSesion(actualizado);
    await this.licencia.cargar();
    return actualizado;
  }

  private async cargarPerfilSupabase(authUserId: string): Promise<Usuario> {
    const { data, error } = await this.sb
      .schema('seguridad')
      .from('usuario')
      .select('*')
      .eq('auth_user_id', authUserId)
      .maybeSingle();
    if (error || !data) throw new Error('Tu cuenta no tiene un perfil de usuario en Saurix.');
    return filaACamel(data) as unknown as Usuario;
  }

  private validarAcceso(usuario: Usuario): void {
    const hoy = new Date().toISOString().slice(0, 10);
    if (!usuario.activo) throw new Error('Este usuario está inactivo. Contacta a un administrador.');
    if (hoy < usuario.fechaInicioVigencia || hoy > usuario.fechaFinVigencia) {
      throw new Error('La vigencia de este usuario no está activa.');
    }
  }

  private establecerSesion(usuario: Usuario): void {
    this.usuarioActual.set(usuario);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(usuario));
    } catch {
      /* localStorage no disponible; se ignora */
    }
  }

  private leerSesionGuardada(): Usuario | null {
    try {
      const crudo = localStorage.getItem(STORAGE_KEY);
      return crudo ? (JSON.parse(crudo) as Usuario) : null;
    } catch {
      return null;
    }
  }
}

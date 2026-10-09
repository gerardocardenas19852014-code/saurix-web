import { Injectable, inject, signal } from '@angular/core';
import { Observable, firstValueFrom, from } from 'rxjs';
import { DataClientService } from './data-client.service';
import { Usuario } from '../../features/seguridad/usuarios/usuario.model';
import { BitacoraService } from '../../shared/services/bitacora.service';
import { hashPassword } from '../../shared/utils/password.util';
import { fuenteDatosActual } from './fuente-datos';
import { SupabaseService } from './supabase.service';
import { filaACamel } from './supabase-data-client.service';

const STORAGE_KEY = 'saurix.sesion';
const MODULO_BITACORA = 'Seguridad / Usuarios';
const MAX_INTENTOS_FALLIDOS = 5;
const MINUTOS_BLOQUEO = 15;

/**
 * Sesión de la app — modo demo, sin backend real, pero ya con reglas
 * reales de acceso:
 *  - la contraseña SÍ se valida (hash SHA-256 vía password.util, contra lo
 *    guardado en el registro del usuario);
 *  - un usuario marcado "Activo: No" no puede iniciar sesión;
 *  - un usuario fuera de su rango de vigencia tampoco puede iniciar sesión.
 * Si el nombre de usuario no existe en el catálogo de Usuarios, el login
 * falla — YA NO se crea ninguna cuenta automáticamente al iniciar sesión.
 * El único usuario que se crea solo es 'root' (ver SeedService, al arrancar
 * la app); cualquier otro usuario se da de alta desde el módulo de
 * Usuarios, nunca desde la pantalla de login.
 *
 * La sesión se guarda en localStorage (clave `saurix.sesion`) para que
 * sobreviva a un refresh, pero es solo un espejo del registro real en
 * IndexedDB (Usuario) — nunca la fuente de verdad de los datos del usuario.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly data = inject(DataClientService);
  // BitacoraService NO depende de AuthService (a propósito, ver bitacora.service.ts),
  // así que esta inyección es de un solo sentido y no forma un ciclo.
  private readonly bitacora = inject(BitacoraService);

  readonly usuarioActual = signal<Usuario | null>(this.leerSesionGuardada());

  /** Cliente de Supabase solo cuando la fuente de datos es Supabase (ver
   *  fuenteDatosActual()); con IndexedDB queda en null y se usa el
   *  flujo local de siempre. */
  private readonly sb = fuenteDatosActual() === 'supabase' ? inject(SupabaseService).cliente : null;

  constructor() {
    // Si Supabase cierra la sesión por su cuenta (token vencido, cierre en
    // otra pestaña), la app también la cierra.
    this.sb?.auth.onAuthStateChange((evento) => {
      if (evento === 'SIGNED_OUT') this.limpiarSesionLocal();
    });
  }

  iniciarSesion(nombreUsuario: string, password: string): Observable<Usuario> {
    return from(
      this.sb
        ? this.iniciarSesionSupabase(nombreUsuario, password)
        : this.intentarIniciarSesion(nombreUsuario, password),
    );
  }

  /**
   * Al arrancar la app (modo Supabase): confirma que la sesión de Auth
   * guardada sigue viva y recarga el perfil (rol, activo, vigencia pueden
   * haber cambiado). Si no hay sesión válida, deja la app sin usuario.
   */
  async restaurarSesion(): Promise<void> {
    if (!this.sb) return;
    const { data } = await this.sb.auth.getSession();
    if (!data.session) {
      this.limpiarSesionLocal();
      return;
    }
    try {
      const perfil = await this.cargarPerfilSupabase(data.session.user.id);
      this.validarAcceso(perfil);
      this.establecerSesion(perfil);
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
    if (this.sb) void this.sb.auth.signOut();
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
    const sb = this.sb!;
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
    return actualizado;
  }

  private async cargarPerfilSupabase(authUserId: string): Promise<Usuario> {
    const { data, error } = await this.sb!
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

  private async intentarIniciarSesion(nombreUsuario: string, password: string): Promise<Usuario> {
    const nombre = nombreUsuario.trim();
    const ahora = new Date().toISOString();
    const hoy = ahora.slice(0, 10);
    const hashIngresado = await hashPassword(password);

    const usuarios = await firstValueFrom(this.data.list<Usuario>('Usuario'));
    const existente = usuarios.find((u) => u.nombreUsuario.toLowerCase() === nombre.toLowerCase());

    if (existente) {
      // Bloqueo por intentos fallidos: se revisa ANTES que la contraseña, para
      // no seguir contando intentos (ni dar pistas de si la contraseña
      // probada era correcta) mientras el bloqueo siga activo.
      if (existente.bloqueadoHasta && existente.bloqueadoHasta > ahora) {
        const minutosRestantes = Math.max(
          1,
          Math.ceil((new Date(existente.bloqueadoHasta).getTime() - new Date(ahora).getTime()) / 60_000),
        );
        throw new Error(
          `Cuenta bloqueada temporalmente por demasiados intentos fallidos. Intenta de nuevo en ${minutosRestantes} minuto${minutosRestantes === 1 ? '' : 's'}.`,
        );
      }

      // Si el registro no tiene password guardado (cuentas viejas de antes de
      // este control), se deja pasar en vez de bloquear a alguien que nunca
      // tuvo oportunidad de fijar una contraseña real.
      if (existente.password && existente.password !== hashIngresado) {
        const intentos = (existente.intentosFallidos ?? 0) + 1;
        const seBloquea = intentos >= MAX_INTENTOS_FALLIDOS;
        const actualizado = await firstValueFrom(
          this.data.modificacion<Usuario>('Usuario', {
            ...existente,
            intentosFallidos: seBloquea ? 0 : intentos,
            bloqueadoHasta: seBloquea
              ? new Date(Date.now() + MINUTOS_BLOQUEO * 60_000).toISOString()
              : (existente.bloqueadoHasta ?? null),
          }),
        );
        if (seBloquea) {
          // Best-effort: si la bitácora falla no debe tumbar el flujo de login
          // (que de todos modos ya va a lanzar el error de bloqueo abajo), pero
          // sí hay que atrapar el error para que no salga como "Uncaught (in
          // promise)" en consola.
          this.bitacora
            .registrar({
              modulo: MODULO_BITACORA,
              entidad: 'Usuario',
              accion: 'Bloqueo por intentos fallidos',
              registroId: actualizado.id,
              usuario: actualizado.nombreUsuario,
            })
            .subscribe({ error: () => undefined });
          throw new Error(
            `Cuenta bloqueada por ${MINUTOS_BLOQUEO} minutos después de ${MAX_INTENTOS_FALLIDOS} intentos fallidos.`,
          );
        }
        throw new Error('Usuario o contraseña incorrectos.');
      }
      if (!existente.activo) {
        throw new Error('Este usuario está inactivo. Contacta a un administrador.');
      }
      if (hoy < existente.fechaInicioVigencia || hoy > existente.fechaFinVigencia) {
        throw new Error('La vigencia de este usuario no está activa.');
      }

      const actualizado = await firstValueFrom(
        this.data.modificacion<Usuario>('Usuario', {
          ...existente,
          ultimoAcceso: ahora,
          intentosFallidos: 0,
          bloqueadoHasta: null,
        }),
      );
      // Best-effort: un fallo al registrar la bitácora no debe impedir el
      // login (la sesión ya quedó actualizada arriba), solo se atrapa para
      // que no aparezca como error no controlado en consola.
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
      return actualizado;
    }

    // Ya no se crean cuentas automáticamente: si el usuario no existe, el
    // login falla igual que si la contraseña fuera incorrecta (no se
    // distingue el mensaje, para no revelar qué nombres de usuario existen).
    throw new Error('Usuario o contraseña incorrectos.');
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

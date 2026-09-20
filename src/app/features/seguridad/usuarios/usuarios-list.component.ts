import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { DataClientService } from '../../../core/services/data-client.service';
import { AuthService } from '../../../core/services/auth.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { BitacoraComponent } from '../../../shared/components/bitacora/bitacora.component';
import { BitacoraService } from '../../../shared/services/bitacora.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { ToastService } from '../../../shared/services/toast.service';
import { exportarCsv } from '../../../shared/utils/csv.util';
import { evaluarFortaleza, generarPasswordTemporal, hashPassword } from '../../../shared/utils/password.util';
import { debeDesactivarsePorVigenciaVencida, hoyIso } from '../../../shared/utils/vigencia.util';
import { Usuario, nombreCompletoUsuario } from './usuario.model';

type FiltroEstado = 'todos' | 'activos' | 'inactivos';

/** Si escribieron contraseña, debe coincidir con la confirmación. En blanco (edición sin cambio) no valida nada. */
function passwordsCoincidenValidator(grupo: AbstractControl): ValidationErrors | null {
  const password = grupo.get('password')?.value ?? '';
  const confirmacion = grupo.get('confirmacionPassword')?.value ?? '';
  if (!password) return null;
  return password === confirmacion ? null : { passwordsNoCoinciden: true };
}

/** La fecha final de vigencia no puede ser anterior a la inicial (comparación lexicográfica: sirve para 'YYYY-MM-DD'). */
function vigenciaValidaValidator(grupo: AbstractControl): ValidationErrors | null {
  const inicio = grupo.get('fechaInicioVigencia')?.value;
  const fin = grupo.get('fechaFinVigencia')?.value;
  if (!inicio || !fin) return null;
  return inicio <= fin ? null : { vigenciaInvalida: true };
}

/** Mínimo 8 caracteres, con al menos una mayúscula y un número. En blanco no valida
 *  nada (en edición, dejarla en blanco significa "no cambiarla"). */
function passwordSeguraValidator(control: AbstractControl): ValidationErrors | null {
  const valor: string = control.value ?? '';
  if (!valor) return null;
  const cumple = valor.length >= 8 && /[A-Z]/.test(valor) && /[0-9]/.test(valor);
  return cumple ? null : { passwordDebil: true };
}

/** Texto + clase de badge del estado de vigencia para la columna de la tabla
 *  (además del check de Activo). Una sola función para que el texto mostrado
 *  y el color de la píldora nunca queden desincronizados. */
function estadoVigenciaInfo(usuario: Usuario): { texto: string; clase: string } {
  if (!usuario.activo) return { texto: '—', clase: 'grid-badge-muted' };
  const hoy = hoyIso();
  if (usuario.fechaFinVigencia < hoy) return { texto: 'Vencida', clase: 'grid-badge-danger' };
  const diasRestantes = Math.round(
    (new Date(usuario.fechaFinVigencia).getTime() - new Date(hoy).getTime()) / 86_400_000,
  );
  if (diasRestantes <= 15) {
    return { texto: `Vence en ${diasRestantes} día${diasRestantes === 1 ? '' : 's'}`, clase: 'grid-badge-warning' };
  }
  return { texto: 'Vigente', clase: 'grid-badge-success' };
}

@Component({
  selector: 'app-usuarios-list',
  standalone: true,
  imports: [FormsModule, ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, BitacoraComponent],
  templateUrl: './usuarios-list.component.html',
  styleUrl: './usuarios-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UsuariosListComponent implements OnInit, OnDestroy {
  private readonly data = inject(DataClientService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly bitacora = inject(BitacoraService);
  private readonly auth = inject(AuthService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);

  protected readonly usuariosTodos = signal<Usuario[]>([]);
  protected readonly cargando = signal(false);
  protected readonly busqueda = signal('');
  protected readonly filtroEstado = signal<FiltroEstado>('todos');

  /** Búsqueda por usuario/nombre/apellidos/correo + filtro de estado, todo en cliente
   *  (la lista completa ya se trae una sola vez en `cargar()`). */
  protected readonly usuarios = computed(() => {
    const texto = this.busqueda().trim().toLowerCase();
    const estado = this.filtroEstado();

    return this.usuariosTodos().filter((usuario) => {
      if (estado === 'activos' && !usuario.activo) return false;
      if (estado === 'inactivos' && usuario.activo) return false;
      if (!texto) return true;
      const campos = [
        usuario.nombreUsuario,
        usuario.nombre,
        usuario.apellidoPaterno ?? '',
        usuario.apellidoMaterno ?? '',
        usuario.email,
      ];
      return campos.some((campo) => campo.toLowerCase().includes(texto));
    });
  });

  protected readonly modalAbierto = signal(false);
  protected readonly usuarioEnEdicion = signal<Usuario | null>(null);
  protected readonly usuarioAEliminar = signal<Usuario | null>(null);
  protected readonly usuarioAResetearPassword = signal<Usuario | null>(null);
  protected readonly mostrarPassword = signal(false);

  protected readonly columnas: ColumnaTabla<Usuario>[] = [
    { campo: 'nombreUsuario', etiqueta: 'Usuario' },
    { campo: 'nombre', etiqueta: 'Nombre completo', formatear: (fila) => nombreCompletoUsuario(fila) },
    { campo: 'email', etiqueta: 'Email' },
    { campo: 'role', etiqueta: 'Rol', claseValor: () => 'grid-badge-neutral' },
    {
      campo: 'activo',
      etiqueta: 'Activo',
      formatear: (fila) => (fila.activo ? 'Sí' : 'No'),
      claseValor: (fila) => (fila.activo ? 'grid-badge-success' : 'grid-badge-muted'),
    },
    {
      campo: 'fechaFinVigencia',
      etiqueta: 'Vigencia',
      formatear: (fila) => estadoVigenciaInfo(fila).texto,
      claseValor: (fila) => estadoVigenciaInfo(fila).clase,
    },
    {
      campo: 'ultimoAcceso',
      etiqueta: 'Último acceso',
      formatear: (fila) => (fila.ultimoAcceso ? new Date(fila.ultimoAcceso).toLocaleString('es-MX') : 'Nunca'),
    },
  ];

  protected readonly form = this.fb.nonNullable.group(
    {
      id: [0],
      nombreUsuario: ['', [Validators.required, Validators.minLength(4)]],
      nombre: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(30)]],
      apellidoPaterno: ['', [Validators.minLength(3), Validators.maxLength(30)]],
      apellidoMaterno: ['', [Validators.minLength(3), Validators.maxLength(30)]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, passwordSeguraValidator]],
      confirmacionPassword: ['', Validators.required],
      role: ['Usuario', Validators.required],
      fechaInicioVigencia: ['', Validators.required],
      fechaFinVigencia: ['', Validators.required],
      activo: [true],
    },
    { validators: [passwordsCoincidenValidator, vigenciaValidaValidator] },
  );

  /** Fortaleza en vivo de lo que se va escribiendo en el campo de contraseña, para
   *  el indicador visual (no es una validación, solo retroalimentación). */
  private readonly passwordEnVivo = toSignal(this.form.controls.password.valueChanges, { initialValue: '' });
  protected readonly fortalezaPassword = computed(() => evaluarFortaleza(this.passwordEnVivo() ?? ''));

  ngOnInit(): void {
    // Esta pantalla tiene muchas columnas (grid de usuarios); usa el ancho
    // "wide" del layout para aprovechar el espacio en vez de quedarse en el
    // ancho angosto por defecto (ver html[data-wide='grid'] en styles.scss).
    document.documentElement.setAttribute('data-wide', 'grid');
    this.cargar();
  }

  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  cargar(): void {
    this.cargando.set(true);
    this.data.list<Usuario>('Usuario').subscribe({
      next: (usuarios) => {
        this.usuariosTodos.set(usuarios);
        this.cargando.set(false);
        this.sincronizarVigenciasVencidas(usuarios);
      },
      error: () => this.cargando.set(false),
    });
  }

  /** Un usuario "Activo" cuya vigencia ya venció se desactiva solo, para que
   *  la columna Activo no se quede mintiendo (el login ya lo bloqueaba de
   *  todos modos por vigencia — esto es solo para que el dato sea honesto). */
  private sincronizarVigenciasVencidas(usuarios: Usuario[]): void {
    const hoy = hoyIso();
    const vencidos = usuarios.filter((u) => debeDesactivarsePorVigenciaVencida(u, hoy));
    for (const usuario of vencidos) {
      this.data.modificacion<Usuario>('Usuario', { ...usuario, activo: false }).subscribe({
        next: (actualizado) => {
          this.usuariosTodos.update((lista) => lista.map((u) => (u.id === actualizado.id ? actualizado : u)));
          this.bitacora
            .registrar({
              modulo: 'Seguridad / Usuarios',
              entidad: 'Usuario',
              accion: 'Desactivación automática (vigencia vencida)',
              usuario: 'Sistema',
              registroId: actualizado.id,
              anterior: { activo: true },
              actual: { activo: false },
            })
            .subscribe();
        },
        // Sincronización silenciosa best-effort: si falla, se reintenta en la
        // próxima carga de la pantalla; el login ya bloquea por vigencia de todos modos.
        error: () => undefined,
      });
    }
  }

  alternarMostrarPassword(): void {
    this.mostrarPassword.update((v) => !v);
  }

  nuevoUsuario(): void {
    this.usuarioEnEdicion.set(null);
    this.form.controls.password.setValidators([Validators.required, passwordSeguraValidator]);
    this.form.controls.confirmacionPassword.setValidators([Validators.required]);
    this.form.controls.password.updateValueAndValidity();
    this.form.controls.confirmacionPassword.updateValueAndValidity();

    this.form.reset({
      id: 0,
      nombreUsuario: '',
      nombre: '',
      apellidoPaterno: '',
      apellidoMaterno: '',
      email: '',
      password: '',
      confirmacionPassword: '',
      role: 'Usuario',
      fechaInicioVigencia: hoyIso(),
      fechaFinVigencia: '',
      activo: true,
    });
    this.mostrarPassword.set(false);
    this.modalAbierto.set(true);
  }

  editarUsuario(usuario: Usuario): void {
    this.usuarioEnEdicion.set(usuario);
    // En edición la contraseña es opcional (se conserva si se deja en blanco);
    // el campo NUNCA se precarga con el valor guardado, porque ahora es un
    // hash, no la contraseña real — mostrarlo no serviría de nada.
    this.form.controls.password.setValidators([passwordSeguraValidator]);
    this.form.controls.confirmacionPassword.setValidators([]);
    this.form.controls.password.updateValueAndValidity();
    this.form.controls.confirmacionPassword.updateValueAndValidity();

    this.form.reset({
      id: usuario.id,
      nombreUsuario: usuario.nombreUsuario,
      nombre: usuario.nombre,
      apellidoPaterno: usuario.apellidoPaterno ?? '',
      apellidoMaterno: usuario.apellidoMaterno ?? '',
      email: usuario.email,
      password: '',
      confirmacionPassword: '',
      role: usuario.role,
      fechaInicioVigencia: usuario.fechaInicioVigencia,
      fechaFinVigencia: usuario.fechaFinVigencia,
      activo: usuario.activo,
    });
    this.mostrarPassword.set(false);
    this.modalAbierto.set(true);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.mostrarErroresValidacion();
      return;
    }

    const { confirmacionPassword: _confirmacion, ...valor } = this.form.getRawValue();
    const usuarioPrevio = this.usuarioEnEdicion();
    const esEdicion = usuarioPrevio !== null;
    const nombreUsuarioNuevo = valor.nombreUsuario.trim().toLowerCase();
    const usuarioActual = this.auth.usuarioActual()?.nombreUsuario ?? 'Sistema';

    // El nombre de usuario debe ser único: se revisa contra el catálogo completo
    // (no la lista filtrada por búsqueda) antes de dar de alta o modificar.
    this.data.list<Usuario>('Usuario').subscribe({
      error: () => this.toast.error('No se pudo verificar el nombre de usuario. Intenta de nuevo.'),
      next: async (usuarios) => {
        const yaExiste = usuarios.some(
          (u) => u.nombreUsuario.toLowerCase() === nombreUsuarioNuevo && u.id !== valor.id,
        );
        if (yaExiste) {
          this.toast.error('Ya existe un usuario con ese nombre.');
          return;
        }

        // Si escribieron una contraseña nueva se guarda su hash; si la dejaron en
        // blanco en edición, se conserva la que ya tenía (que ya es un hash).
        const dto = valor.password
          ? { ...valor, password: await hashPassword(valor.password) }
          : esEdicion && usuarioPrevio
            ? { ...valor, password: usuarioPrevio.password }
            : valor;

        const peticion = esEdicion
          ? this.data.modificacion<Usuario>('Usuario', dto)
          : this.data.alta<Usuario>('Usuario', dto);

        peticion.subscribe({
          next: (resultado) => {
            this.bitacora
              .registrar({
                modulo: 'Seguridad / Usuarios',
                entidad: 'Usuario',
                accion: esEdicion ? 'Modificación' : 'Alta',
                usuario: usuarioActual,
                registroId: resultado.id,
                anterior: usuarioPrevio as unknown as Record<string, unknown> | null,
                actual: resultado as unknown as Record<string, unknown>,
              })
              .subscribe();
            this.toast.exito(esEdicion ? 'Usuario actualizado.' : 'Usuario creado.');
            this.modalAbierto.set(false);
            this.cargar();
          },
          error: () => this.toast.error('No se pudo guardar el usuario. Intenta de nuevo.'),
        });
      },
    });
  }

  /**
   * En vez de bloques de error fijos debajo de cada campo (que hacían crecer
   * mucho el formulario y empujaban el botón Guardar fuera de la vista), los
   * problemas de validación se avisan como tarjetas de notificación — el
   * campo en cuestión solo se marca con borde rojo (ver `.ng-invalid` en
   * styles.scss), sin ocupar espacio extra.
   */
  private mostrarErroresValidacion(): void {
    const c = this.form.controls;
    if (c.nombreUsuario.invalid) this.toast.error('El usuario debe tener al menos 4 caracteres.');
    if (c.nombre.invalid) this.toast.error('El nombre debe tener entre 3 y 30 caracteres.');
    if (c.apellidoPaterno.invalid) this.toast.error('El apellido paterno debe tener entre 3 y 30 caracteres.');
    if (c.apellidoMaterno.invalid) this.toast.error('El apellido materno debe tener entre 3 y 30 caracteres.');
    if (c.email.invalid) this.toast.error('Captura un correo con formato válido.');
    if (c.password.errors?.['required']) this.toast.error('Captura una contraseña.');
    else if (c.password.errors?.['passwordDebil']) {
      this.toast.error('La contraseña debe tener al menos 8 caracteres, con una mayúscula y un número.');
    }
    if (c.fechaInicioVigencia.invalid) this.toast.error('Captura la fecha inicial de vigencia.');
    if (c.fechaFinVigencia.invalid) this.toast.error('Captura la fecha final de vigencia.');
    if (this.form.errors?.['passwordsNoCoinciden']) this.toast.error('Las contraseñas no coinciden.');
    if (this.form.errors?.['vigenciaInvalida']) {
      this.toast.error('La fecha final de vigencia no puede ser anterior a la inicial.');
    }
  }

  exportarUsuariosCsv(): void {
    const filas = this.usuarios().map((u) => ({
      ...u,
      nombreCompletoTexto: nombreCompletoUsuario(u),
      ultimoAccesoTexto: u.ultimoAcceso ? new Date(u.ultimoAcceso).toLocaleString('es-MX') : 'Nunca',
    }));

    exportarCsv(
      'usuarios.csv',
      [
        { clave: 'nombreUsuario', etiqueta: 'Usuario' },
        { clave: 'nombreCompletoTexto', etiqueta: 'Nombre completo' },
        { clave: 'email', etiqueta: 'Correo' },
        { clave: 'role', etiqueta: 'Rol' },
        { clave: 'fechaInicioVigencia', etiqueta: 'Vigencia desde' },
        { clave: 'fechaFinVigencia', etiqueta: 'Vigencia hasta' },
        { clave: 'ultimoAccesoTexto', etiqueta: 'Último acceso' },
      ],
      filas,
    );

    this.toast.exito(`Se descargó usuarios.csv (${filas.length} registro${filas.length === 1 ? '' : 's'}).`);
  }

  pedirEliminar(usuario: Usuario): void {
    if (usuario.nombreUsuario.toLowerCase() === 'root') {
      this.toast.advertencia('El usuario root no se puede eliminar.');
      return;
    }
    this.usuarioAEliminar.set(usuario);
  }

  pedirResetearPassword(usuario: Usuario): void {
    this.usuarioAResetearPassword.set(usuario);
  }

  /**
   * Genera una contraseña temporal (que ya cumple la política mínima), la
   * guarda hasheada y marca `debeCambiarPassword` para que la próxima vez
   * que ese usuario entre, "Mi Perfil" lo obligue a cambiarla antes de dejarlo
   * usar el resto de la app. También limpia cualquier bloqueo por intentos
   * fallidos que tuviera activo.
   */
  confirmarResetearPassword(): void {
    const usuario = this.usuarioAResetearPassword();
    if (!usuario) return;

    const temporal = generarPasswordTemporal();
    hashPassword(temporal).then((hash) => {
      this.data
        .modificacion<Usuario>('Usuario', {
          ...usuario,
          password: hash,
          debeCambiarPassword: true,
          intentosFallidos: 0,
          bloqueadoHasta: null,
        })
        .subscribe({
          next: (actualizado) => {
            this.bitacora
              .registrar({
                modulo: 'Seguridad / Usuarios',
                entidad: 'Usuario',
                accion: 'Reseteo de contraseña (admin)',
                usuario: this.auth.usuarioActual()?.nombreUsuario ?? 'Sistema',
                registroId: actualizado.id,
              })
              .subscribe();
            try {
              void navigator.clipboard?.writeText(temporal);
            } catch {
              /* portapapeles no disponible; no es crítico */
            }
            this.usuarioAResetearPassword.set(null);
            this.cargar();
            this.toast.exito(
              `Contraseña temporal para ${usuario.nombreUsuario}: ${temporal} (copiada al portapapeles). Deberá cambiarla en su próximo inicio de sesión.`,
            );
          },
          error: () => this.toast.error('No se pudo resetear la contraseña. Intenta de nuevo.'),
        });
    });
  }

  confirmarEliminar(): void {
    const usuario = this.usuarioAEliminar();
    if (!usuario) return;
    if (usuario.nombreUsuario.toLowerCase() === 'root') {
      this.usuarioAEliminar.set(null);
      this.toast.advertencia('El usuario root no se puede eliminar.');
      return;
    }

    this.data.baja('Usuario', usuario.id).subscribe({
      next: () => {
        this.bitacora
          .registrar({
            modulo: 'Seguridad / Usuarios',
            entidad: 'Usuario',
            accion: 'Baja',
            usuario: this.auth.usuarioActual()?.nombreUsuario ?? 'Sistema',
            registroId: usuario.id,
            anterior: usuario as unknown as Record<string, unknown>,
            actual: null,
          })
          .subscribe();
        this.toast.exito('Usuario eliminado.');
        this.usuarioAEliminar.set(null);
        this.cargar();
      },
      error: () => this.toast.error('No se pudo eliminar el usuario. Intenta de nuevo.'),
    });
  }
}

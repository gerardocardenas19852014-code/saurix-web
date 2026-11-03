import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Subscription, debounceTime, distinctUntilChanged, firstValueFrom, skip } from 'rxjs';
import {
  AbstractControl,
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { DataClientService, FiltroBusqueda, FILTRO_BUSQUEDA, OrdenPagina } from '../../../core/services/data-client.service';
import { AuthService } from '../../../core/services/auth.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { BitacoraComponent } from '../../../shared/components/bitacora/bitacora.component';
import { BitacoraService } from '../../../shared/services/bitacora.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { ToastService } from '../../../shared/services/toast.service';
import { exportarCsv } from '../../../shared/utils/csv.util';
import { evaluarFortaleza, generarPasswordTemporal, hashPassword } from '../../../shared/utils/password.util';
import { hoyIso } from '../../../shared/utils/vigencia.util';
import { Usuario, nombreCompletoUsuario } from './usuario.model';
import { Rol } from '../roles-permisos/rol-permiso.model';

type FiltroEstado = 'todos' | 'activos' | 'inactivos';

/** Columnas por las que de verdad tiene sentido ordenar en este grid —
 *  coinciden 1:1 con columnas reales de seguridad.usuario (ver
 *  supabase-esquema.ts), así que listarUnaPagina() las acepta sin más
 *  (esa whitelist la da def.columnas, no esta lista — esto es solo lo que
 *  la UI ofrece). */
type ColumnaOrdenUsuario = 'nombreUsuario' | 'nombre' | 'email' | 'role' | 'activo' | 'fechaFinVigencia' | 'ultimoAcceso';

/** Columnas de texto sobre las que busca la caja de búsqueda — mismo
 *  conjunto que antes se filtraba en memoria, ahora server-side (ver
 *  FiltroBusqueda en data-client.service.ts). */
const COLUMNAS_BUSQUEDA: (keyof Usuario & string)[] = [
  'nombreUsuario',
  'nombre',
  'apellidoPaterno',
  'apellidoMaterno',
  'email',
];

/** Tamaño de lote al exportar CSV: nunca se descarga todo en una sola
 *  petición gigante — mismo criterio que TAMANO_LOTE_EXPORTAR en
 *  movimientos-bodega.component.ts / valor-stock.component.ts. A la escala
 *  real de Usuarios (cientos, quizá unos pocos miles por empresa) esto
 *  normalmente termina en 1-2 vueltas. */
const TAMANO_LOTE_EXPORTAR = 1000;

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
 *  y el color de la píldora nunca queden desincronizados. Se calcula 100%
 *  en cliente sobre la fila ya cargada (fechaFinVigencia + activo) — nunca
 *  hace falta una consulta extra para esto, ni siquiera con paginación
 *  server-side, porque ambos datos ya vienen en la misma fila. */
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
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly bitacora = inject(BitacoraService);
  private readonly auth = inject(AuthService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);

  /**
   * Homologación de rendimiento (auditoría nov-2026): esta pantalla dejó de
   * descargar la tabla completa (`list('Usuario')`) y filtrar/ordenar/
   * paginar en Angular — ahora `usuariosPagina` guarda SOLO la página que
   * el servidor ya devolvió filtrada, ordenada y recortada
   * (`listarPagina()`, infraestructura que ya existía y usan otras
   * pantallas homologadas). `totalFiltrado` es el total real que cumple el
   * filtro actual (antes de paginar), para "N resultados" y el total de
   * páginas — ver DataTableComponent en modo servidor.
   */
  protected readonly usuariosPagina = signal<Usuario[]>([]);
  protected readonly totalFiltrado = signal(0);
  protected readonly paginaActual = signal(1);
  protected readonly roles = signal<Rol[]>([]);
  protected readonly cargando = signal(false);
  protected readonly busqueda = signal('');
  protected readonly filtroEstado = signal<FiltroEstado>('todos');
  /** null = sin orden explícito todavía (mismo aspecto visual de antes: ↕
   *  en todos los encabezados, orden por id de siempre). */
  protected readonly columnaOrden = signal<ColumnaOrdenUsuario | null>(null);
  protected readonly direccionOrden = signal<'asc' | 'desc'>('asc');

  /** Contador de secuencia para descartar respuestas tardías de una
   *  búsqueda/página/orden que el usuario ya superó (mismo patrón que
   *  secuenciaExistencia/secuenciaHistorial en movimientos-bodega.component.ts)
   *  — nunca se deja que una respuesta vieja pise a una más nueva. */
  private secuencia = 0;
  private busquedaSub?: Subscription;

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

  /** Un checkbox marcado/desmarcado a veces es difícil de distinguir a simple vista
   *  (sobre todo desmarcado vs. marcado con colores parecidos) — se refuerza con
   *  texto explícito ("Activo"/"Inactivo") en vez de solo el checkbox. */
  private readonly activoEnVivo = toSignal(this.form.controls.activo.valueChanges, {
    initialValue: this.form.controls.activo.value,
  });
  protected readonly etiquetaActivo = computed(() => (this.activoEnVivo() ? 'Activo' : 'Inactivo'));

  /** El campo Rol pasó de texto libre a un <select> alimentado por el catálogo Rol.
   *  Homologación de roles (auditoría nov-2026): el catálogo de cada empresa ya se
   *  rellenó con sus valores reales (admin/Usuario) y "Roles y permisos" ahora
   *  permite dar de alta más — este fallback "sintético" YA NO existe para
   *  esconder un catálogo vacío, se conserva solo como red de seguridad para un
   *  valor legado/huérfano que de verdad no esté en el catálogo (mismo espíritu
   *  que tiposSeleccionables/prioridadesSeleccionables/modulosSeleccionables en
   *  el tablero Kanban): nunca se pierde/blanquea silenciosamente el rol actual
   *  de un usuario. */
  private readonly rolEnVivo = toSignal(this.form.controls.role.valueChanges, {
    initialValue: this.form.controls.role.value,
  });
  protected readonly rolesSeleccionables = computed(() => {
    const actual = this.rolEnVivo();
    const activos = this.roles().filter((r) => r.activo !== false);
    if (actual && !activos.some((r) => r.nombre === actual)) {
      return [...activos, { id: -1, nombre: actual, activo: true } satisfies Rol];
    }
    return activos;
  });

  protected readonly totalPaginas = computed(() =>
    Math.max(1, Math.ceil(this.totalFiltrado() / Math.max(1, this.preferenciasGrid.tamanoPagina()))),
  );

  ngOnInit(): void {
    // Esta pantalla tiene muchas columnas (grid de usuarios); usa el ancho
    // "wide" del layout para aprovechar el espacio en vez de quedarse en el
    // ancho angosto por defecto (ver html[data-wide='grid'] en styles.scss).
    document.documentElement.setAttribute('data-wide', 'grid');
    this.cargarRoles();
    this.cargar();
    this.sincronizarErrorConfirmacionPassword();
    this.sincronizarErrorDuplicado(this.form.controls.nombreUsuario, 'usuarioDuplicado');
    this.sincronizarErrorDuplicado(this.form.controls.email, 'usuarioDuplicado');

    // Búsqueda con debounce: el signal `busqueda` se actualiza en cada tecla
    // (para que el campo de texto responda al instante), pero la petición
    // real al servidor espera 300ms de silencio y descarta valores
    // intermedios (debounceTime + distinctUntilChanged) — nunca una
    // petición por tecla. skip(1) evita una recarga duplicada con el valor
    // inicial (la carga inicial ya la hace cargar() arriba).
    this.busquedaSub = toObservable(this.busqueda)
      .pipe(skip(1), debounceTime(300), distinctUntilChanged())
      .subscribe(() => this.reiniciarYCargar());
  }

  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
    this.busquedaSub?.unsubscribe();
  }

  /** Catálogo de Roles para el <select> del modal — se carga UNA sola vez al
   *  entrar a la pantalla (no por cada apertura del modal, ver
   *  nuevoUsuario()/editarUsuario()). */
  private cargarRoles(): void {
    this.data.list<Rol>('Rol').subscribe({
      next: (roles) => this.roles.set(roles),
      error: () => undefined,
    });
  }

  /** El error de "ya existe" (ver guardar()) es una respuesta del servidor que
   *  solo se sabe al intentar guardar — en cuanto se vuelve a escribir el campo,
   *  se limpia (ya no está verificado ni a favor ni en contra), para no dejar un
   *  borde rojo "pegado" con un valor que la persona ya cambió. */
  private sincronizarErrorDuplicado(control: AbstractControl, clave: string): void {
    control.valueChanges.subscribe(() => {
      if (!control.errors?.[clave]) return;
      const { [clave]: _quitado, ...resto } = control.errors;
      control.setErrors(Object.keys(resto).length ? resto : null);
    });
  }

  /**
   * "No me deja guardar" sin que quede claro por qué era un problema recurrente:
   * el error de contraseñas-no-coinciden vivía SOLO en el grupo (passwordsCoincidenValidator),
   * así que ningún campo se marcaba en rojo — el único aviso era un toast, fácil de
   * perder de vista sobre un modal. Aquí se refleja ese mismo error también en el
   * control confirmacionPassword, para que se pinte en rojo (.ng-invalid.ng-touched,
   * ver styles.scss) en cuanto se toca el campo, no solo al intentar guardar.
   */
  private sincronizarErrorConfirmacionPassword(): void {
    this.form.valueChanges.subscribe(() => {
      const control = this.form.controls.confirmacionPassword;
      const noCoincide = !!this.form.errors?.['passwordsNoCoinciden'];
      if (noCoincide && !control.errors?.['passwordsNoCoinciden']) {
        control.setErrors({ ...control.errors, passwordsNoCoinciden: true });
      } else if (!noCoincide && control.errors?.['passwordsNoCoinciden']) {
        const { passwordsNoCoinciden: _quitado, ...resto } = control.errors;
        control.setErrors(Object.keys(resto).length ? resto : null);
      }
    });
  }

  /** Filtro actual (búsqueda + estado) en el formato que entiende
   *  listarPagina() — compartido entre la carga normal (cargar()) y la
   *  exportación a CSV (exportarUsuariosCsv()), para que ambas respeten
   *  exactamente los mismos filtros. */
  private filtroActual(): Record<string, unknown> {
    const filtro: Record<string, unknown> = {};
    const texto = this.busqueda().trim();
    if (texto) {
      filtro[FILTRO_BUSQUEDA] = { columnas: COLUMNAS_BUSQUEDA, texto } satisfies FiltroBusqueda;
    }
    if (this.filtroEstado() !== 'todos') filtro['activo'] = this.filtroEstado() === 'activos';
    return filtro;
  }

  private ordenActual(): OrdenPagina | undefined {
    const columna = this.columnaOrden();
    return columna ? { columna, direccion: this.direccionOrden() } : undefined;
  }

  /** Carga SOLO la página actual, con los filtros/orden vigentes — nunca la
   *  tabla completa. Se usa tanto para la carga inicial como para cualquier
   *  cambio de búsqueda/filtro/orden/página. */
  private cargar(): void {
    this.cargando.set(true);
    const miSecuencia = ++this.secuencia;
    const tamanio = Math.max(1, this.preferenciasGrid.tamanoPagina());
    const desde = (this.paginaActual() - 1) * tamanio;

    this.data.listarPagina<Usuario>('Usuario', this.filtroActual(), desde, tamanio, this.ordenActual()).subscribe({
      next: ({ filas, total }) => {
        if (miSecuencia !== this.secuencia) return; // respuesta vieja, se descarta
        this.usuariosPagina.set(filas);
        this.totalFiltrado.set(total);
        this.cargando.set(false);
      },
      error: () => {
        if (miSecuencia !== this.secuencia) return;
        this.cargando.set(false);
      },
    });
  }

  /** Vuelve a página 1 y recarga — para cualquier cambio que invalide la
   *  página en la que el usuario estaba parado (nueva búsqueda, cambio de
   *  filtro de estado). */
  private reiniciarYCargar(): void {
    this.paginaActual.set(1);
    this.cargar();
  }

  protected cambiarFiltroEstado(valor: FiltroEstado): void {
    this.filtroEstado.set(valor);
    this.reiniciarYCargar();
  }

  protected onPaginaCambio(pagina: number): void {
    this.paginaActual.set(pagina);
    this.cargar();
  }

  protected onOrdenCambio(evento: { campo: keyof Usuario & string; direccion: 'asc' | 'desc' }): void {
    this.columnaOrden.set(evento.campo as ColumnaOrdenUsuario);
    this.direccionOrden.set(evento.direccion);
    this.reiniciarYCargar();
  }

  alternarMostrarPassword(): void {
    this.mostrarPassword.update((v) => !v);
  }

  /** Abrir "+ Nuevo" no hace ninguna petición: el catálogo de Roles ya está
   *  cargado (ver cargarRoles(), una sola vez al entrar a la pantalla). */
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

  /** Abrir "Editar" tampoco hace ninguna petición: se llena directamente con
   *  la fila ya cargada en la página actual — nunca se vuelve a pedir por id. */
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

  /**
   * Guarda alta/edición en UNA sola intención (ver
   * SupabaseDataClientService.actualizarUsuario(): perfil + cuenta de acceso
   * coordinados server-side por la Edge Function admin-usuarios). Ya NO
   * vuelve a traer la tabla completa para revisar duplicados antes de
   * guardar — la base (índices únicos) y, ahora también, la Edge Function
   * (tanto en alta como en edición) ya validan esto del lado del servidor;
   * si el servidor reporta un duplicado, el campo correspondiente se marca
   * en rojo igual que antes (ver sincronizarErrorDuplicado()).
   */
  async guardar(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.mostrarErroresValidacion();
      return;
    }

    const { confirmacionPassword: _confirmacion, ...valor } = this.form.getRawValue();
    const usuarioPrevio = this.usuarioEnEdicion();
    const esEdicion = usuarioPrevio !== null;
    const usuarioActual = this.auth.usuarioActual()?.nombreUsuario ?? 'Sistema';

    // Si escribieron una contraseña nueva se guarda su hash; si la dejaron en
    // blanco en edición, se conserva la que ya tenía (relevante en modo
    // IndexedDB, donde el registro sí guarda `password`; en modo Supabase la
    // tabla no tiene esa columna, así que este valor simplemente se ignora
    // del lado del servidor — ver dtoASnake()).
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
      // El propio DataClientService (conToast) ya muestra un toast con el
      // mensaje real del error (incluido el de la Edge Function — límite de
      // usuarios de la empresa, nombre/correo duplicado, etc.); aquí solo se
      // marca en rojo el campo correspondiente cuando el mensaje lo permite
      // distinguir, sin repetir el toast.
      error: (error: unknown) => this.marcarErrorDuplicadoSiAplica(error),
    });
  }

  private marcarErrorDuplicadoSiAplica(error: unknown): void {
    const mensaje = error instanceof Error ? error.message : '';
    if (!mensaje.startsWith('Ya existe un usuario con ese')) return;
    const control = mensaje.includes('nombre de usuario')
      ? this.form.controls.nombreUsuario
      : mensaje.includes('correo')
        ? this.form.controls.email
        : null;
    if (!control) return;
    control.setErrors({ ...control.errors, usuarioDuplicado: true });
    control.markAsTouched();
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

  /** Exporta TODOS los usuarios que cumplen la búsqueda/filtro actuales (no
   *  solo la página visible), pidiéndolos en lotes de TAMANO_LOTE_EXPORTAR —
   *  nunca en una sola petición gigante ni descargando de más: mismo patrón
   *  ya usado por exportarCsvHistorial() en movimientos-bodega.component.ts. */
  async exportarUsuariosCsv(): Promise<void> {
    const filtro = this.filtroActual();
    const orden = this.ordenActual();
    const todas: Usuario[] = [];
    let desde = 0;
    let total = Infinity;
    while (desde < total) {
      const { filas, total: totalReal } = await firstValueFrom(
        this.data.listarPagina<Usuario>('Usuario', filtro, desde, TAMANO_LOTE_EXPORTAR, orden),
      );
      if (filas.length === 0) break;
      todas.push(...filas);
      total = totalReal;
      desde += TAMANO_LOTE_EXPORTAR;
    }

    const filas = todas.map((u) => ({
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
   *
   * No recarga nada después: ninguna columna visible del grid cambia con un
   * reseteo de contraseña (ver auditoría de rendimiento, nov-2026) — el toast
   * ya confirma el resultado.
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
        // Si era la última fila de una página que no es la primera, se
        // retrocede una página antes de recargar — nunca se deja la grid
        // mostrando una página vacía (ver pruebas obligatorias).
        if (this.usuariosPagina().length === 1 && this.paginaActual() > 1) {
          this.paginaActual.update((p) => p - 1);
        }
        this.cargar();
      },
      error: () => this.toast.error('No se pudo eliminar el usuario. Intenta de nuevo.'),
    });
  }
}

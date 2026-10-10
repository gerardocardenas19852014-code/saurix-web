import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DataClientService } from '../../../core/services/data-client.service';
import { AuthService } from '../../../core/services/auth.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { fuenteDatosActual } from '../../../core/services/fuente-datos';
import { ToastService } from '../../../shared/services/toast.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { hashPassword } from '../../../shared/utils/password.util';

export interface Empresa {
  id: number;
  clave: string;
  nombre: string;
  activo: boolean;
  fechaCreacion?: string;
}

/**
 * Seguridad → Empresas (solo superadministrador, solo en la Nube).
 * Cada empresa es un cliente: sus datos están separados de los demás por
 * empresa_id + RLS (ver supabase/migrations/09 y 11).
 *  - Alta / edición / activar-desactivar empresas. Al crear una, la base le
 *    siembra sus Listas de valores iniciales.
 *  - "Primer admin": crea el usuario administrador de esa empresa (Edge
 *    Function admin-usuarios).
 *  - "Entrar": el superadmin pasa a trabajar DENTRO de esa empresa (modo
 *    soporte) hasta que regrese a la suya desde la etiqueta de arriba.
 */
@Component({
  selector: 'app-empresas',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent],
  templateUrl: './empresas.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmpresasComponent implements OnInit, OnDestroy {
  private readonly data = inject(DataClientService);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  protected readonly toast = inject(ToastService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);
  private readonly sb = fuenteDatosActual() === 'supabase' ? inject(SupabaseService).cliente : null;

  protected readonly permitido = !!this.sb && this.auth.usuarioActual()?.esSuperadmin === true;

  protected readonly empresas = signal<Empresa[]>([]);
  protected readonly cargando = signal(false);
  protected readonly empresaEnEdicion = signal<Empresa | null>(null);
  protected readonly modalEmpresa = signal(false);
  protected readonly aEliminar = signal<Empresa | null>(null);
  protected readonly empresaParaAdmin = signal<Empresa | null>(null);
  protected readonly empresaParaEntrar = signal<Empresa | null>(null);
  protected readonly guardando = signal(false);

  protected readonly columnas: ColumnaTabla<Empresa>[] = [
    { campo: 'clave', etiqueta: 'Clave' },
    { campo: 'nombre', etiqueta: 'Nombre' },
    {
      campo: 'activo',
      etiqueta: 'Activa',
      formatear: (f) => (f.activo ? 'Sí' : 'No'),
      claseValor: (f) => (f.activo ? 'grid-badge-success' : 'grid-badge-muted'),
    },
    {
      campo: 'fechaCreacion',
      etiqueta: 'Alta',
      formatear: (f) => (f.fechaCreacion ? f.fechaCreacion.slice(0, 10) : ''),
    },
  ];

  protected readonly formEmpresa = this.fb.nonNullable.group({
    clave: ['', [Validators.required, Validators.pattern(/^[a-z0-9-]{2,30}$/)]],
    nombre: ['', [Validators.required, Validators.maxLength(80)]],
    activo: [true],
  });

  protected readonly formAdmin = this.fb.nonNullable.group({
    nombreUsuario: ['', [Validators.required, Validators.minLength(4)]],
    nombre: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(30)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  ngOnInit(): void {
    // Usa todo el ancho disponible (ver html[data-wide='grid'] en styles.scss),
    // igual que Usuarios, en vez del ancho angosto por defecto.
    document.documentElement.setAttribute('data-wide', 'grid');
    if (this.permitido) this.cargar();
  }

  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  cargar(): void {
    this.cargando.set(true);
    this.data.list<Empresa>('Empresa').subscribe({
      next: (filas) => {
        this.empresas.set(filas);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  // ── Alta / edición ────────────────────────────────────────────────
  nueva(): void {
    this.empresaEnEdicion.set(null);
    this.formEmpresa.reset({ clave: '', nombre: '', activo: true });
    this.formEmpresa.controls.clave.enable();
    this.modalEmpresa.set(true);
  }

  editar(empresa: Empresa): void {
    this.empresaEnEdicion.set(empresa);
    this.formEmpresa.reset({ clave: empresa.clave, nombre: empresa.nombre, activo: empresa.activo });
    // La clave identifica a la empresa (p.ej. en ?conexion= o subdominios): no se cambia.
    this.formEmpresa.controls.clave.disable();
    this.modalEmpresa.set(true);
  }

  guardarEmpresa(): void {
    if (this.formEmpresa.invalid) {
      this.formEmpresa.markAllAsTouched();
      this.toast.error('Clave: 2 a 30 letras minúsculas, números o guiones. Nombre: obligatorio.');
      return;
    }
    const valor = this.formEmpresa.getRawValue();
    const edicion = this.empresaEnEdicion();
    const peticion = edicion
      ? this.data.modificacion<Empresa>('Empresa', { id: edicion.id, nombre: valor.nombre.trim(), activo: valor.activo })
      : this.data.alta<Empresa>('Empresa', { clave: valor.clave.trim(), nombre: valor.nombre.trim(), activo: valor.activo });
    peticion.subscribe({
      next: (empresa) => {
        this.modalEmpresa.set(false);
        this.toast.exito(edicion ? 'Empresa actualizada.' : `Empresa "${empresa.nombre}" creada. Ahora crea su primer admin.`);
        this.cargar();
      },
    });
  }

  pedirEliminar(empresa: Empresa): void {
    this.aEliminar.set(empresa);
  }

  /** Borra la empresa con lo que se le crea solo (listas sembradas,
   *  apariencia). Si ya tiene usuarios o datos, la base lo impide y avisa
   *  (función seguridad.eliminar_empresa). */
  async confirmarEliminar(): Promise<void> {
    const empresa = this.aEliminar();
    if (!empresa || !this.sb) return;
    this.aEliminar.set(null);
    const { error } = await this.sb.schema('seguridad').rpc('eliminar_empresa', { p_empresa: empresa.id });
    if (error) {
      this.toast.error(error.message);
      return;
    }
    this.toast.exito(`Empresa "${empresa.nombre}" eliminada.`);
    this.cargar();
  }

  // ── Primer admin ──────────────────────────────────────────────────
  pedirAdmin(empresa: Empresa): void {
    this.formAdmin.reset({ nombreUsuario: '', nombre: '', email: '', password: '' });
    this.empresaParaAdmin.set(empresa);
  }

  async crearAdmin(): Promise<void> {
    const empresa = this.empresaParaAdmin();
    if (!empresa || !this.sb) return;
    if (this.formAdmin.invalid) {
      this.formAdmin.markAllAsTouched();
      this.toast.error('Usuario (mín. 4), nombre (3 a 30), correo válido y contraseña de al menos 8 caracteres.');
      return;
    }
    const v = this.formAdmin.getRawValue();
    this.guardando.set(true);
    try {
      // Misma regla que Usuarios y el login: en Auth se guarda el hash SHA-256.
      const password = await hashPassword(v.password);
      const hoy = new Date().toISOString().slice(0, 10);
      const { data, error } = await this.sb.functions.invoke('admin-usuarios', {
        body: {
          accion: 'crear',
          empresaId: empresa.id,
          password,
          perfil: {
            nombre_usuario: v.nombreUsuario.trim(),
            nombre: v.nombre.trim(),
            email: v.email.trim(),
            role: 'admin',
            activo: true,
            fecha_inicio_vigencia: hoy,
            fecha_fin_vigencia: '2100-12-31',
          },
        },
      });
      if (error) {
        const detalle = await (error as { context?: Response }).context?.json?.().catch(() => null);
        throw new Error(detalle?.error ?? error.message);
      }
      this.toast.exito(`Admin "${data?.usuario?.nombre_usuario ?? v.nombreUsuario}" creado para ${empresa.nombre}.`);
      this.empresaParaAdmin.set(null);
    } catch (e) {
      this.toast.error((e as Error).message || 'No se pudo crear el usuario.');
    } finally {
      this.guardando.set(false);
    }
  }

  // ── Entrar como (modo soporte) ────────────────────────────────────
  pedirEntrar(empresa: Empresa): void {
    if (!empresa.activo) {
      this.toast.advertencia('Activa la empresa antes de entrar a ella.');
      return;
    }
    this.empresaParaEntrar.set(empresa);
  }

  async confirmarEntrar(): Promise<void> {
    const empresa = this.empresaParaEntrar();
    if (!empresa || !this.sb) return;
    const { error } = await this.sb.schema('seguridad').rpc('cambiar_empresa_activa', { p_empresa: empresa.id });
    if (error) {
      this.toast.error(error.message);
      return;
    }
    // Recarga completa: todas las pantallas vuelven a leer ya dentro de esa empresa.
    window.location.assign('/modulos');
  }

  /** Para el botón de la tabla: "Entrar" a la empresa. */
  etiquetaEntrar = (): string => 'Entrar';
}

import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
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

/** Los 5 módulos que se venden por separado (ver licencia-modulos.service.ts
 *  en el frontend y supabase/migrations/15_licencias_modulos.sql en la base).
 *  Seguridad y Panel de control no aparecen aquí: son base del sistema. */
const MODULOS_VENDIBLES: { clave: string; nombre: string }[] = [
  { clave: 'wikidocs', nombre: 'WikiDocs' },
  { clave: 'presupuesto', nombre: 'Presupuesto Personal' },
  { clave: 'proyectos', nombre: 'Gestión de Proyectos' },
  { clave: 'familia', nombre: 'Familia' },
  { clave: 'inventario', nombre: 'Inventario' },
  { clave: 'ventas', nombre: 'Ventas' },
];

interface ModuloEmpresaFila {
  clave: string;
  nombre: string;
  activo: boolean;
}

export interface Empresa {
  id: number;
  clave: string;
  nombre: string;
  activo: boolean;
  /** Tope de usuarios activos para esta empresa; null/undefined = sin límite. */
  maxUsuarios?: number | null;
  fechaCreacion?: string;
  // ── Tienda pública (ver /tienda y /tienda/:clave) ──────────────────
  /** Texto corto para el portal/catálogo público; null = sin descripción. */
  descripcionPublica?: string | null;
  /** Teléfono (WhatsApp) al que llega el pedido armado por el cliente. */
  telefonoPedidos?: string | null;
  /** Correo alterno/adicional al que también puede llegar el pedido. */
  correoPedidos?: string | null;
  /** Logo en base64 (data URL) para el portal — mismo criterio que Producto.foto. */
  logoPublico?: string | null;
  /** Si está en false, /tienda/:clave de esta empresa no muestra nada (y no
   *  aparece en el portal /tienda), aunque la empresa esté activa. */
  catalogoPublicoActivo?: boolean;
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
  styleUrl: './empresas.component.scss',
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
  /** Eliminar una empresa ahora SÍ borra todo lo suyo (ver eliminar_empresa()
   *  en la migración 31) — por lo irreversible/destructivo que es, se pide
   *  teclear la CLAVE de la empresa para habilitar el botón, en vez de un
   *  simple sí/no (mismo criterio que confirmaciones de borrado masivo en
   *  otras plataformas: GitHub, etc.). */
  protected readonly textoConfirmacionEliminar = signal('');
  protected readonly eliminando = signal(false);
  protected readonly eliminarHabilitado = computed(
    () => this.textoConfirmacionEliminar().trim().toLowerCase() === (this.aEliminar()?.clave ?? '').toLowerCase(),
  );
  protected readonly empresaParaAdmin = signal<Empresa | null>(null);
  protected readonly empresaParaEntrar = signal<Empresa | null>(null);
  protected readonly guardando = signal(false);

  // ── Módulos contratados ──────────────────────────────────────────
  protected readonly empresaParaModulos = signal<Empresa | null>(null);
  protected readonly modulosDeEmpresa = signal<ModuloEmpresaFila[]>([]);
  protected readonly cargandoModulos = signal(false);

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
      campo: 'maxUsuarios',
      etiqueta: 'Máx. usuarios',
      formatear: (f) => (f.maxUsuarios ? String(f.maxUsuarios) : 'Sin límite'),
    },
    {
      campo: 'fechaCreacion',
      etiqueta: 'Alta',
      formatear: (f) => (f.fechaCreacion ? f.fechaCreacion.slice(0, 10) : ''),
    },
    {
      campo: 'catalogoPublicoActivo',
      etiqueta: 'Tienda pública',
      formatear: (f) => (f.catalogoPublicoActivo ? `/tienda/${f.clave}` : 'Apagada'),
      claseValor: (f) => (f.catalogoPublicoActivo ? 'grid-badge-success' : 'grid-badge-muted'),
    },
  ];

  protected readonly formEmpresa = this.fb.nonNullable.group({
    clave: ['', [Validators.required, Validators.pattern(/^[a-z0-9-]{2,30}$/)]],
    nombre: ['', [Validators.required, Validators.maxLength(80)]],
    activo: [true],
    // Vacío = sin límite de usuarios.
    maxUsuarios: this.fb.control<number | null>(null, [Validators.min(1)]),
    // ── Tienda pública ────────────────────────────────────────────────
    catalogoPublicoActivo: [false],
    descripcionPublica: ['', [Validators.maxLength(200)]],
    telefonoPedidos: ['', [Validators.maxLength(30)]],
    correoPedidos: ['', [Validators.maxLength(120)]],
  });

  // ── Logo de la tienda pública (mismo patrón que fotoActual en productos.component.ts) ──
  protected readonly logoActual = signal<string>('');
  protected readonly logoAmpliado = signal(false);

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
    this.formEmpresa.reset({
      clave: '',
      nombre: '',
      activo: true,
      maxUsuarios: null,
      catalogoPublicoActivo: false,
      descripcionPublica: '',
      telefonoPedidos: '',
      correoPedidos: '',
    });
    this.logoActual.set('');
    this.logoAmpliado.set(false);
    this.formEmpresa.controls.clave.enable();
    this.modalEmpresa.set(true);
  }

  editar(empresa: Empresa): void {
    this.empresaEnEdicion.set(empresa);
    this.formEmpresa.reset({
      clave: empresa.clave,
      nombre: empresa.nombre,
      activo: empresa.activo,
      maxUsuarios: empresa.maxUsuarios ?? null,
      catalogoPublicoActivo: empresa.catalogoPublicoActivo ?? false,
      descripcionPublica: empresa.descripcionPublica ?? '',
      telefonoPedidos: empresa.telefonoPedidos ?? '',
      correoPedidos: empresa.correoPedidos ?? '',
    });
    this.logoActual.set(empresa.logoPublico ?? '');
    this.logoAmpliado.set(false);
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
    const tiendaPublica = {
      catalogoPublicoActivo: valor.catalogoPublicoActivo,
      descripcionPublica: valor.descripcionPublica.trim() || null,
      telefonoPedidos: valor.telefonoPedidos.trim() || null,
      correoPedidos: valor.correoPedidos.trim() || null,
      logoPublico: this.logoActual() || null,
    };
    const peticion = edicion
      ? this.data.modificacion<Empresa>('Empresa', {
          id: edicion.id,
          nombre: valor.nombre.trim(),
          activo: valor.activo,
          maxUsuarios: valor.maxUsuarios,
          ...tiendaPublica,
        })
      : this.data.alta<Empresa>('Empresa', {
          clave: valor.clave.trim(),
          nombre: valor.nombre.trim(),
          activo: valor.activo,
          maxUsuarios: valor.maxUsuarios,
          ...tiendaPublica,
        });
    peticion.subscribe({
      next: (empresa) => {
        this.modalEmpresa.set(false);
        this.toast.exito(edicion ? 'Empresa actualizada.' : `Empresa "${empresa.nombre}" creada. Ahora crea su primer admin.`);
        this.cargar();
      },
    });
  }

  pedirEliminar(empresa: Empresa): void {
    this.textoConfirmacionEliminar.set('');
    this.aEliminar.set(empresa);
  }

  cancelarEliminar(): void {
    this.aEliminar.set(null);
    this.textoConfirmacionEliminar.set('');
  }

  /** Borra la empresa Y TODO LO SUYO (inventario, ventas, proyectos,
   *  wikidocs, presupuesto, familia, usuarios — cualquier tabla con
   *  empresa_id) — ver seguridad.eliminar_empresa(), migración 31.
   *  Irreversible; por eso eliminarHabilitado() exige teclear la clave
   *  exacta antes de poder llamar esto (el botón ya viene deshabilitado
   *  en el template, esta comprobación es solo por si acaso). */
  async confirmarEliminar(): Promise<void> {
    const empresa = this.aEliminar();
    if (!empresa || !this.sb || !this.eliminarHabilitado()) return;
    this.eliminando.set(true);
    try {
      const { error } = await this.sb.schema('seguridad').rpc('eliminar_empresa', { p_empresa: empresa.id });
      if (error) {
        this.toast.error(error.message);
        return;
      }
      this.toast.exito(`Empresa "${empresa.nombre}" y todos sus datos fueron eliminados.`);
      this.cancelarEliminar();
      this.cargar();
    } finally {
      this.eliminando.set(false);
    }
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

  // ── Módulos contratados ──────────────────────────────────────────
  async pedirModulos(empresa: Empresa): Promise<void> {
    if (!this.sb) return;
    this.empresaParaModulos.set(empresa);
    this.cargandoModulos.set(true);
    const { data, error } = await this.sb
      .schema('seguridad')
      .from('empresa_modulo')
      .select('modulo_clave, activo')
      .eq('empresa_id', empresa.id);
    const activosPorClave = new Map(
      (error ? [] : (data ?? [])).map((f: { modulo_clave: string; activo: boolean }) => [f.modulo_clave, f.activo]),
    );
    this.modulosDeEmpresa.set(
      MODULOS_VENDIBLES.map((m) => ({ clave: m.clave, nombre: m.nombre, activo: activosPorClave.get(m.clave) ?? false })),
    );
    this.cargandoModulos.set(false);
    if (error) this.toast.error(error.message);
  }

  async toggleModulo(fila: ModuloEmpresaFila): Promise<void> {
    const empresa = this.empresaParaModulos();
    if (!empresa || !this.sb) return;
    const nuevoValor = !fila.activo;
    // Optimista: refleja el cambio de inmediato, se revierte si falla.
    this.modulosDeEmpresa.update((filas) =>
      filas.map((f) => (f.clave === fila.clave ? { ...f, activo: nuevoValor } : f)),
    );
    const { error } = await this.sb
      .schema('seguridad')
      .from('empresa_modulo')
      .upsert({ empresa_id: empresa.id, modulo_clave: fila.clave, activo: nuevoValor }, { onConflict: 'empresa_id,modulo_clave' });
    if (error) {
      this.modulosDeEmpresa.update((filas) =>
        filas.map((f) => (f.clave === fila.clave ? { ...f, activo: !nuevoValor } : f)),
      );
      this.toast.error(error.message);
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
    // '/modulos' a secas se resuelve contra la RAÍZ DEL DOMINIO, no contra
    // el base href de este despliegue (en GitHub Pages la app vive bajo
    // /saurix-web/, no en la raíz) — con eso daba 404. document.baseURI ya
    // trae ese prefijo (Angular lo toma de <base href> en index.html,
    // sobreescrito en build con --base-href), así que se resuelve ahí.
    window.location.assign(new URL('modulos', document.baseURI).toString());
  }

  /** Para el botón de la tabla: "Entrar" a la empresa. */
  etiquetaEntrar = (): string => 'Entrar';

  // ── Logo de la tienda pública ───────────────────────────────────────
  /** Igual que redimensionarFoto() en productos.component.ts (FileReader →
   *  <canvas> → JPEG comprimido). */
  private redimensionarLogo(archivo: File): Promise<string> {
    const MAX_LADO = 480;
    return new Promise((resolve, reject) => {
      const lector = new FileReader();
      lector.onload = () => {
        const imagen = new Image();
        imagen.onload = () => {
          let { width, height } = imagen;
          if (width > height && width > MAX_LADO) {
            height = Math.round((height * MAX_LADO) / width);
            width = MAX_LADO;
          } else if (height >= width && height > MAX_LADO) {
            width = Math.round((width * MAX_LADO) / height);
            height = MAX_LADO;
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const contexto = canvas.getContext('2d');
          if (!contexto) {
            reject(new Error('Sin contexto de canvas.'));
            return;
          }
          contexto.drawImage(imagen, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        imagen.onerror = () => reject(new Error('No se pudo leer la imagen.'));
        imagen.src = lector.result as string;
      };
      lector.onerror = () => reject(new Error('No se pudo leer el archivo.'));
      lector.readAsDataURL(archivo);
    });
  }

  onLogoSeleccionado(evento: Event): void {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.[0];
    if (!archivo) return;
    if (!archivo.type.startsWith('image/')) {
      this.toast.advertencia('Elige un archivo de imagen (JPG, PNG, etc.).');
      input.value = '';
      return;
    }
    if (archivo.size > 8 * 1024 * 1024) {
      this.toast.advertencia('La imagen no puede pesar más de 8 MB.');
      input.value = '';
      return;
    }
    this.redimensionarLogo(archivo)
      .then((dataUrl) => this.logoActual.set(dataUrl))
      .catch(() => this.toast.error('No se pudo procesar la imagen. Intenta con otra.'))
      .finally(() => {
        input.value = '';
      });
  }

  quitarLogo(input: HTMLInputElement): void {
    this.logoActual.set('');
    this.logoAmpliado.set(false);
    input.value = '';
  }
}

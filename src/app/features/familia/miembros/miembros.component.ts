import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import { AuthService } from '../../../core/services/auth.service';
import { DataClientService } from '../../../core/services/data-client.service';
import { AdjuntosPanelComponent } from '../../../shared/components/adjuntos-panel/adjuntos-panel.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { BitacoraComponent } from '../../../shared/components/bitacora/bitacora.component';
import { BitacoraService } from '../../../shared/services/bitacora.service';
import { ToastService } from '../../../shared/services/toast.service';
import { ValorLista } from '../../../shared/valor-lista/valor-lista.model';
import { calcularRfcYCurp, OPCIONES_ENTIDAD, OPCIONES_SEXO } from '../../panel-control/rfc-curp/rfc-curp.util';
import { colorAvatar, iniciales } from '../../proyectos/kanban/avatar.util';
import { DocumentoFamilia } from '../documento-familia.model';
import {
  CLASE_ESTADO_VENCIMIENTO,
  DIAS_AVISO_CUMPLEANOS,
  ETIQUETA_ESTADO_VENCIMIENTO,
  calcularEdad,
  diasHastaCumpleanos,
  edadEnProximoCumpleanos,
  estadoVencimiento,
  fechaLocalDeTexto,
  obtenerOSembrarValorLista,
  proximoCumpleanosTexto,
} from '../familia.util';
import {
  GRUPO_ENTIDAD_NACIMIENTO,
  GRUPO_SEXO,
  GRUPO_TIPO_SANGRE,
  MiembroFamilia,
  SEMILLA_TIPO_SANGRE,
} from '../miembro-familia.model';

const ENTIDAD_MIEMBRO = 'MiembroFamilia';
const ENTIDAD_DOCUMENTO = 'DocumentoFamilia';
const MODULO_BITACORA = 'Familia / Miembros';

/**
 * Catálogo de "Miembros de familia" con su ficha (pestañas Datos/
 * Documentos/Tarjeta de emergencia), todo en un solo componente — mismo
 * criterio que WikiDocs (documentos-list.component.ts, señal `vista`
 * lista/ficha) en vez de una ruta :id aparte.
 *
 * No es un catálogo privado por usuario (a diferencia de Presupuesto
 * Personal): cualquier usuario de Saurix ve el mismo directorio de
 * familia — por eso no filtra por creadoPorUsuarioId al cargar.
 */
@Component({
  selector: 'app-miembros-familia',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, AdjuntosPanelComponent, BitacoraComponent, DatePipe],
  templateUrl: './miembros.component.html',
  styleUrl: './miembros.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MiembrosFamiliaComponent implements OnInit, OnDestroy {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly bitacora = inject(BitacoraService);

  protected readonly moduloBitacora = MODULO_BITACORA;
  protected readonly calcularEdad = calcularEdad;
  /** Mismo avatar por iniciales que usa Gestión de Proyectos para las
   *  personas asignadas (ver avatar.util.ts) — reutilizado aquí para la
   *  tarjeta de emergencia, ya que el miembro de familia no tiene foto. */
  protected readonly colorAvatar = colorAvatar;
  protected readonly iniciales = iniciales;
  protected readonly estadoVencimiento = estadoVencimiento;
  protected readonly etiquetaEstadoVencimiento = ETIQUETA_ESTADO_VENCIMIENTO;
  protected readonly claseEstadoVencimiento = CLASE_ESTADO_VENCIMIENTO;

  // ── Listado ────────────────────────────────────────────────────────
  protected readonly miembros = signal<MiembroFamilia[]>([]);
  protected readonly parentescos = signal<ValorLista[]>([]);
  protected readonly tiposDocumento = signal<ValorLista[]>([]);
  /** Sexo, Entidad de nacimiento y Tipo de sangre ahora son catálogos ValorLista
   *  propios (Familia → Catálogos) en vez de arreglos fijos — ver miembro-familia.model.ts. */
  protected readonly sexos = signal<ValorLista[]>([]);
  protected readonly entidadesNacimiento = signal<ValorLista[]>([]);
  protected readonly tiposSangre = signal<ValorLista[]>([]);
  protected readonly documentos = signal<DocumentoFamilia[]>([]);
  protected readonly cargando = signal(false);
  protected readonly mostrarInactivos = signal(false);
  protected readonly aEliminar = signal<MiembroFamilia | null>(null);

  protected readonly miembrosVisibles = computed(() =>
    this.miembros().filter((m) => this.mostrarInactivos() || m.activo !== false),
  );

  /** Documentos vencidos o por vencer de miembros ACTIVOS, sin importar si
   *  "Mostrar inactivos" está prendido o no en este momento — un miembro
   *  dado de baja ya no necesita avisos. Se muestra como banner arriba de
   *  la tabla (ver miembros.component.html) para no tener que entrar a la
   *  ficha de cada quien a revisar su pestaña Documentos una por una. */
  protected readonly documentosPorVencer = computed(() => {
    const miembrosPorId = new Map(this.miembros().filter((m) => m.activo !== false).map((m) => [Number(m.id), m]));
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    return this.documentos()
      .filter((d) => miembrosPorId.has(Number(d.miembroFamiliaId)))
      .map((d) => {
        const estado = estadoVencimiento(d);
        const dias = d.fechaVencimiento
          ? Math.round((fechaLocalDeTexto(d.fechaVencimiento).getTime() - hoy.getTime()) / 86_400_000)
          : null;
        return { documento: d, miembro: miembrosPorId.get(Number(d.miembroFamiliaId))!, estado, dias };
      })
      .filter((x) => x.estado === 'vencido' || x.estado === 'por-vencer')
      .sort((a, b) => (a.dias ?? 0) - (b.dias ?? 0));
  });

  /** Cumpleaños de miembros activos dentro de los próximos DIAS_AVISO_CUMPLEANOS
   *  días (0 = hoy) — mismo criterio de solo-activos que documentosPorVencer. */
  protected readonly cumpleanosProximos = computed(() =>
    this.miembros()
      .filter((m) => m.activo !== false)
      .map((m) => ({
        miembro: m,
        dias: diasHastaCumpleanos(m.fechaNacimiento),
        edad: edadEnProximoCumpleanos(m.fechaNacimiento),
        fechaTexto: proximoCumpleanosTexto(m.fechaNacimiento),
      }))
      .filter((x): x is { miembro: MiembroFamilia; dias: number; edad: number | null; fechaTexto: string } => x.dias !== null && x.dias <= DIAS_AVISO_CUMPLEANOS)
      .sort((a, b) => a.dias - b.dias),
  );

  protected textoDiasCumpleanos(dias: number): string {
    if (dias === 0) return 'hoy';
    if (dias === 1) return 'mañana';
    return `en ${dias} días`;
  }

  protected readonly columnas: ColumnaTabla<MiembroFamilia>[] = [
    {
      campo: 'nombre',
      etiqueta: 'Nombre',
      formatear: (m) => [m.nombre, m.apellidoPaterno, m.apellidoMaterno].filter(Boolean).join(' '),
    },
    {
      campo: 'id',
      etiqueta: 'Alertas',
      formatear: (m) => this.alertaMiembro(m)?.texto ?? '—',
      claseValor: (m) => this.alertaMiembro(m)?.clase ?? 'grid-badge-muted',
      titulo: (m) => this.alertaMiembro(m)?.titulo ?? 'Sin pendientes.',
    },
    { campo: 'parentescoClave', etiqueta: 'Parentesco', formatear: (m) => this.etiquetaParentesco(m.parentescoClave) },
    {
      campo: 'fechaNacimiento',
      etiqueta: 'Edad',
      formatear: (m) => {
        const edad = calcularEdad(m.fechaNacimiento);
        return edad === null ? '—' : `${edad} años`;
      },
    },
    { campo: 'tipoSangre', etiqueta: 'Tipo de sangre', formatear: (m) => m.tipoSangre || '—' },
    { campo: 'telefono', etiqueta: 'Teléfono', formatear: (m) => m.telefono || '—' },
    {
      campo: 'activo',
      etiqueta: 'Activo',
      formatear: (m) => (m.activo !== false ? 'Sí' : 'No'),
      claseValor: (m) => (m.activo !== false ? 'grid-badge-success' : 'grid-badge-muted'),
    },
  ];

  protected etiquetaParentesco(clave: string): string {
    return this.parentescos().find((p) => p.clave === clave)?.etiqueta ?? clave ?? '—';
  }

  protected etiquetaTipoDocumento(clave: string): string {
    return this.tiposDocumento().find((t) => t.clave === clave)?.etiqueta ?? clave ?? '—';
  }

  /** Resumen de pendientes de un miembro para la columna "Alertas" de la
   *  lista — mismos criterios que la tarjeta de emergencia (tipo de sangre,
   *  contacto de emergencia) más el estado de sus documentos, para poder
   *  detectar una ficha incompleta sin tener que abrirla. null = sin
   *  pendientes (la celda muestra "—"). */
  protected alertaMiembro(m: MiembroFamilia): { texto: string; clase: string; titulo: string } | null {
    const docsDelMiembro = this.documentos().filter((d) => Number(d.miembroFamiliaId) === Number(m.id));
    const peorDocumento = docsDelMiembro.reduce<'vencido' | 'por-vencer' | null>((peor, d) => {
      if (peor === 'vencido') return peor;
      const estado = estadoVencimiento(d);
      return estado === 'vencido' || estado === 'por-vencer' ? estado : peor;
    }, null);

    const partes: string[] = [];
    const detalles: string[] = [];
    if (peorDocumento === 'vencido') {
      partes.push('📄 Doc. vencido');
      detalles.push('Tiene al menos un documento vencido.');
    } else if (peorDocumento === 'por-vencer') {
      partes.push('📄 Doc. por vencer');
      detalles.push('Tiene un documento por vencer pronto.');
    }
    if (!m.tipoSangre) {
      partes.push('🩸 Sin tipo de sangre');
      detalles.push('Falta capturar el tipo de sangre.');
    }
    if (!m.contactoEmergenciaNombre && !m.contactoEmergenciaTelefono) {
      partes.push('📵 Sin contacto de emergencia');
      detalles.push('Falta capturar un contacto de emergencia.');
    }
    if (!partes.length) return null;
    return {
      texto: partes.join(' · '),
      clase: peorDocumento === 'vencido' ? 'grid-badge-danger' : 'grid-badge-warning',
      titulo: detalles.join(' '),
    };
  }

  // ── Ficha (Datos/Documentos/Tarjeta) ────────────────────────────────
  protected readonly vista = signal<'lista' | 'ficha'>('lista');
  protected readonly tabFicha = signal<'datos' | 'documentos' | 'tarjeta'>('datos');
  /** Sub-pestañas dentro de "Datos" — mismo patrón que las pestañas de
   *  Detalles/Fechas/... del detalle de ticket en Gestión de Proyectos
   *  (kanban.component.ts → tabActiva/seleccionarTab). */
  protected readonly subTabDatos = signal<'personales' | 'rfc' | 'medica' | 'contacto'>('personales');
  protected readonly miembroActivo = signal<MiembroFamilia | null>(null);
  /** Foto de la persona en edición (base64, ya redimensionada) — aparte del
   *  form reactivo porque es un valor grande que no tiene <input> con
   *  formControlName; se manda a mano dentro de guardarMiembro(). */
  protected readonly fotoActual = signal<string>('');
  /** QR con el resumen de la tarjeta de emergencia, para "ver la información"
   *  escaneándolo — se regenera solo cuando se abre la pestaña Tarjeta o
   *  cambia el miembro activo (ver el effect() en el constructor). */
  protected readonly qrDataUrl = signal<string>('');

  protected readonly documentosDelMiembro = computed(() => {
    const id = this.miembroActivo()?.id;
    if (!id) return [];
    return this.documentos()
      .filter((d) => Number(d.miembroFamiliaId) === Number(id))
      .sort((a, b) => (a.fechaVencimiento || '9999').localeCompare(b.fechaVencimiento || '9999'));
  });

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    nombre: ['', Validators.required],
    apellidoPaterno: ['', Validators.required],
    apellidoMaterno: [''],
    parentescoClave: ['', Validators.required],
    fechaNacimiento: ['', Validators.required],
    sexo: ['', Validators.required],
    entidadNacimiento: ['', Validators.required],
    tipoSangre: [''],
    telefono: [''],
    rfc: [''],
    curp: [''],
    alergias: [''],
    condicionesCronicas: [''],
    medicamentos: [''],
    contactoEmergenciaNombre: [''],
    contactoEmergenciaTelefono: [''],
    aseguradora: [''],
    numeroPoliza: [''],
    activo: [true],
  });

  /** Genera (o limpia) el QR de la tarjeta de emergencia cada vez que se
   *  abre la pestaña "Tarjeta" o cambia el miembro activo — así siempre
   *  refleja los datos ya guardados (los mismos que ve descargarTarjeta()). */
  private readonly regenerarQr = effect(() => {
    const m = this.miembroActivo();
    const enTarjeta = this.tabFicha() === 'tarjeta';
    if (!m || !enTarjeta) {
      this.qrDataUrl.set('');
      return;
    }
    QRCode.toDataURL(this.textoQr(m), { width: 240, margin: 1 })
      .then((url) => this.qrDataUrl.set(url))
      .catch(() => this.qrDataUrl.set(''));
  });

  ngOnInit(): void {
    // Fichas con varios campos + pestañas — mismo criterio que Movimientos/
    // Deudas/Proyección (ver html[data-wide='grid'] en styles.scss).
    document.documentElement.setAttribute('data-wide', 'grid');
    this.data.list<ValorLista>('ValorLista', { grupo: 'FamiliaParentesco' }).subscribe((v) =>
      this.parentescos.set(v.filter((r) => r.grupo === 'FamiliaParentesco' && r.activo !== false).sort((a, b) => a.orden - b.orden)),
    );
    this.data.list<ValorLista>('ValorLista', { grupo: 'DocumentoFamiliaTipo' }).subscribe((v) =>
      this.tiposDocumento.set(v.filter((r) => r.grupo === 'DocumentoFamiliaTipo' && r.activo !== false).sort((a, b) => a.orden - b.orden)),
    );
    // Sexo/Entidad de nacimiento/Tipo de sangre se siembran solos la primera vez
    // que se usan en este navegador (ver obtenerOSembrarValorLista) — así el
    // combo nunca aparece vacío aunque el usuario nunca haya abierto esos
    // catálogos desde Familia → Catálogos.
    obtenerOSembrarValorLista(
      this.data,
      GRUPO_SEXO,
      OPCIONES_SEXO.map((o) => ({ clave: o.valor, etiqueta: o.etiqueta })),
    ).subscribe((v) => this.sexos.set(v.filter((r) => r.activo !== false).sort((a, b) => a.orden - b.orden)));
    obtenerOSembrarValorLista(
      this.data,
      GRUPO_ENTIDAD_NACIMIENTO,
      OPCIONES_ENTIDAD.map((o) => ({ clave: o.valor, etiqueta: o.etiqueta })),
    ).subscribe((v) => this.entidadesNacimiento.set(v.filter((r) => r.activo !== false).sort((a, b) => a.orden - b.orden)));
    obtenerOSembrarValorLista(this.data, GRUPO_TIPO_SANGRE, SEMILLA_TIPO_SANGRE).subscribe((v) =>
      this.tiposSangre.set(v.filter((r) => r.activo !== false).sort((a, b) => a.orden - b.orden)),
    );
    this.data.list<DocumentoFamilia>(ENTIDAD_DOCUMENTO).subscribe((d) => this.documentos.set(d));
    this.cargar();
  }

  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  cargar(): void {
    this.cargando.set(true);
    this.data.list<MiembroFamilia>(ENTIDAD_MIEMBRO).subscribe({
      next: (m) => {
        this.miembros.set(m);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  private get usuarioActual(): string {
    return this.auth.usuarioActual()?.nombreUsuario ?? 'Sistema';
  }

  // ── Alta / edición de miembro ───────────────────────────────────────
  nuevoMiembro(): void {
    this.miembroActivo.set(null);
    this.form.reset({
      id: 0,
      nombre: '',
      apellidoPaterno: '',
      apellidoMaterno: '',
      parentescoClave: '',
      fechaNacimiento: '',
      sexo: '',
      entidadNacimiento: '',
      tipoSangre: '',
      telefono: '',
      rfc: '',
      curp: '',
      alergias: '',
      condicionesCronicas: '',
      medicamentos: '',
      contactoEmergenciaNombre: '',
      contactoEmergenciaTelefono: '',
      aseguradora: '',
      numeroPoliza: '',
      activo: true,
    });
    this.fotoActual.set('');
    this.tabFicha.set('datos');
    this.subTabDatos.set('personales');
    this.vista.set('ficha');
  }

  abrirMiembro(miembro: MiembroFamilia): void {
    this.miembroActivo.set(miembro);
    this.form.reset({ ...miembro, apellidoMaterno: miembro.apellidoMaterno ?? '' });
    this.fotoActual.set(miembro.foto ?? '');
    this.tabFicha.set('datos');
    this.subTabDatos.set('personales');
    this.vista.set('ficha');
  }

  volverALista(): void {
    this.vista.set('lista');
    this.miembroActivo.set(null);
  }

  /** Autollena RFC/CURP a partir de nombre/apellidos/fecha de nacimiento/
   *  sexo/entidad ya capturados — reusa la misma calculadora de Panel de
   *  Control (ver rfc-curp.util.ts). Es un botón aparte (no automático en
   *  cada tecleo) para no pisar una corrección manual sin que el usuario lo
   *  pida. */
  generarRfcCurp(): void {
    const v = this.form.getRawValue();
    if (!v.nombre || !v.apellidoPaterno || !v.fechaNacimiento || !v.sexo || !v.entidadNacimiento) {
      this.toast.advertencia('Captura nombre, apellido paterno, fecha de nacimiento, sexo y entidad de nacimiento primero.');
      return;
    }
    try {
      const resultado = calcularRfcYCurp({
        nombre: v.nombre.trim(),
        apellidoPaterno: v.apellidoPaterno.trim(),
        apellidoMaterno: v.apellidoMaterno.trim(),
        fechaNacimiento: v.fechaNacimiento,
        sexo: v.sexo,
        entidadNacimiento: v.entidadNacimiento,
      });
      this.form.patchValue({ rfc: resultado.rfc, curp: resultado.curp });
      this.toast.exito('RFC y CURP calculados — revísalos antes de guardar (no son el documento oficial).');
    } catch {
      this.toast.error('No se pudo calcular con esos datos. Revísalos e intenta de nuevo.');
    }
  }

  guardarMiembro(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toast.error('Captura nombre, apellido paterno, parentesco, fecha de nacimiento, sexo y entidad de nacimiento.');
      return;
    }

    const valor = { ...this.form.getRawValue(), foto: this.fotoActual() };
    const previo = this.miembroActivo();
    const esEdicion = previo !== null;

    const peticion = esEdicion
      ? this.data.modificacion<MiembroFamilia>(ENTIDAD_MIEMBRO, valor)
      : this.data.alta<MiembroFamilia>(ENTIDAD_MIEMBRO, valor);

    peticion.subscribe({
      next: (resultado) => {
        this.bitacora
          .registrar({
            modulo: this.moduloBitacora,
            entidad: ENTIDAD_MIEMBRO,
            accion: esEdicion ? 'Modificación' : 'Alta',
            usuario: this.usuarioActual,
            registroId: resultado.id,
            anterior: previo as unknown as Record<string, unknown> | null,
            actual: resultado as unknown as Record<string, unknown>,
          })
          .subscribe();
        this.toast.exito(esEdicion ? 'Miembro actualizado.' : 'Miembro creado.');
        this.miembroActivo.set(resultado);
        this.cargar();
      },
      error: () => this.toast.error('No se pudo guardar. Intenta de nuevo.'),
    });
  }

  pedirEliminarMiembro(miembro: MiembroFamilia): void {
    this.aEliminar.set(miembro);
  }

  confirmarEliminarMiembro(): void {
    const miembro = this.aEliminar();
    if (!miembro) return;

    this.data.baja(ENTIDAD_MIEMBRO, miembro.id).subscribe({
      next: () => {
        this.bitacora
          .registrar({
            modulo: this.moduloBitacora,
            entidad: ENTIDAD_MIEMBRO,
            accion: 'Baja',
            usuario: this.usuarioActual,
            registroId: miembro.id,
            anterior: miembro as unknown as Record<string, unknown>,
            actual: null,
          })
          .subscribe();
        this.toast.exito('Miembro eliminado.');
        this.aEliminar.set(null);
        if (this.miembroActivo()?.id === miembro.id) this.volverALista();
        this.cargar();
      },
      error: () => this.toast.error('No se pudo eliminar. Intenta de nuevo.'),
    });
  }

  // ── Documentos ───────────────────────────────────────────────────────
  protected readonly modalDocumentoAbierto = signal(false);
  protected readonly documentoEnEdicion = signal<DocumentoFamilia | null>(null);
  protected readonly documentoAEliminar = signal<DocumentoFamilia | null>(null);
  protected readonly documentoExpandidoId = signal<number | null>(null);

  protected readonly formDocumento = this.fb.nonNullable.group({
    id: [0],
    miembroFamiliaId: [0],
    tipoDocumentoClave: ['', Validators.required],
    fechaVencimiento: [''],
    notas: [''],
  });

  toggleAdjuntosDocumento(documento: DocumentoFamilia): void {
    this.documentoExpandidoId.update((id) => (id === documento.id ? null : documento.id));
  }

  nuevoDocumento(): void {
    const miembro = this.miembroActivo();
    if (!miembro) return;
    this.documentoEnEdicion.set(null);
    this.formDocumento.reset({ id: 0, miembroFamiliaId: miembro.id, tipoDocumentoClave: '', fechaVencimiento: '', notas: '' });
    this.modalDocumentoAbierto.set(true);
  }

  editarDocumento(documento: DocumentoFamilia): void {
    this.documentoEnEdicion.set(documento);
    this.formDocumento.reset(documento);
    this.modalDocumentoAbierto.set(true);
  }

  cerrarModalDocumento(): void {
    this.toast.info('Cambios descartados.');
    this.modalDocumentoAbierto.set(false);
  }

  guardarDocumento(): void {
    if (this.formDocumento.invalid) {
      this.formDocumento.markAllAsTouched();
      this.toast.error('Elige el tipo de documento.');
      return;
    }
    const valor = this.formDocumento.getRawValue();
    const esEdicion = this.documentoEnEdicion() !== null;
    const peticion = esEdicion
      ? this.data.modificacion<DocumentoFamilia>(ENTIDAD_DOCUMENTO, valor)
      : this.data.alta<DocumentoFamilia>(ENTIDAD_DOCUMENTO, valor);

    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? 'Documento actualizado.' : 'Documento agregado.');
        this.modalDocumentoAbierto.set(false);
        this.data.list<DocumentoFamilia>(ENTIDAD_DOCUMENTO).subscribe((d) => this.documentos.set(d));
      },
      error: () => this.toast.error('No se pudo guardar el documento. Intenta de nuevo.'),
    });
  }

  pedirEliminarDocumento(documento: DocumentoFamilia): void {
    this.documentoAEliminar.set(documento);
  }

  confirmarEliminarDocumento(): void {
    const documento = this.documentoAEliminar();
    if (!documento) return;
    this.data.baja(ENTIDAD_DOCUMENTO, documento.id).subscribe({
      next: () => {
        this.toast.exito('Documento eliminado.');
        this.documentoAEliminar.set(null);
        this.data.list<DocumentoFamilia>(ENTIDAD_DOCUMENTO).subscribe((d) => this.documentos.set(d));
      },
      error: () => this.toast.error('No se pudo eliminar. Intenta de nuevo.'),
    });
  }

  // ── Foto de la persona ───────────────────────────────────────────────
  /** Igual que adjuntos-panel.component.ts (FileReader → base64), más un
   *  paso de redimensionado en <canvas> para no guardar fotos de cámara de
   *  varios MB tal cual en IndexedDB — se guarda ya comprimida a JPEG. */
  private redimensionarFoto(archivo: File): Promise<string> {
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

  onFotoSeleccionada(evento: Event): void {
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

    this.redimensionarFoto(archivo)
      .then((dataUrl) => this.fotoActual.set(dataUrl))
      .catch(() => this.toast.error('No se pudo procesar la imagen. Intenta con otra.'))
      .finally(() => {
        input.value = '';
      });
  }

  quitarFoto(input: HTMLInputElement): void {
    this.fotoActual.set('');
    input.value = '';
  }

  // ── Tarjeta de emergencia ────────────────────────────────────────────
  /** Descarga una tarjeta tamaño credencial (85.6mm x 54mm, mismo tamaño
   *  que una tarjeta bancaria/INE) en PDF, dibujada con jsPDF (ya es
   *  dependencia del proyecto — ver Comercio/Cotizaciones), no una captura
   *  de pantalla: así el texto sale nítido y seleccionable en el PDF. */
  /** Texto plano (sin URL: la app es 100% local/IndexedDB, no hay dónde
   *  alojar una página "ver registro") que codifica el QR — mismo resumen
   *  que ya se ve en pantalla y en el PDF, para que escanearlo sirva de
   *  verdad en una emergencia aunque el celular no tenga la app. */
  private textoQr(m: MiembroFamilia): string {
    const edad = calcularEdad(m.fechaNacimiento);
    const lineas = [
      'Tarjeta de emergencia — Saurix',
      `Nombre: ${[m.nombre, m.apellidoPaterno, m.apellidoMaterno].filter(Boolean).join(' ')}`,
      `Edad: ${edad === null ? '—' : edad + ' años'}`,
      `Tipo de sangre: ${m.tipoSangre || '—'}`,
    ];
    if (m.alergias) lineas.push(`Alergias: ${m.alergias}`);
    if (m.condicionesCronicas) lineas.push(`Condiciones: ${m.condicionesCronicas}`);
    if (m.medicamentos) lineas.push(`Medicamentos: ${m.medicamentos}`);
    lineas.push(
      `Contacto de emergencia: ${m.contactoEmergenciaNombre || '—'}${m.contactoEmergenciaTelefono ? ' · ' + m.contactoEmergenciaTelefono : ''}`,
    );
    if (m.aseguradora || m.numeroPoliza) {
      lineas.push(`Seguro: ${m.aseguradora || '—'}${m.numeroPoliza ? ' · Póliza ' + m.numeroPoliza : ''}`);
    }
    if (m.curp) lineas.push(`CURP: ${m.curp}`);
    return lineas.join('\n');
  }

  private hexARgbTarjeta(hex: string): [number, number, number] {
    const limpio = hex.replace('#', '');
    return [
      parseInt(limpio.slice(0, 2), 16) || 0,
      parseInt(limpio.slice(2, 4), 16) || 0,
      parseInt(limpio.slice(4, 6), 16) || 0,
    ];
  }

  async descargarTarjeta(): Promise<void> {
    const m = this.miembroActivo();
    if (!m) return;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
    await this.dibujarTarjetaEnPagina(doc, m);
    const nombreArchivo = `tarjeta-emergencia-${(m.nombre + ' ' + m.apellidoPaterno).trim().replace(/\s+/g, '-').toLowerCase()}.pdf`;
    doc.save(nombreArchivo);
  }

  /** Genera en un solo PDF las tarjetas de emergencia de todos los miembros
   *  ACTIVOS (sin importar si "Mostrar inactivos" está prendido ahorita en
   *  la lista) — una por página, en el mismo orden alfabético de la tabla.
   *  Pensado para imprimir de un jalón el "librito" de emergencia de toda
   *  la familia en vez de descargar una tarjeta a la vez. */
  protected readonly generandoTarjetas = signal(false);

  async descargarTodasLasTarjetas(): Promise<void> {
    const activos = this.miembros()
      .filter((m) => m.activo !== false)
      .sort((a, b) => (a.nombre + a.apellidoPaterno).localeCompare(b.nombre + b.apellidoPaterno, 'es-MX'));
    if (!activos.length) {
      this.toast.advertencia('No hay miembros activos para incluir.');
      return;
    }
    this.generandoTarjetas.set(true);
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
      for (let i = 0; i < activos.length; i++) {
        if (i > 0) doc.addPage();
        await this.dibujarTarjetaEnPagina(doc, activos[i]);
      }
      doc.save('tarjetas-emergencia-familia.pdf');
      this.toast.exito(`${activos.length} tarjeta${activos.length === 1 ? '' : 's'} incluida${activos.length === 1 ? '' : 's'} en el PDF.`);
    } finally {
      this.generandoTarjetas.set(false);
    }
  }

  /** Dibuja la tarjeta de emergencia de un miembro en la página ACTUAL de
   *  `doc` (quien llama decide cuándo abrir una página nueva con
   *  doc.addPage() — así se reutiliza igual para una tarjeta suelta que
   *  para el PDF combinado de toda la familia). */
  private async dibujarTarjetaEnPagina(doc: jsPDF, m: MiembroFamilia): Promise<void> {
    // A diferencia de una credencial física de bolsillo (85.6x54mm), el PDF
    // se genera en tamaño carta para que SIEMPRE quepa toda la información
    // sin recortarse al imprimir, y para que el QR se pueda dibujar lo
    // bastante grande como para escanearse bien con la cámara de un celular
    // — ambos problemas reportados con el diseño "credencial" anterior.
    // Mismo estilo visual (franjas de color, avatar/foto, QR) nada más que
    // en una página normal en vez de una tarjetita — sin ningún escudo,
    // logotipo ni texto oficial: sigue siendo una tarjeta propia de Saurix.
    const ANCHO = doc.internal.pageSize.getWidth();
    const ALTO = doc.internal.pageSize.getHeight();
    const MARGEN = 18;
    const anchoUtil = ANCHO - MARGEN * 2;

    const [rDanger, gDanger, bDanger] = this.hexARgbTarjeta('#b3432f');
    const nombreCompleto = [m.nombre, m.apellidoPaterno].filter(Boolean).join(' ');
    const [rAvatar, gAvatar, bAvatar] = this.hexARgbTarjeta(colorAvatar(nombreCompleto));
    // Se genera a mayor resolución que el QR de pantalla (qrDataUrl) para que
    // no se vea pixelado al imprimirse en un tamaño físico más grande.
    const qrPdf = await QRCode.toDataURL(this.textoQr(m), { width: 600, margin: 1 }).catch(() => '');

    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, ANCHO, ALTO, 'F');

    // ── Encabezado ────────────────────────────────────────────────────
    const altoEncabezado = 42;
    doc.setFillColor(rDanger, gDanger, bDanger);
    doc.rect(0, 0, ANCHO, altoEncabezado, 'F');

    const ladoAvatar = 30;
    const yAvatar = (altoEncabezado - ladoAvatar) / 2;
    let fotoDibujada = false;
    if (m.foto) {
      doc.setFillColor(255, 255, 255);
      doc.rect(MARGEN - 1, yAvatar - 1, ladoAvatar + 2, ladoAvatar + 2, 'F');
      try {
        doc.addImage(m.foto, 'JPEG', MARGEN, yAvatar, ladoAvatar, ladoAvatar);
        fotoDibujada = true;
      } catch {
        fotoDibujada = false;
      }
    }
    if (!fotoDibujada) {
      doc.setFillColor(rAvatar, gAvatar, bAvatar);
      doc.circle(MARGEN + ladoAvatar / 2, altoEncabezado / 2, ladoAvatar / 2, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(20);
      doc.text(iniciales(nombreCompleto), MARGEN + ladoAvatar / 2, altoEncabezado / 2 + 2.6, { align: 'center' });
    }

    const xTitulo = MARGEN + ladoAvatar + 10;
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(19);
    doc.text('TARJETA DE EMERGENCIA', xTitulo, altoEncabezado / 2 - 2);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    doc.text('Saurix · Directorio familiar', xTitulo, altoEncabezado / 2 + 6);

    // ── Cuerpo ────────────────────────────────────────────────────────
    let y = altoEncabezado + 14;

    doc.setTextColor(120, 120, 120);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text('NOMBRE COMPLETO', MARGEN, y);
    y += 9;

    doc.setTextColor(20, 20, 20);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    const lineasNombre = doc.splitTextToSize(
      [m.nombre, m.apellidoPaterno, m.apellidoMaterno].filter(Boolean).join(' '),
      anchoUtil,
    );
    doc.text(lineasNombre, MARGEN, y);
    y += 8.5 * lineasNombre.length + 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(13);
    const edad = calcularEdad(m.fechaNacimiento);
    doc.text(`Edad: ${edad === null ? '—' : edad + ' años'}`, MARGEN, y);
    doc.setFont('helvetica', 'bold');
    doc.text(`Tipo de sangre: ${m.tipoSangre || '—'}`, MARGEN + 70, y);
    doc.setFont('helvetica', 'normal');
    y += 10;

    const lineaLarga = (etiqueta: string, valor: string): void => {
      if (!valor) return;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text(`${etiqueta}:`, MARGEN, y);
      const anchoEtiqueta = doc.getTextWidth(`${etiqueta}: `);
      doc.setFont('helvetica', 'normal');
      const texto = doc.splitTextToSize(valor, anchoUtil - anchoEtiqueta);
      doc.text(texto, MARGEN + anchoEtiqueta, y);
      y += 6.2 * texto.length + 3;
    };

    lineaLarga('Alergias', m.alergias);
    lineaLarga('Condiciones crónicas', m.condicionesCronicas);
    lineaLarga('Medicamentos', m.medicamentos);

    y += 3;
    doc.setDrawColor(210, 210, 210);
    doc.line(MARGEN, y, ANCHO - MARGEN, y);
    y += 9;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text('Contacto de emergencia', MARGEN, y);
    y += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    doc.text(
      `${m.contactoEmergenciaNombre || '—'}${m.contactoEmergenciaTelefono ? '  ·  ' + m.contactoEmergenciaTelefono : ''}`,
      MARGEN,
      y,
    );
    y += 8;

    if (m.aseguradora || m.numeroPoliza) {
      doc.setFont('helvetica', 'bold');
      doc.text('Seguro', MARGEN, y);
      doc.setFont('helvetica', 'normal');
      doc.text(
        `${m.aseguradora || '—'}${m.numeroPoliza ? '  ·  Póliza ' + m.numeroPoliza : ''}`,
        MARGEN + doc.getTextWidth('Seguro  '),
        y,
      );
      y += 10;
    } else {
      y += 2;
    }

    // ── QR: en su propio recuadro, con tamaño real para poder escanearse
    // (no metido a fuerzas en una franja delgada como en la versión anterior). ──
    const ladoQr = 55;
    const cajaAlto = ladoQr + 14;
    doc.setFillColor(248, 246, 244);
    doc.roundedRect(MARGEN, y, anchoUtil, cajaAlto, 3, 3, 'F');
    if (qrPdf) {
      const xQr = MARGEN + anchoUtil - ladoQr - 8;
      const yQr = y + (cajaAlto - ladoQr) / 2;
      doc.setFillColor(255, 255, 255);
      doc.rect(xQr - 1.5, yQr - 1.5, ladoQr + 3, ladoQr + 3, 'F');
      try {
        doc.addImage(qrPdf, 'PNG', xQr, yQr, ladoQr, ladoQr);
      } catch {
        /* Si el QR no se pudo generar, el recuadro se queda solo con el texto. */
      }
    }
    doc.setTextColor(60, 60, 60);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Escanea el código para ver esta información', MARGEN + 8, y + 14, {
      maxWidth: anchoUtil - ladoQr - 26,
    });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text('Funciona sin conexión ni la app instalada: solo lee el texto del QR.', MARGEN + 8, y + 22, {
      maxWidth: anchoUtil - ladoQr - 26,
    });
    if (m.curp) {
      doc.setFontSize(10);
      doc.text(`CURP ${m.curp}`, MARGEN + 8, y + cajaAlto - 6);
    }
    y += cajaAlto;

    // ── Pie ───────────────────────────────────────────────────────────
    const altoPie = 12;
    doc.setFillColor(rDanger, gDanger, bDanger);
    doc.rect(0, ALTO - altoPie, ANCHO, altoPie, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const fecha = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
    doc.text(`Saurix · Directorio familiar — generado el ${fecha}`, ANCHO / 2, ALTO - altoPie / 2 + 1.2, {
      align: 'center',
    });

  }
}

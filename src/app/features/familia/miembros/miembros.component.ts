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
  ETIQUETA_ESTADO_VENCIMIENTO,
  calcularEdad,
  estadoVencimiento,
  obtenerOSembrarValorLista,
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

  protected readonly columnas: ColumnaTabla<MiembroFamilia>[] = [
    {
      campo: 'nombre',
      etiqueta: 'Nombre',
      formatear: (m) => [m.nombre, m.apellidoPaterno, m.apellidoMaterno].filter(Boolean).join(' '),
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

    // Mismo formato "credencial física" que se ve en pantalla (ver
    // .tarjeta-emergencia en el .scss): franja de color arriba con foto/avatar
    // + franja de color abajo con el CURP y el QR, cuerpo blanco en medio —
    // sin ningún escudo/logotipo oficial, es una tarjeta propia de Saurix.
    const ANCHO = 85.6;
    const ALTO = 54;
    const ALTO_PIE = 9;
    const [rDanger, gDanger, bDanger] = this.hexARgbTarjeta('#b3432f');
    const nombreCompleto = [m.nombre, m.apellidoPaterno].filter(Boolean).join(' ');
    const [rAvatar, gAvatar, bAvatar] = this.hexARgbTarjeta(colorAvatar(nombreCompleto));
    // El QR se genera aparte del que ya vive en pantalla (qrDataUrl) para no
    // depender de que la pestaña Tarjeta ya lo haya calculado.
    const qrPdf = await QRCode.toDataURL(this.textoQr(m), { width: 240, margin: 1 }).catch(() => '');

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [ALTO, ANCHO] });
    const anchoUtil = ANCHO - 10;

    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, ANCHO, ALTO, 'F');

    // Encabezado
    doc.setFillColor(rDanger, gDanger, bDanger);
    doc.rect(0, 0, ANCHO, 15, 'F');
    if (m.foto) {
      doc.setFillColor(255, 255, 255);
      doc.rect(3.5, 2, 11, 11, 'F');
      try {
        doc.addImage(m.foto, 'JPEG', 4, 2.5, 10, 10);
      } catch {
        doc.setFillColor(rAvatar, gAvatar, bAvatar);
        doc.circle(10, 7.5, 5, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.text(iniciales(nombreCompleto), 10, 8.7, { align: 'center' });
      }
    } else {
      doc.setFillColor(rAvatar, gAvatar, bAvatar);
      doc.circle(10, 7.5, 5, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text(iniciales(nombreCompleto), 10, 8.7, { align: 'center' });
    }
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('TARJETA DE EMERGENCIA', 19, 6.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text('Saurix · Directorio familiar', 19, 11);

    // Cuerpo
    doc.setTextColor(90, 90, 90);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text('NOMBRE COMPLETO', 5, 20);

    doc.setTextColor(20, 20, 20);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    const lineasNombre = doc.splitTextToSize(
      [m.nombre, m.apellidoPaterno, m.apellidoMaterno].filter(Boolean).join(' '),
      anchoUtil,
    );
    doc.text(lineasNombre, 5, 25);
    let y = 25 + 4.6 * lineasNombre.length + 1.5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const edad = calcularEdad(m.fechaNacimiento);
    doc.text(`Edad: ${edad === null ? '—' : edad + ' años'}`, 5, y);
    if (m.tipoSangre) {
      const anchoBadge = doc.getTextWidth(m.tipoSangre) + 7;
      const xBadge = ANCHO - 5 - anchoBadge;
      doc.setFillColor(rDanger, gDanger, bDanger);
      doc.roundedRect(xBadge, y - 3.3, anchoBadge, 4.6, 2, 2, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.text(`🩸 ${m.tipoSangre}`, xBadge + anchoBadge / 2, y, { align: 'center' });
      doc.setTextColor(20, 20, 20);
      doc.setFont('helvetica', 'normal');
    }
    y += 5;

    const lineaLarga = (etiqueta: string, valor: string): void => {
      if (!valor) return;
      const texto = doc.splitTextToSize(`${etiqueta}: ${valor}`, anchoUtil);
      doc.text(texto, 5, y);
      y += 4.2 * texto.length;
    };

    lineaLarga('Alergias', m.alergias);
    lineaLarga('Condiciones', m.condicionesCronicas);
    lineaLarga('Medicamentos', m.medicamentos);

    y += 1;
    doc.setDrawColor(210, 210, 210);
    doc.line(5, y, ANCHO - 5, y);
    y += 4;

    doc.setFont('helvetica', 'bold');
    doc.text('Contacto de emergencia', 5, y);
    y += 4.2;
    doc.setFont('helvetica', 'normal');
    doc.text(
      `${m.contactoEmergenciaNombre || '—'}  ${m.contactoEmergenciaTelefono ? '· ' + m.contactoEmergenciaTelefono : ''}`,
      5,
      y,
    );

    if (m.aseguradora || m.numeroPoliza) {
      y += 4.2;
      doc.text(`Seguro: ${m.aseguradora || '—'}${m.numeroPoliza ? ' · Póliza ' + m.numeroPoliza : ''}`, 5, y);
    }

    // Pie: texto (CURP o marca) a la izquierda + QR a la derecha para "ver
    // la información" escaneando, dentro de la misma franja de color.
    doc.setFillColor(rDanger, gDanger, bDanger);
    doc.rect(0, ALTO - ALTO_PIE, ANCHO, ALTO_PIE, 'F');
    const ladoQr = 7;
    const xQr = ANCHO - ladoQr - 2.5;
    const yQr = ALTO - ALTO_PIE + (ALTO_PIE - ladoQr) / 2;
    if (qrPdf) {
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(xQr - 0.7, yQr - 0.7, ladoQr + 1.4, ladoQr + 1.4, 0.8, 0.8, 'F');
      try {
        doc.addImage(qrPdf, 'PNG', xQr, yQr, ladoQr, ladoQr);
      } catch {
        /* Si el QR no se pudo generar, el pie se queda solo con el texto. */
      }
    }
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(m.curp ? `CURP ${m.curp}` : 'Saurix · Tarjeta de emergencia', 4, ALTO - ALTO_PIE / 2 + 1.2);

    const nombreArchivo = `tarjeta-emergencia-${(m.nombre + ' ' + m.apellidoPaterno).trim().replace(/\s+/g, '-').toLowerCase()}.pdf`;
    doc.save(nombreArchivo);
  }
}

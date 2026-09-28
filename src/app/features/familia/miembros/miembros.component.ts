import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { jsPDF } from 'jspdf';
import { AuthService } from '../../../core/services/auth.service';
import { DataClientService } from '../../../core/services/data-client.service';
import { AdjuntosPanelComponent } from '../../../shared/components/adjuntos-panel/adjuntos-panel.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { BitacoraComponent } from '../../../shared/components/bitacora/bitacora.component';
import { BitacoraService } from '../../../shared/services/bitacora.service';
import { ToastService } from '../../../shared/services/toast.service';
import { ValorLista } from '../../../shared/valor-lista/valor-lista.model';
import {
  calcularRfcYCurp,
  OPCIONES_ENTIDAD,
  OPCIONES_SEXO,
} from '../../panel-control/rfc-curp/rfc-curp.util';
import { DocumentoFamilia } from '../documento-familia.model';
import { CLASE_ESTADO_VENCIMIENTO, ETIQUETA_ESTADO_VENCIMIENTO, calcularEdad, estadoVencimiento } from '../familia.util';
import { MiembroFamilia, TIPOS_SANGRE } from '../miembro-familia.model';

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
  protected readonly opcionesEntidad = OPCIONES_ENTIDAD;
  protected readonly opcionesSexo = OPCIONES_SEXO;
  protected readonly tiposSangre = TIPOS_SANGRE;
  protected readonly calcularEdad = calcularEdad;
  protected readonly estadoVencimiento = estadoVencimiento;
  protected readonly etiquetaEstadoVencimiento = ETIQUETA_ESTADO_VENCIMIENTO;
  protected readonly claseEstadoVencimiento = CLASE_ESTADO_VENCIMIENTO;

  // ── Listado ────────────────────────────────────────────────────────
  protected readonly miembros = signal<MiembroFamilia[]>([]);
  protected readonly parentescos = signal<ValorLista[]>([]);
  protected readonly tiposDocumento = signal<ValorLista[]>([]);
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
  protected readonly miembroActivo = signal<MiembroFamilia | null>(null);

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
    this.tabFicha.set('datos');
    this.vista.set('ficha');
  }

  abrirMiembro(miembro: MiembroFamilia): void {
    this.miembroActivo.set(miembro);
    this.form.reset({ ...miembro, apellidoMaterno: miembro.apellidoMaterno ?? '' });
    this.tabFicha.set('datos');
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

    const valor = this.form.getRawValue();
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

  // ── Tarjeta de emergencia ────────────────────────────────────────────
  /** Descarga una tarjeta tamaño credencial (85.6mm x 54mm, mismo tamaño
   *  que una tarjeta bancaria/INE) en PDF, dibujada con jsPDF (ya es
   *  dependencia del proyecto — ver Comercio/Cotizaciones), no una captura
   *  de pantalla: así el texto sale nítido y seleccionable en el PDF. */
  descargarTarjeta(): void {
    const m = this.miembroActivo();
    if (!m) return;

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [54, 85.6] });
    const anchoUtil = 85.6 - 10;
    let y = 8;

    doc.setFillColor(20, 30, 45);
    doc.rect(0, 0, 85.6, 54, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('TARJETA DE EMERGENCIA', 5, y);
    y += 6;

    doc.setFontSize(10);
    doc.text([m.nombre, m.apellidoPaterno, m.apellidoMaterno].filter(Boolean).join(' '), 5, y);
    y += 5.5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const edad = calcularEdad(m.fechaNacimiento);
    doc.text(`Edad: ${edad === null ? '—' : edad + ' años'}    Tipo de sangre: ${m.tipoSangre || '—'}`, 5, y);
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
    doc.setDrawColor(255, 255, 255);
    doc.line(5, y, 85.6 - 5, y);
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

    const nombreArchivo = `tarjeta-emergencia-${(m.nombre + ' ' + m.apellidoPaterno).trim().replace(/\s+/g, '-').toLowerCase()}.pdf`;
    doc.save(nombreArchivo);
  }
}
